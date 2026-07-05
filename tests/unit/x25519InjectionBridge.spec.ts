import { describe, expect, it, vi } from "vitest"
import {
  BRIDGE_READY_MESSAGE_TYPE,
  KEY_INJECTED_MESSAGE_TYPE,
  PENDING_KEY_GLOBAL,
  X25519_KEY_CLEARED_EVENT,
  X25519_KEY_INJECTED_EVENT,
  createAssetDidCommBridge,
  installAssetDidCommBridge,
  type X25519KeySink
} from "../../app/services/injection/x25519InjectionBridge"

const SECRET_JWK = { kty: "OKP", crv: "X25519", d: "b1Y5gDkbYnfa2Fgz2suSBnJPUcXaqOhaM8vNbnUmYWI", x: "L-V9o0fNYkMVKNqsX7spBzD_9oSvxM_C7ZCZX1jLO3Q", kid: "test-kid" }

function makeSink(overrides: Partial<X25519KeySink> = {}): X25519KeySink {
  return {
    setX25519SecretJwk: vi.fn(),
    clearX25519SecretJwk: vi.fn(),
    getX25519KeyId: vi.fn(() => "test-kid"),
    hasX25519Key: vi.fn(() => true),
    ...overrides
  }
}

function makeWindow(extra: Record<string, unknown> = {}) {
  const listeners = new Map<string, Array<(event: Event) => void>>()
  const target = {
    dispatchEvent: vi.fn((event: Event) => {
      for (const listener of listeners.get(event.type) ?? []) {
        listener(event)
      }
      return true
    }),
    addEventListener: (type: string, listener: (event: Event) => void) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener])
    },
    ...extra
  }
  return target as unknown as Window
}

describe("x25519 injection bridge", () => {
  it("injects a key passed as a JSON string", () => {
    const sink = makeSink()
    const bridge = createAssetDidCommBridge(sink, makeWindow())

    const result = bridge.injectX25519Key(JSON.stringify(SECRET_JWK))

    expect(result).toEqual({ ok: true, keyId: "test-kid" })
    expect(sink.setX25519SecretJwk).toHaveBeenCalledWith(SECRET_JWK, true)
  })

  it("injects a key passed as an object and honours persist: false", () => {
    const sink = makeSink()
    const bridge = createAssetDidCommBridge(sink, makeWindow())

    const result = bridge.injectX25519Key(SECRET_JWK, { persist: false })

    expect(result.ok).toBe(true)
    expect(sink.setX25519SecretJwk).toHaveBeenCalledWith(SECRET_JWK, false)
  })

  it("returns an error result for malformed JSON without throwing", () => {
    const sink = makeSink()
    const bridge = createAssetDidCommBridge(sink, makeWindow())

    const result = bridge.injectX25519Key("{not json")

    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
    expect(sink.setX25519SecretJwk).not.toHaveBeenCalled()
  })

  it("returns an error result when the sink rejects the key", () => {
    const sink = makeSink({
      setX25519SecretJwk: vi.fn(() => {
        throw new Error("KEY_VALIDATION_ERROR")
      })
    })
    const bridge = createAssetDidCommBridge(sink, makeWindow())

    const result = bridge.injectX25519Key(JSON.stringify({ kty: "RSA" }))

    expect(result).toEqual({ ok: false, error: "KEY_VALIDATION_ERROR" })
  })

  it("dispatches a DOM event on successful injection", () => {
    const target = makeWindow()
    const injected = vi.fn()
    target.addEventListener(X25519_KEY_INJECTED_EVENT, injected)
    const bridge = createAssetDidCommBridge(makeSink(), target)

    bridge.injectX25519Key(SECRET_JWK)

    expect(injected).toHaveBeenCalledTimes(1)
    const event = injected.mock.calls[0]?.[0] as CustomEvent
    expect(event.detail).toEqual({ keyId: "test-kid" })
  })

  it("notifies a HybridWebView host about injection outcomes", () => {
    const sendRawMessage = vi.fn()
    const target = makeWindow({ HybridWebView: { SendRawMessage: sendRawMessage } })
    const bridge = createAssetDidCommBridge(makeSink(), target)

    bridge.injectX25519Key(SECRET_JWK)

    expect(sendRawMessage).toHaveBeenCalledTimes(1)
    expect(JSON.parse(sendRawMessage.mock.calls[0]?.[0] as string)).toEqual({
      type: KEY_INJECTED_MESSAGE_TYPE,
      ok: true,
      keyId: "test-kid"
    })
  })

  it("clears the key and dispatches the cleared event", () => {
    const sink = makeSink()
    const target = makeWindow()
    const cleared = vi.fn()
    target.addEventListener(X25519_KEY_CLEARED_EVENT, cleared)
    const bridge = createAssetDidCommBridge(sink, target)

    const result = bridge.clearX25519Key()

    expect(result).toEqual({ ok: true })
    expect(sink.clearX25519SecretJwk).toHaveBeenCalledTimes(1)
    expect(cleared).toHaveBeenCalledTimes(1)
  })

  it("installs onto window, drains a pending key, and signals readiness", () => {
    const sink = makeSink()
    const sendRawMessage = vi.fn()
    const target = makeWindow({
      HybridWebView: { SendRawMessage: sendRawMessage },
      [PENDING_KEY_GLOBAL]: JSON.stringify(SECRET_JWK)
    })

    const bridge = installAssetDidCommBridge(sink, target)

    expect((target as Window & { assetDidComm?: unknown }).assetDidComm).toBe(bridge)
    expect((target as unknown as Record<string, unknown>)[PENDING_KEY_GLOBAL]).toBeUndefined()
    expect(sink.setX25519SecretJwk).toHaveBeenCalledWith(SECRET_JWK, true)

    const messageTypes = sendRawMessage.mock.calls.map(call => (JSON.parse(call[0] as string) as { type: string }).type)
    expect(messageTypes).toContain(KEY_INJECTED_MESSAGE_TYPE)
    expect(messageTypes).toContain(BRIDGE_READY_MESSAGE_TYPE)
  })

  it("installs cleanly outside a HybridWebView host", () => {
    const target = makeWindow()

    const bridge = installAssetDidCommBridge(makeSink(), target)

    expect(bridge.hasX25519Key()).toBe(true)
    expect(bridge.injectX25519Key(SECRET_JWK).ok).toBe(true)
  })
})

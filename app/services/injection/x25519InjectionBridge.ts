/**
 * Host-injection bridge for X25519 key material.
 *
 * Native shells (e.g. a .NET MAUI HybridWebView) inject the user's X25519
 * secret JWK into the dashboard by evaluating JavaScript against the page:
 *
 *   window.assetDidComm.injectX25519Key('{"kty":"OKP","crv":"X25519","d":"...","x":"..."}')
 *
 * If the host runs its injection script before the Nuxt app has booted, it can
 * stash the key in `window.__assetDidCommPendingX25519Key` instead; the bridge
 * drains that slot as soon as it installs.
 *
 * See csharp-injection-guide.md at the repository root for the C# side.
 */

export const X25519_KEY_INJECTED_EVENT = "assetdidcomm:x25519-key-injected"
export const X25519_KEY_CLEARED_EVENT = "assetdidcomm:x25519-key-cleared"
export const BRIDGE_READY_MESSAGE_TYPE = "assetDidComm:bridgeReady"
export const KEY_INJECTED_MESSAGE_TYPE = "assetDidComm:keyInjected"
export const PENDING_KEY_GLOBAL = "__assetDidCommPendingX25519Key"

export interface X25519KeySink {
  setX25519SecretJwk(value: unknown, persist?: boolean): void
  clearX25519SecretJwk(): void
  getX25519KeyId(): string | undefined
  hasX25519Key(): boolean
}

export interface InjectionOptions {
  /** Persist the key to localStorage (default true). Hosts that manage key
   * storage themselves (e.g. platform secure storage) should pass false so the
   * key only lives in memory for the current page. */
  persist?: boolean
}

export interface InjectionResult {
  ok: boolean
  keyId?: string
  error?: string
}

export interface AssetDidCommBridge {
  readonly version: 1
  injectX25519Key(key: string | Record<string, unknown>, options?: InjectionOptions): InjectionResult
  clearX25519Key(): InjectionResult
  hasX25519Key(): boolean
}

interface HybridWebViewGlobal {
  SendRawMessage?: (message: string) => void
}

type BridgeWindow = Window & {
  assetDidComm?: AssetDidCommBridge
  HybridWebView?: HybridWebViewGlobal
  [PENDING_KEY_GLOBAL]?: string | Record<string, unknown>
}

function sendRawMessageToHost(target: BridgeWindow, payload: Record<string, unknown>): void {
  try {
    target.HybridWebView?.SendRawMessage?.(JSON.stringify(payload))
  } catch {
    // The page is not hosted inside a HybridWebView; nothing to notify.
  }
}

export function createAssetDidCommBridge(
  sink: X25519KeySink,
  target: BridgeWindow
): AssetDidCommBridge {
  function injectX25519Key(
    key: string | Record<string, unknown>,
    options?: InjectionOptions
  ): InjectionResult {
    let result: InjectionResult

    try {
      const parsed = typeof key === "string" ? (JSON.parse(key) as unknown) : key
      sink.setX25519SecretJwk(parsed, options?.persist !== false)
      result = { ok: true, keyId: sink.getX25519KeyId() }
    } catch (error) {
      result = { ok: false, error: error instanceof Error ? error.message : "X25519 key injection failed" }
    }

    if (result.ok) {
      target.dispatchEvent(new CustomEvent(X25519_KEY_INJECTED_EVENT, { detail: { keyId: result.keyId } }))
    }
    sendRawMessageToHost(target, { type: KEY_INJECTED_MESSAGE_TYPE, ...result })

    return result
  }

  function clearX25519Key(): InjectionResult {
    sink.clearX25519SecretJwk()
    target.dispatchEvent(new CustomEvent(X25519_KEY_CLEARED_EVENT))
    return { ok: true }
  }

  return {
    version: 1,
    injectX25519Key,
    clearX25519Key,
    hasX25519Key: () => sink.hasX25519Key()
  }
}

/**
 * Installs the bridge on `window`, drains any key the host stashed before the
 * app booted, and tells a HybridWebView host that injection is now available.
 */
export function installAssetDidCommBridge(sink: X25519KeySink, target: Window): AssetDidCommBridge {
  const bridgeWindow = target as BridgeWindow
  const bridge = createAssetDidCommBridge(sink, bridgeWindow)
  bridgeWindow.assetDidComm = bridge

  const pendingKey = bridgeWindow[PENDING_KEY_GLOBAL]
  if (pendingKey !== undefined) {
    delete bridgeWindow[PENDING_KEY_GLOBAL]
    bridge.injectX25519Key(pendingKey)
  }

  sendRawMessageToHost(bridgeWindow, {
    type: BRIDGE_READY_MESSAGE_TYPE,
    hasKey: bridge.hasX25519Key()
  })

  return bridge
}

import { afterEach, describe, expect, it, vi } from "vitest"
import { base58Encode } from "@polkadot/util-crypto"
import { SolanaWalletProvider } from "../../app/services/wallet/solanaProvider"

const SIGNATURE = new Uint8Array(Array.from({ length: 64 }, (_, i) => i + 1))
const ADDRESS = "SoLAddr111111111111111111111111111111111111"

function fakeInjected(overrides: Record<string, unknown> = {}) {
  return {
    publicKey: { toBase58: () => ADDRESS },
    connect: vi.fn().mockResolvedValue({ publicKey: { toBase58: () => ADDRESS } }),
    signMessage: vi.fn().mockResolvedValue({ signature: SIGNATURE }),
    ...overrides
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("SolanaWalletProvider discovery", () => {
  it("prefers Phantom, then Solflare, then Backpack", async () => {
    const phantom = fakeInjected()
    const solflare = fakeInjected()
    vi.stubGlobal("window", { phantom: { solana: phantom }, solflare })

    const session = await new SolanaWalletProvider().connect()
    expect(session).toEqual({ address: ADDRESS, provider: "Phantom", kind: "solana" })
    expect(phantom.connect).toHaveBeenCalled()
    expect(solflare.connect).not.toHaveBeenCalled()
  })

  it("falls back to Solflare when Phantom is absent", async () => {
    const solflare = fakeInjected()
    vi.stubGlobal("window", { solflare })
    const session = await new SolanaWalletProvider().connect()
    expect(session.provider).toBe("Solflare")
  })

  it("throws WALLET_EXTENSION_UNAVAILABLE when no wallet is injected", async () => {
    vi.stubGlobal("window", {})
    await expect(new SolanaWalletProvider().connect()).rejects.toThrow("WALLET_EXTENSION_UNAVAILABLE")
  })
})

describe("SolanaWalletProvider accounts", () => {
  it("lists the single connected account", async () => {
    vi.stubGlobal("window", { phantom: { solana: fakeInjected() } })
    const accounts = await new SolanaWalletProvider().listAccounts()
    expect(accounts).toEqual([{ address: ADDRESS, name: "Phantom", source: "Phantom" }])
  })

  it("connectToAddress returns the wallet's actual account", async () => {
    vi.stubGlobal("window", { phantom: { solana: fakeInjected() } })
    const session = await new SolanaWalletProvider().connectToAddress(ADDRESS)
    expect(session.address).toBe(ADDRESS)
  })
})

describe("SolanaWalletProvider.autoConnect", () => {
  it("uses onlyIfTrusted and returns the session silently", async () => {
    const injected = fakeInjected()
    vi.stubGlobal("window", { phantom: { solana: injected } })

    const session = await new SolanaWalletProvider().autoConnect(null, 0)
    expect(injected.connect).toHaveBeenCalledWith({ onlyIfTrusted: true })
    expect(session).toEqual({ address: ADDRESS, provider: "Phantom", kind: "solana" })
  })

  it("returns null when the wallet is not trusted yet", async () => {
    const injected = fakeInjected({ connect: vi.fn().mockRejectedValue(new Error("not trusted")) })
    vi.stubGlobal("window", { phantom: { solana: injected } })
    expect(await new SolanaWalletProvider().autoConnect(null, 0)).toBeNull()
  })

  it("returns null when no wallet is injected (after retries exhaust)", async () => {
    vi.stubGlobal("window", {})
    expect(await new SolanaWalletProvider().autoConnect(null, 0)).toBeNull()
  })

  it("retries until a late-injecting wallet appears", async () => {
    vi.useFakeTimers()
    const injected = fakeInjected()
    const w: Record<string, unknown> = {}
    vi.stubGlobal("window", w)

    const pending = new SolanaWalletProvider().autoConnect(null, 3)
    // Wallet script "injects" after the first 500ms wait.
    await vi.advanceTimersByTimeAsync(500)
    w.phantom = { solana: injected }
    await vi.advanceTimersByTimeAsync(500)

    const session = await pending
    expect(injected.connect).toHaveBeenCalledWith({ onlyIfTrusted: true })
    expect(session).toEqual({ address: ADDRESS, provider: "Phantom", kind: "solana" })
  })
})

describe("SolanaWalletProvider.signApiRequest", () => {
  it("signs the RAW payload bytes and returns a base58 signature (ed25519 contract)", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-11T22:58:41.735Z"))
    const injected = fakeInjected()
    vi.stubGlobal("window", { phantom: { solana: injected } })

    const headers = await new SolanaWalletProvider().signApiRequest(
      ADDRESS,
      "POST",
      "/graphql",
      "0xBODYHASH"
    )

    const expectedPayload = "POST:/graphql:0xBODYHASH:2026-07-11T22:58:41.7350000Z"
    expect(injected.signMessage).toHaveBeenCalledTimes(1)
    const [bytes, display] = injected.signMessage.mock.calls[0]!
    expect(new TextDecoder().decode(bytes as Uint8Array)).toBe(expectedPayload)
    expect(display).toBe("utf8")
    expect(headers).toEqual({
      "X-SS58-Address": ADDRESS,
      "X-Signature": base58Encode(SIGNATURE),
      "X-Timestamp": "2026-07-11T22:58:41.7350000Z"
    })
  })

  it("accepts wallets that return the signature bytes directly", async () => {
    const injected = fakeInjected({ signMessage: vi.fn().mockResolvedValue(SIGNATURE) })
    vi.stubGlobal("window", { phantom: { solana: injected } })

    const headers = await new SolanaWalletProvider().signApiRequest(ADDRESS, "POST", "/graphql", "0xB")
    expect((headers as Record<string, string>)["X-Signature"]).toBe(base58Encode(SIGNATURE))
  })
})

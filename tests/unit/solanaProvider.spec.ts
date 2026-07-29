import { afterEach, describe, expect, it, vi } from "vitest"
import { base58Encode } from "@polkadot/util-crypto"
import { SolanaWalletProvider } from "../../app/services/wallet/solanaProvider"
import {
  initSolanaWalletRegistry,
  resetSolanaWalletRegistry
} from "../../app/services/wallet/solanaWalletRegistry"
import {
  STANDARD_ADDRESS,
  STANDARD_SIGNATURE,
  announceWallet,
  fakeStandardWallet,
  stubWalletStandardWindow
} from "./helpers/walletStandard"

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
  resetSolanaWalletRegistry()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

/** Stubs window with the given legacy globals AND registers the given standard wallets. */
function stubMixedWindow(extras: Record<string, unknown>, ...standard: ReturnType<typeof fakeStandardWallet>[]) {
  const win = stubWalletStandardWindow(extras)
  initSolanaWalletRegistry()
  for (const wallet of standard) {
    announceWallet(win, wallet)
  }
  return win
}

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

  it("rejects with WALLET_ACCOUNT_NOT_FOUND when the wallet's active account differs from the requested address", async () => {
    const OTHER_ADDRESS = "SoLOtherAddr22222222222222222222222222222222"
    const injected = fakeInjected({ publicKey: { toBase58: () => OTHER_ADDRESS } })
    vi.stubGlobal("window", { phantom: { solana: injected } })

    await expect(
      new SolanaWalletProvider().signApiRequest(ADDRESS, "POST", "/graphql", "0xB")
    ).rejects.toThrow("WALLET_ACCOUNT_NOT_FOUND")
    expect(injected.signMessage).not.toHaveBeenCalled()
  })
})

describe("SolanaWalletProvider Wallet Standard discovery", () => {
  it("lists legacy wallets first, then registry wallets, without connecting", async () => {
    const phantom = fakeInjected()
    const nightly = fakeStandardWallet()
    stubMixedWindow({ phantom: { solana: phantom } }, nightly)

    const wallets = await new SolanaWalletProvider().listWallets()
    expect(wallets).toEqual([
      { name: "Phantom", icon: undefined },
      { name: "Nightly", icon: nightly.icon }
    ])
    expect(phantom.connect).not.toHaveBeenCalled()
    const connectFeature = nightly.features["standard:connect"] as { connect: ReturnType<typeof vi.fn> }
    expect(connectFeature.connect).not.toHaveBeenCalled()
  })

  it("dedupes a registry wallet whose name matches a legacy global", async () => {
    stubMixedWindow({ phantom: { solana: fakeInjected() } }, fakeStandardWallet({ name: "phantom" }))
    const wallets = await new SolanaWalletProvider().listWallets()
    expect(wallets.map((w) => w.name)).toEqual(["Phantom"])
  })

  it("listWallets is empty when nothing is installed", async () => {
    stubMixedWindow({})
    expect(await new SolanaWalletProvider().listWallets()).toEqual([])
  })
})

describe("SolanaWalletProvider.connectWith", () => {
  it("connects the named standard wallet", async () => {
    stubMixedWindow({ phantom: { solana: fakeInjected() } }, fakeStandardWallet())
    const session = await new SolanaWalletProvider().connectWith("Nightly")
    expect(session).toEqual({ address: STANDARD_ADDRESS, provider: "Nightly", kind: "solana" })
  })

  it("connects the named legacy wallet", async () => {
    const solflare = fakeInjected()
    stubMixedWindow({ solflare })
    const session = await new SolanaWalletProvider().connectWith("Solflare")
    expect(session.provider).toBe("Solflare")
    expect(solflare.connect).toHaveBeenCalled()
  })

  it("rejects an unknown wallet name with WALLET_EXTENSION_UNAVAILABLE", async () => {
    stubMixedWindow({ phantom: { solana: fakeInjected() } })
    await expect(new SolanaWalletProvider().connectWith("Nightly")).rejects.toThrow("WALLET_EXTENSION_UNAVAILABLE")
  })

  it("rejects with WALLET_CONNECTION_REJECTED when the standard wallet returns no accounts", async () => {
    const nightly = fakeStandardWallet()
    ;(nightly.features["standard:connect"] as { connect: ReturnType<typeof vi.fn> }).connect =
      vi.fn().mockResolvedValue({ accounts: [] })
    stubMixedWindow({}, nightly)
    await expect(new SolanaWalletProvider().connectWith("Nightly")).rejects.toThrow("WALLET_CONNECTION_REJECTED")
  })
})

describe("SolanaWalletProvider standard-wallet signing", () => {
  it("signs raw payload bytes via solana:signMessage with the cached account (ed25519 contract)", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-11T22:58:41.735Z"))
    const nightly = fakeStandardWallet()
    stubMixedWindow({}, nightly)

    const provider = new SolanaWalletProvider()
    await provider.connectWith("Nightly")
    const headers = await provider.signApiRequest(STANDARD_ADDRESS, "POST", "/graphql", "0xBODYHASH")

    const signFeature = nightly.features["solana:signMessage"] as { signMessage: ReturnType<typeof vi.fn> }
    expect(signFeature.signMessage).toHaveBeenCalledTimes(1)
    const [input] = signFeature.signMessage.mock.calls[0]!
    expect(input.account.address).toBe(STANDARD_ADDRESS)
    expect(new TextDecoder().decode(input.message)).toBe("POST:/graphql:0xBODYHASH:2026-07-11T22:58:41.7350000Z")
    expect(headers).toEqual({
      "X-SS58-Address": STANDARD_ADDRESS,
      "X-Signature": base58Encode(STANDARD_SIGNATURE),
      "X-Timestamp": "2026-07-11T22:58:41.7350000Z"
    })
  })

  it("connects first when asked to sign without a cached account", async () => {
    const nightly = fakeStandardWallet()
    stubMixedWindow({}, nightly)

    const headers = await new SolanaWalletProvider().signApiRequest(STANDARD_ADDRESS, "POST", "/graphql", "0xB")
    const connectFeature = nightly.features["standard:connect"] as { connect: ReturnType<typeof vi.fn> }
    expect(connectFeature.connect).toHaveBeenCalled()
    expect((headers as Record<string, string>)["X-Signature"]).toBe(base58Encode(STANDARD_SIGNATURE))
  })

  it("still rejects WALLET_ACCOUNT_NOT_FOUND when the cached account differs from the requested address", async () => {
    const nightly = fakeStandardWallet()
    stubMixedWindow({}, nightly)
    const provider = new SolanaWalletProvider()
    await provider.connectWith("Nightly")

    await expect(provider.signApiRequest(ADDRESS, "POST", "/graphql", "0xB")).rejects.toThrow("WALLET_ACCOUNT_NOT_FOUND")
  })

  it("picks the wallet whose active address matches when several are connected", async () => {
    const phantom = fakeInjected()
    const nightly = fakeStandardWallet()
    stubMixedWindow({ phantom: { solana: phantom } }, nightly)
    const provider = new SolanaWalletProvider()
    await provider.connectWith("Nightly")

    await provider.signApiRequest(STANDARD_ADDRESS, "POST", "/graphql", "0xB")
    const signFeature = nightly.features["solana:signMessage"] as { signMessage: ReturnType<typeof vi.fn> }
    expect(signFeature.signMessage).toHaveBeenCalledTimes(1)
    expect(phantom.signMessage).not.toHaveBeenCalled()
  })
})

describe("SolanaWalletProvider.autoConnect across wallets", () => {
  it("prefers the stored provider name for the silent reconnect", async () => {
    const phantom = fakeInjected()
    const nightly = fakeStandardWallet()
    stubMixedWindow({ phantom: { solana: phantom } }, nightly)

    const stored = { address: STANDARD_ADDRESS, provider: "Nightly", kind: "solana" as const }
    const session = await new SolanaWalletProvider().autoConnect(stored, 0)

    const connectFeature = nightly.features["standard:connect"] as { connect: ReturnType<typeof vi.fn> }
    expect(connectFeature.connect).toHaveBeenCalledWith({ silent: true })
    expect(phantom.connect).not.toHaveBeenCalled()
    expect(session).toEqual({ address: STANDARD_ADDRESS, provider: "Nightly", kind: "solana" })
  })

  it("falls through failing wallets to the next silent candidate", async () => {
    const phantom = fakeInjected({ connect: vi.fn().mockRejectedValue(new Error("not trusted")) })
    const nightly = fakeStandardWallet()
    stubMixedWindow({ phantom: { solana: phantom } }, nightly)

    const session = await new SolanaWalletProvider().autoConnect(null, 0)
    expect(session).toEqual({ address: STANDARD_ADDRESS, provider: "Nightly", kind: "solana" })
  })
})

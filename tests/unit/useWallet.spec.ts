import { afterEach, describe, expect, it, vi } from "vitest"

const walletMocks = vi.hoisted(() => ({
  blake2AsHex: vi.fn(),
  cryptoWaitReady: vi.fn().mockResolvedValue(true),
  signRaw: vi.fn().mockResolvedValue({ signature: "0xsigned" }),
  web3Enable: vi.fn().mockResolvedValue([{}]),
  web3FromAddress: vi.fn()
}))

vi.mock("@polkadot/extension-dapp", () => ({
  web3Accounts: vi.fn(),
  web3Enable: walletMocks.web3Enable,
  web3FromAddress: walletMocks.web3FromAddress
}))

vi.mock("@polkadot/util-crypto", () => ({
  blake2AsHex: walletMocks.blake2AsHex,
  cryptoWaitReady: walletMocks.cryptoWaitReady
}))

import { PolkadotWalletProvider } from "../../app/services/wallet/polkadotProvider"

describe("PolkadotWalletProvider.signApiRequest", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it("signs the blake2-128 hash of the composed payload (sr25519 contract)", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-11T22:58:41.735Z"))
    walletMocks.web3FromAddress.mockResolvedValue({ signer: { signRaw: walletMocks.signRaw } })
    walletMocks.blake2AsHex.mockReturnValueOnce("0xpayloadhash")

    const provider = new PolkadotWalletProvider()
    const headers = await provider.signApiRequest(
      "5Example",
      "PUT",
      "/api/profiles/5Example",
      "0xBODYHASH"
    )

    // Payload uses the C# Bytes2HexString body hash (0x+UPPERCASE, precomputed
    // by the caller) and the C# :o timestamp (7 fractional digits).
    expect(walletMocks.blake2AsHex).toHaveBeenCalledWith(
      "PUT:/api/profiles/5Example:0xBODYHASH:2026-07-11T22:58:41.7350000Z",
      128
    )
    expect(walletMocks.signRaw).toHaveBeenCalledWith({
      address: "5Example",
      data: "0xpayloadhash",
      type: "bytes"
    })
    expect(headers).toEqual({
      "X-SS58-Address": "5Example",
      "X-Signature": "0xsigned",
      "X-Timestamp": "2026-07-11T22:58:41.7350000Z"
    })
  })

  it("supports the empty body-hash segment (multipart image uploads)", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-11T22:58:41.735Z"))
    walletMocks.web3FromAddress.mockResolvedValue({ signer: { signRaw: walletMocks.signRaw } })
    walletMocks.blake2AsHex.mockReturnValue("0xpayloadhash")

    const provider = new PolkadotWalletProvider()
    await provider.signApiRequest("5Example", "POST", "/api/profiles/5Example/image", "")

    expect(walletMocks.blake2AsHex).toHaveBeenCalledWith(
      "POST:/api/profiles/5Example/image::2026-07-11T22:58:41.7350000Z",
      128
    )
  })

  it("signs GraphQL requests with the fixed POST /graphql method and path", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-11T22:58:41.735Z"))
    walletMocks.web3FromAddress.mockResolvedValue({ signer: { signRaw: walletMocks.signRaw } })
    walletMocks.blake2AsHex.mockReturnValueOnce("0xpayloadhash")

    const provider = new PolkadotWalletProvider()
    const headers = await provider.signApiRequest("5Example", "POST", "/graphql", "0xBODYHASH")

    expect(walletMocks.blake2AsHex).toHaveBeenCalledWith(
      "POST:/graphql:0xBODYHASH:2026-07-11T22:58:41.7350000Z",
      128
    )
    expect(headers).toEqual({
      "X-SS58-Address": "5Example",
      "X-Signature": "0xsigned",
      "X-Timestamp": "2026-07-11T22:58:41.7350000Z"
    })
  })

  it("rejects when the extension exposes no signRaw", async () => {
    walletMocks.web3FromAddress.mockResolvedValue({ signer: {} })
    const provider = new PolkadotWalletProvider()
    await expect(
      provider.signApiRequest("5Example", "POST", "/graphql", "0xB")
    ).rejects.toThrow("WALLET_SIGNING_UNAVAILABLE")
  })
})

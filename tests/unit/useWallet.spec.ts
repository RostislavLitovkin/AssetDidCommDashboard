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

import { WalletExtensionProvider } from "../../app/services/wallet/extensionProvider"

describe("useWallet", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it("signs the API's Blake2-128 hash of the canonical request payload", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-11T22:58:41.735Z"))
    walletMocks.web3FromAddress.mockResolvedValue({ signer: { signRaw: walletMocks.signRaw } })
    walletMocks.blake2AsHex
      .mockReturnValueOnce("0xbodyhash")
      .mockReturnValueOnce("0xpayloadhash")

    const provider = new WalletExtensionProvider()
    const headers = await provider.signProfileRequest(
      "5Example",
      "POST",
      "/api/profiles",
      "{\"nickname\":\"alice\"}"
    )

    expect(walletMocks.blake2AsHex).toHaveBeenNthCalledWith(1, "{\"nickname\":\"alice\"}", 128)
    expect(walletMocks.blake2AsHex).toHaveBeenNthCalledWith(
      2,
      "POST:/api/profiles:bodyhash:2026-07-11T22:58:41.735Z",
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
      "X-Timestamp": "2026-07-11T22:58:41.735Z"
    })
  })
})

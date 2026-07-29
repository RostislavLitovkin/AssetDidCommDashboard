import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  initSolanaWalletRegistry,
  registeredSolanaWallets,
  resetSolanaWalletRegistry
} from "../../app/services/wallet/solanaWalletRegistry"
import { announceWallet, fakeStandardWallet, stubWalletStandardWindow } from "./helpers/walletStandard"

beforeEach(() => resetSolanaWalletRegistry())
afterEach(() => {
  resetSolanaWalletRegistry()
  vi.unstubAllGlobals()
})

describe("solanaWalletRegistry", () => {
  it("collects a wallet that announces itself after init", () => {
    const win = stubWalletStandardWindow()
    initSolanaWalletRegistry()
    announceWallet(win, fakeStandardWallet())
    expect(registeredSolanaWallets().map((w) => w.name)).toEqual(["Nightly"])
  })

  it("collects wallets already loaded before init via app-ready", () => {
    const win = stubWalletStandardWindow()
    // A pre-loaded wallet listens for app-ready and registers in response.
    win.addEventListener("wallet-standard:app-ready", (event) => {
      const api = (event as { detail: { register: (w: unknown) => void } }).detail
      api.register(fakeStandardWallet())
    })
    initSolanaWalletRegistry()
    expect(registeredSolanaWallets().map((w) => w.name)).toEqual(["Nightly"])
  })

  it("rejects wallets missing solana:signMessage", () => {
    const win = stubWalletStandardWindow()
    initSolanaWalletRegistry()
    const wallet = fakeStandardWallet()
    announceWallet(win, { ...wallet, features: { "standard:connect": wallet.features["standard:connect"] } })
    expect(registeredSolanaWallets()).toEqual([])
  })

  it("rejects wallets without a solana chain", () => {
    const win = stubWalletStandardWindow()
    initSolanaWalletRegistry()
    announceWallet(win, fakeStandardWallet({ chains: ["ethereum:1"] }))
    expect(registeredSolanaWallets()).toEqual([])
  })

  it("dedupes wallets by case-insensitive name", () => {
    const win = stubWalletStandardWindow()
    initSolanaWalletRegistry()
    announceWallet(win, fakeStandardWallet())
    announceWallet(win, fakeStandardWallet({ name: "nightly" }))
    expect(registeredSolanaWallets()).toHaveLength(1)
  })

  it("init is idempotent — one listener, one app-ready dispatch", () => {
    const win = stubWalletStandardWindow()
    const addSpy = vi.spyOn(win, "addEventListener")
    const dispatchSpy = vi.spyOn(win, "dispatchEvent")
    initSolanaWalletRegistry()
    initSolanaWalletRegistry()
    expect(addSpy).toHaveBeenCalledTimes(1)
    expect(dispatchSpy).toHaveBeenCalledTimes(1)
  })

  it("tolerates window stubs without an event surface (node tests)", () => {
    vi.stubGlobal("window", {})
    expect(() => initSolanaWalletRegistry()).not.toThrow()
    expect(registeredSolanaWallets()).toEqual([])
  })
})

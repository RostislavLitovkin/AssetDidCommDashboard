import { vi } from "vitest"
import type { StandardWallet } from "../../../app/services/wallet/solanaWalletRegistry"

export const STANDARD_ADDRESS = "NighTAddr333333333333333333333333333333333333"
export const STANDARD_SIGNATURE = new Uint8Array(Array.from({ length: 64 }, (_, i) => 64 - i))

export interface StubbedWindow extends Record<string, unknown> {
  addEventListener(type: string, listener: (event: unknown) => void): void
  dispatchEvent(event: { type: string; detail?: unknown }): boolean
}

/**
 * Vitest runs in the node environment, so `window` is stubbed per test. This
 * stub carries just enough of the event surface for the Wallet Standard
 * handshake (addEventListener + dispatchEvent routing by event type).
 */
export function stubWalletStandardWindow(extras: Record<string, unknown> = {}): StubbedWindow {
  const listeners = new Map<string, Array<(event: unknown) => void>>()
  const win: StubbedWindow = {
    ...extras,
    addEventListener(type, listener) {
      const existing = listeners.get(type)
      if (existing) {
        existing.push(listener)
      } else {
        listeners.set(type, [listener])
      }
    },
    dispatchEvent(event) {
      for (const listener of listeners.get(event.type) ?? []) {
        listener(event)
      }
      return true
    }
  }
  vi.stubGlobal("window", win)
  return win
}

/** Simulates a wallet script announcing itself after the app is listening. */
export function announceWallet(win: StubbedWindow, wallet: StandardWallet): void {
  win.dispatchEvent({
    type: "wallet-standard:register-wallet",
    detail: (api: { register: (...wallets: StandardWallet[]) => void }) => api.register(wallet)
  })
}

export function fakeStandardWallet(overrides: Partial<StandardWallet> = {}): StandardWallet {
  const account = { address: STANDARD_ADDRESS }
  return {
    name: "Nightly",
    icon: "data:image/svg+xml;base64,PHN2Zy8+",
    chains: ["solana:mainnet"],
    features: {
      "standard:connect": {
        connect: vi.fn().mockResolvedValue({ accounts: [account] })
      },
      "solana:signMessage": {
        signMessage: vi.fn().mockResolvedValue([{ signature: STANDARD_SIGNATURE }])
      }
    },
    ...overrides
  }
}

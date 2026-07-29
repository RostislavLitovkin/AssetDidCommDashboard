# Arbitrary Solana Wallets via Wallet Standard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Any installed Solana wallet can connect and sign — not only Phantom/Solflare/Backpack — via an in-house Wallet Standard registry, with a wallet picker in the Select Wallet modal that auto-connects when exactly one wallet is discovered.

**Architecture:** A ~40-line client-only event registry (`solanaWalletRegistry.ts`) collects Wallet Standard wallets. `SolanaWalletProvider` gains an internal `DiscoveredWallet` abstraction with two adapters (legacy injected globals, Wallet Standard) and new optional `listWallets()`/`connectWith(name)` provider members that the modal feature-detects. Polkadot paths are untouched.

**Tech Stack:** Nuxt 4 / Vue 3 / Pinia, TypeScript, Vitest (node environment, `window` stubbed per test), `@polkadot/util-crypto` for base58.

**Spec:** `docs/superpowers/specs/2026-07-28-solana-wallet-standard-design.md`

## Global Constraints

- **No new npm dependencies.** Wallet Standard discovery is implemented in-house.
- Legacy globals (`window.phantom?.solana` → `window.solflare` → `window.backpack`) rank **first** in discovery; registry wallets are additive, deduped by case-insensitive name.
- Signing contract is unchanged: payload from `composeApiSignaturePayload`, raw UTF-8 bytes signed (never hashed), base58 `X-Signature`, headers `X-SS58-Address` / `X-Signature` / `X-Timestamp`.
- Error codes unchanged: `WALLET_EXTENSION_UNAVAILABLE`, `WALLET_CONNECTION_REJECTED`, `WALLET_ACCOUNT_NOT_FOUND`.
- All existing tests must pass unchanged (the only permitted edit to an existing spec file is adding registry reset to `afterEach` in `tests/unit/solanaProvider.spec.ts`).
- Test commands: `npm run test:unit`, `npm run lint`, `npm run typecheck`.
- Vitest runs in **node** environment: every test stubs `window` via `vi.stubGlobal`; the registry must tolerate window stubs without `addEventListener`.

---

### Task 1: Wallet Standard registry

**Files:**
- Create: `app/services/wallet/solanaWalletRegistry.ts`
- Create: `tests/unit/helpers/walletStandard.ts` (not matched by vitest's `*.spec.ts` include — plain helper module)
- Create: `tests/unit/solanaWalletRegistry.spec.ts`
- Modify: `app/plugins/walletAutoConnect.client.ts` (init call)

**Interfaces:**
- Consumes: nothing new.
- Produces (used by Tasks 2 and 3):
  - `interface StandardWalletAccount { address: string; publicKey?: Uint8Array }`
  - `interface StandardConnectFeature { connect(options?: { silent?: boolean }): Promise<{ accounts: readonly StandardWalletAccount[] }> }`
  - `interface SolanaSignMessageFeature { signMessage(input: { account: StandardWalletAccount; message: Uint8Array }): Promise<readonly { signature: Uint8Array }[]> }`
  - `interface StandardWallet { name: string; icon: string; chains: readonly string[]; features: Record<string, unknown> }`
  - `initSolanaWalletRegistry(): void` — idempotent, no-op without a usable `window`
  - `registeredSolanaWallets(): StandardWallet[]` — lazily inits, returns snapshot in registration order
  - `resetSolanaWalletRegistry(): void` — test-only reset of module state
- Test helper produces (used by Tasks 1–3 specs):
  - `stubWalletStandardWindow(extras?: Record<string, unknown>)` — returns the stubbed window with working `addEventListener`/`dispatchEvent`
  - `announceWallet(win, wallet)` — dispatches a `wallet-standard:register-wallet` event for `wallet`
  - `fakeStandardWallet(overrides?)` — a conforming standard wallet with `vi.fn()` features

- [ ] **Step 1: Write the test helper**

Create `tests/unit/helpers/walletStandard.ts`:

```ts
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
```

- [ ] **Step 2: Write the failing registry tests**

Create `tests/unit/solanaWalletRegistry.spec.ts`:

```ts
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/unit/solanaWalletRegistry.spec.ts`
Expected: FAIL — cannot resolve `../../app/services/wallet/solanaWalletRegistry`.

- [ ] **Step 4: Implement the registry**

Create `app/services/wallet/solanaWalletRegistry.ts`:

```ts
/**
 * Minimal in-house Wallet Standard registry — no @wallet-standard/app
 * dependency. Wallets announce themselves by dispatching
 * `wallet-standard:register-wallet` with a callback as `detail`; the app
 * announces readiness by dispatching `wallet-standard:app-ready` with a
 * `{ register }` api as `detail`, which already-loaded wallets call back.
 */

export interface StandardWalletAccount {
  address: string
  publicKey?: Uint8Array
}

export interface StandardConnectFeature {
  connect(options?: { silent?: boolean }): Promise<{ accounts: readonly StandardWalletAccount[] }>
}

export interface SolanaSignMessageFeature {
  signMessage(input: {
    account: StandardWalletAccount
    message: Uint8Array
  }): Promise<readonly { signature: Uint8Array }[]>
}

export interface StandardWallet {
  name: string
  icon: string
  chains: readonly string[]
  features: Record<string, unknown>
}

const wallets: StandardWallet[] = []
let initialized = false

/** Only wallets we can actually connect and sign with are accepted. */
function isUsableSolanaWallet(wallet: StandardWallet): boolean {
  return (
    Boolean(wallet.features?.["standard:connect"]) &&
    Boolean(wallet.features?.["solana:signMessage"]) &&
    (wallet.chains ?? []).some((chain) => chain.startsWith("solana:"))
  )
}

function register(...newWallets: StandardWallet[]): () => void {
  for (const wallet of newWallets) {
    if (!isUsableSolanaWallet(wallet)) {
      continue
    }
    if (wallets.some((existing) => existing.name.toLowerCase() === wallet.name.toLowerCase())) {
      continue
    }
    wallets.push(wallet)
  }
  return () => {}
}

export function initSolanaWalletRegistry(): void {
  // Guards both SSR and node-environment tests whose window stubs lack the
  // event surface; initialized is only latched on the successful path so a
  // later call with a real window still attaches.
  if (initialized || typeof window === "undefined" || typeof window.addEventListener !== "function") {
    return
  }
  initialized = true

  window.addEventListener("wallet-standard:register-wallet", (event) => {
    const callback = (event as unknown as { detail?: unknown }).detail
    if (typeof callback === "function") {
      callback({ register })
    }
  })
  window.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: { register } }))
}

export function registeredSolanaWallets(): StandardWallet[] {
  initSolanaWalletRegistry()
  return [...wallets]
}

/** Test-only: clears collected wallets and re-arms init for a fresh window stub. */
export function resetSolanaWalletRegistry(): void {
  wallets.length = 0
  initialized = false
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/solanaWalletRegistry.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Init the registry at app startup**

Modify `app/plugins/walletAutoConnect.client.ts` — add the import and call `initSolanaWalletRegistry()` immediately after the `import.meta.client` guard, so the listener is attached before wallets finish loading and before autoConnect's retry loop runs:

```ts
import { initSolanaWalletRegistry } from "../services/wallet/solanaWalletRegistry"
```

```ts
  if (!import.meta.client) {
    return
  }

  initSolanaWalletRegistry()
```

- [ ] **Step 7: Full check and commit**

Run: `npm run test:unit` then `npm run lint`
Expected: all pass.

```bash
git add app/services/wallet/solanaWalletRegistry.ts app/plugins/walletAutoConnect.client.ts tests/unit/helpers/walletStandard.ts tests/unit/solanaWalletRegistry.spec.ts
git commit -m "feat: in-house Wallet Standard registry for Solana wallets"
```

---

### Task 2: Provider discovery over legacy globals + registry

**Files:**
- Modify: `app/services/wallet/types.ts`
- Modify: `app/services/wallet/solanaProvider.ts` (full rewrite of internals; class API grows two methods)
- Modify: `tests/unit/solanaProvider.spec.ts` (add registry reset to `afterEach`; append new describe blocks — existing tests unchanged)

**Interfaces:**
- Consumes (from Task 1): `initSolanaWalletRegistry`, `registeredSolanaWallets`, `resetSolanaWalletRegistry`, `StandardWallet`, `StandardWalletAccount`, `StandardConnectFeature`, `SolanaSignMessageFeature`; test helpers `stubWalletStandardWindow`, `announceWallet`, `fakeStandardWallet`, `STANDARD_ADDRESS`, `STANDARD_SIGNATURE`.
- Produces (used by Task 4):
  - `types.ts`: `interface WalletInfo { name: string; icon?: string }`; `WalletProvider` gains optional `listWallets?(): Promise<WalletInfo[]>` and `connectWith?(name: string): Promise<WalletSession>`
  - `SolanaWalletProvider.listWallets(): Promise<WalletInfo[]>` — discovery only, never pops a wallet
  - `SolanaWalletProvider.connectWith(name: string): Promise<WalletSession>` — unknown name rejects `WALLET_EXTENSION_UNAVAILABLE`

- [ ] **Step 1: Add the optional provider members to types.ts**

In `app/services/wallet/types.ts`, add after `WalletAccountOption`:

```ts
/** A connectable wallet as shown in the picker; icon is the wallet-provided
 *  data: URI (absent for legacy injected wallets — the UI falls back to its
 *  own brand icons). */
export interface WalletInfo {
  name: string
  icon?: string
}
```

and extend `WalletProvider` (after `signApiRequest`):

```ts
  /** Optional (Solana only): discovered wallets; never triggers a connect popup. */
  listWallets?(): Promise<WalletInfo[]>
  /** Optional (Solana only): connect the named discovered wallet. */
  connectWith?(name: string): Promise<WalletSession>
```

- [ ] **Step 2: Add registry reset to the existing provider spec's afterEach**

In `tests/unit/solanaProvider.spec.ts`, extend imports and `afterEach` (this is the only edit to existing test code):

```ts
import { resetSolanaWalletRegistry } from "../../app/services/wallet/solanaWalletRegistry"
```

```ts
afterEach(() => {
  resetSolanaWalletRegistry()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
```

- [ ] **Step 3: Write the failing tests for discovery, connectWith, standard signing, and autoConnect preference**

Append to `tests/unit/solanaProvider.spec.ts`:

```ts
import {
  STANDARD_ADDRESS,
  STANDARD_SIGNATURE,
  announceWallet,
  fakeStandardWallet,
  stubWalletStandardWindow
} from "./helpers/walletStandard"
import { initSolanaWalletRegistry } from "../../app/services/wallet/solanaWalletRegistry"

/** Stubs window with the given legacy globals AND registers the given standard wallets. */
function stubMixedWindow(extras: Record<string, unknown>, ...standard: ReturnType<typeof fakeStandardWallet>[]) {
  const win = stubWalletStandardWindow(extras)
  initSolanaWalletRegistry()
  for (const wallet of standard) {
    announceWallet(win, wallet)
  }
  return win
}

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
```

- [ ] **Step 4: Run tests to verify the new ones fail and the old ones still pass**

Run: `npx vitest run tests/unit/solanaProvider.spec.ts`
Expected: existing tests PASS; every new test FAILS (`listWallets is not a function`, `connectWith is not a function`, etc.).

- [ ] **Step 5: Rewrite solanaProvider.ts internals**

Replace the body of `app/services/wallet/solanaProvider.ts` with:

```ts
import { composeApiSignaturePayload } from "./signingCore"
import { registeredSolanaWallets } from "./solanaWalletRegistry"
import type {
  SolanaSignMessageFeature,
  StandardConnectFeature,
  StandardWallet,
  StandardWalletAccount
} from "./solanaWalletRegistry"
import type { WalletAccountOption, WalletInfo, WalletProvider, WalletSession } from "./types"

/** The Phantom-style injected provider surface (also matched by Solflare/Backpack). */
interface SolanaInjectedProvider {
  publicKey?: { toBase58(): string } | null
  connect(options?: { onlyIfTrusted?: boolean }): Promise<{ publicKey?: { toBase58(): string } } | void>
  signMessage(message: Uint8Array, display?: "utf8" | "hex"): Promise<{ signature: Uint8Array } | Uint8Array>
}

/** A connectable Solana wallet, whichever protocol it was discovered over. */
interface DiscoveredWallet {
  name: string
  icon?: string
  /** Active base58 address when known without connecting; null otherwise. */
  activeAddress(): string | null
  /** Resolves the active address; silent never shows a popup. */
  connect(options?: { silent?: boolean }): Promise<string>
  signMessage(message: Uint8Array): Promise<Uint8Array>
}

function legacyWallet(provider: SolanaInjectedProvider, name: string): DiscoveredWallet {
  return {
    name,
    activeAddress: () => provider.publicKey?.toBase58() ?? null,
    async connect(options) {
      const result = await provider.connect(options?.silent ? { onlyIfTrusted: true } : undefined)
      // Phantom resolves connect() with the publicKey; Solflare resolves void
      // and sets .publicKey on the provider instead. Accept both.
      const key = result?.publicKey ?? provider.publicKey
      const address = key?.toBase58()
      if (!address) {
        throw new Error("WALLET_CONNECTION_REJECTED")
      }
      return address
    },
    async signMessage(message) {
      const result = await provider.signMessage(message, "utf8")
      return result instanceof Uint8Array ? result : result.signature
    }
  }
}

// Adapters cache the connected account, so they must survive re-discovery;
// keyed by the wallet object the registry holds.
const standardAdapters = new WeakMap<StandardWallet, DiscoveredWallet>()

function standardWallet(wallet: StandardWallet): DiscoveredWallet {
  const existing = standardAdapters.get(wallet)
  if (existing) {
    return existing
  }

  const connectFeature = wallet.features["standard:connect"] as StandardConnectFeature
  const signFeature = wallet.features["solana:signMessage"] as SolanaSignMessageFeature
  let account: StandardWalletAccount | null = null

  const connect = async (options?: { silent?: boolean }): Promise<string> => {
    const { accounts } = await connectFeature.connect(options?.silent ? { silent: true } : undefined)
    const first = accounts[0]
    if (!first) {
      throw new Error("WALLET_CONNECTION_REJECTED")
    }
    account = first
    return first.address
  }

  const adapter: DiscoveredWallet = {
    name: wallet.name,
    icon: wallet.icon,
    activeAddress: () => account?.address ?? null,
    connect,
    async signMessage(message) {
      if (!account) {
        // Signing already prompts, so a connect popup here is acceptable.
        await connect()
      }
      const [result] = await signFeature.signMessage({ account: account!, message })
      if (!result) {
        throw new Error("WALLET_CONNECTION_REJECTED")
      }
      return result.signature
    }
  }
  standardAdapters.set(wallet, adapter)
  return adapter
}

/** Legacy globals rank first; registry wallets are deduped by name. */
function discoverWallets(): DiscoveredWallet[] {
  if (typeof window === "undefined") {
    return []
  }

  const w = window as unknown as {
    phantom?: { solana?: SolanaInjectedProvider }
    solflare?: SolanaInjectedProvider
    backpack?: SolanaInjectedProvider
  }

  const found: DiscoveredWallet[] = []
  if (w.phantom?.solana) found.push(legacyWallet(w.phantom.solana, "Phantom"))
  if (w.solflare) found.push(legacyWallet(w.solflare, "Solflare"))
  if (w.backpack) found.push(legacyWallet(w.backpack, "Backpack"))

  for (const wallet of registeredSolanaWallets()) {
    if (!found.some((existing) => existing.name.toLowerCase() === wallet.name.toLowerCase())) {
      found.push(standardWallet(wallet))
    }
  }
  return found
}

export class SolanaWalletProvider implements WalletProvider {
  readonly kind = "solana" as const

  async listWallets(): Promise<WalletInfo[]> {
    return discoverWallets().map(({ name, icon }) => ({ name, icon }))
  }

  async connectWith(name: string): Promise<WalletSession> {
    const wallet = discoverWallets().find((candidate) => candidate.name === name)
    if (!wallet) {
      throw new Error("WALLET_EXTENSION_UNAVAILABLE")
    }
    const address = await wallet.connect()
    return { address, provider: wallet.name, kind: this.kind }
  }

  async connect(): Promise<WalletSession> {
    const [wallet] = discoverWallets()
    if (!wallet) {
      throw new Error("WALLET_EXTENSION_UNAVAILABLE")
    }
    const address = await wallet.connect()
    return { address, provider: wallet.name, kind: this.kind }
  }

  /** Injected Solana wallets expose exactly one active account. */
  async listAccounts(): Promise<WalletAccountOption[]> {
    const session = await this.connect()
    return [{ address: session.address, name: session.provider, source: session.provider }]
  }

  async connectToAddress(_address: string): Promise<WalletSession> {
    // The wallet controls which account is active; connecting yields it.
    return this.connect()
  }

  /**
   * Silent reconnect (no popup), preferring the stored session's wallet, then
   * the remaining discovered wallets in order. Retries while wallet scripts
   * finish injecting; a not-yet-trusted wallet just falls through.
   */
  async autoConnect(stored: WalletSession | null, retries = 10): Promise<WalletSession | null> {
    const wallets = discoverWallets()

    if (wallets.length > 0) {
      const preferred = wallets.filter((wallet) => wallet.name === stored?.provider)
      const rest = wallets.filter((wallet) => !preferred.includes(wallet))
      for (const wallet of [...preferred, ...rest]) {
        try {
          const address = await wallet.connect({ silent: true })
          return { address, provider: wallet.name, kind: this.kind }
        } catch {
          // Not trusted (yet) — try the next wallet.
        }
      }
      return null
    }

    if (retries > 0) {
      await new Promise((resolve) => setTimeout(resolve, 500))
      return this.autoConnect(stored, retries - 1)
    }
    return null
  }

  async signApiRequest(
    address: string,
    method: string,
    path: string,
    bodyHash: string
  ): Promise<HeadersInit> {
    const wallets = discoverWallets()
    if (wallets.length === 0) {
      throw new Error("WALLET_EXTENSION_UNAVAILABLE")
    }

    // The wallet holding the session's account signs; when no wallet exposes
    // an active address yet, fall back to the first and let it connect.
    const wallet = wallets.find((candidate) => candidate.activeAddress() === address) ?? wallets[0]!
    const activeAddress = wallet.activeAddress()
    if (activeAddress && activeAddress !== address) {
      throw new Error("WALLET_ACCOUNT_NOT_FOUND")
    }

    const { base58Encode } = await import("@polkadot/util-crypto")
    const { payload, timestamp } = composeApiSignaturePayload(method, path, bodyHash)

    // Solana signs the RAW payload bytes (never a hash of them) so the wallet
    // prompt shows readable text; the server verifies ed25519 over these bytes.
    const signature = await wallet.signMessage(new TextEncoder().encode(payload))

    return {
      "X-SS58-Address": address,
      "X-Signature": base58Encode(signature),
      "X-Timestamp": timestamp
    }
  }
}
```

- [ ] **Step 6: Run the full provider spec**

Run: `npx vitest run tests/unit/solanaProvider.spec.ts`
Expected: PASS — all pre-existing tests (discovery order, autoConnect retry/onlyIfTrusted, raw-bytes signing, WALLET_ACCOUNT_NOT_FOUND) plus all new ones.

- [ ] **Step 7: Full check and commit**

Run: `npm run test:unit` then `npm run lint` then `npm run typecheck`
Expected: all pass (typecheck confirms the optional interface members don't break `PolkadotWalletProvider`).

```bash
git add app/services/wallet/types.ts app/services/wallet/solanaProvider.ts tests/unit/solanaProvider.spec.ts
git commit -m "feat: discover arbitrary Solana wallets via Wallet Standard in the provider"
```

---

### Task 3: walletCatalog counts registry wallets as installed

**Files:**
- Modify: `app/services/wallet/walletCatalog.ts:93-103` (`hasInstalledWallet`)
- Modify: `tests/unit/walletCatalog.spec.ts` (append tests + reset hooks)

**Interfaces:**
- Consumes (from Task 1): `registeredSolanaWallets`, `resetSolanaWalletRegistry`; helpers `stubWalletStandardWindow`, `announceWallet`, `fakeStandardWallet`.
- Produces: `hasInstalledWallet("solana")` returns true when the registry holds ≥1 wallet, mirroring the Polkadot `injectedWeb3` catch-all. Signature unchanged (used by Task 4's modal, already a caller).

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/walletCatalog.spec.ts` (also add `afterEach` import from vitest):

```ts
import { afterEach, describe, expect, it, vi } from "vitest"
import { resetSolanaWalletRegistry } from "../../app/services/wallet/solanaWalletRegistry"
import { announceWallet, fakeStandardWallet, stubWalletStandardWindow } from "./helpers/walletStandard"
```

(`initSolanaWalletRegistry()` must run **before** `announceWallet` — the announce event fires immediately, so the registry's listener has to be attached first.)

```ts
describe("walletCatalog with Wallet Standard registry", () => {
  afterEach(() => {
    resetSolanaWalletRegistry()
    vi.unstubAllGlobals()
  })

  it("hasInstalledWallet counts registered standard wallets for solana", () => {
    const win = stubWalletStandardWindow()
    initSolanaWalletRegistry()
    announceWallet(win, fakeStandardWallet())
    expect(hasInstalledWallet("solana", {})).toBe(true)
  })

  it("registry wallets do not count for polkadot", () => {
    const win = stubWalletStandardWindow()
    initSolanaWalletRegistry()
    announceWallet(win, fakeStandardWallet())
    expect(hasInstalledWallet("polkadot", {})).toBe(false)
  })
})
```

with `initSolanaWalletRegistry` added to the registry import line.

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run tests/unit/walletCatalog.spec.ts`
Expected: existing tests PASS; "counts registered standard wallets" FAILS (`hasInstalledWallet` returns false).

- [ ] **Step 3: Implement**

In `app/services/wallet/walletCatalog.ts`, add the import and extend `hasInstalledWallet`:

```ts
import { registeredSolanaWallets } from "./solanaWalletRegistry"
```

```ts
/**
 * True when at least one known wallet of the kind is injected. For Polkadot
 * any `injectedWeb3` entry counts; for Solana any Wallet Standard
 * registration counts — unknown wallets still work with the provider.
 */
export function hasInstalledWallet(kind: WalletKind, host: WalletDetectionHost = detectionHost()): boolean {
  if (kind === "polkadot" && Object.keys(host.injectedWeb3 ?? {}).length > 0) {
    return true
  }
  if (kind === "solana" && registeredSolanaWallets().length > 0) {
    return true
  }
  return detectInstalledWallets(kind, host).size > 0
}
```

- [ ] **Step 4: Run to verify all pass**

Run: `npx vitest run tests/unit/walletCatalog.spec.ts`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm run test:unit` then `npm run lint`
Expected: all pass.

```bash
git add app/services/wallet/walletCatalog.ts tests/unit/walletCatalog.spec.ts
git commit -m "feat: count Wallet Standard registrations as installed Solana wallets"
```

---

### Task 4: Wallet picker modal with single-wallet auto-connect

**Files:**
- Modify: `app/composables/useWallet.ts` (add `listWallets` / `connectWith` passthroughs)
- Modify: `app/components/common/WalletSelectModal.vue` (picker flow)
- Modify: `app/components/common/WalletConnectPrompt.vue:29` (copy)

**Interfaces:**
- Consumes (from Task 2): `WalletInfo` from `services/wallet/types`; provider optionals `listWallets?()` / `connectWith?(name)`.
- Produces: `useWallet()` additionally returns:
  - `listWallets(): Promise<WalletInfo[] | null>` — null when the active provider has no picker support (Polkadot), so the modal feature-detects the flow
  - `connectWith(name: string): Promise<void>` — sets session store + operations log exactly like `connectToAddress`

- [ ] **Step 1: Extend useWallet**

In `app/composables/useWallet.ts`, add the type import:

```ts
import type { WalletInfo } from "../services/wallet/types"
```

add the two functions after `listAccounts`:

```ts
  /** Null when the active provider has no wallet picker (Polkadot) — callers
   *  fall back to the account-list flow. */
  async function listWallets(): Promise<WalletInfo[] | null> {
    const active = provider()
    return active.listWallets ? active.listWallets() : null
  }

  async function connectWith(name: string): Promise<void> {
    try {
      store.setConnecting()
      const active = provider()
      if (!active.connectWith) {
        throw new Error("WALLET_EXTENSION_UNAVAILABLE")
      }
      const session = await active.connectWith(name)
      store.setConnected(session.address, session.provider, session.kind)
      operations.add("wallet", session.address, "success", "Wallet connected")
    } catch (error) {
      store.setRejected()
      operations.add("wallet", "connect", "error", error instanceof Error ? error.message : "Wallet connection failed")
    }
  }
```

and add `listWallets` and `connectWith` to the returned object.

- [ ] **Step 2: Rework WalletSelectModal script**

In `app/components/common/WalletSelectModal.vue`:

Add to imports:

```ts
import type { WalletInfo } from "../../services/wallet/types"
```

Add state next to `accounts`:

```ts
const walletChoices = ref<WalletInfo[] | null>(null)
const selectingWallet = ref("")
```

Add computed helpers next to `connectedAddress`:

```ts
const connectedProviderName = computed(() =>
  wallet.walletStatus.value === "connected" ? wallet.providerName.value || "" : ""
)

function brandForName(name: string): WalletBrandId | null {
  return brandForSource(name)
}

/** Wallet-provided icons are untrusted strings; only data: image URIs render. */
function safeIcon(choice: WalletInfo): string | null {
  return choice.icon?.startsWith("data:image/") ? choice.icon : null
}
```

Replace `loadAccounts` with:

```ts
async function loadAccounts(): Promise<void> {
  isLoading.value = true
  connectError.value = ""
  walletInstalled.value = hasInstalledWallet(settings.walletType)
  installedIds.value = detectInstalledWallets(settings.walletType)

  try {
    const choices = await wallet.listWallets()
    if (choices) {
      // Picker flow (Solana): discovery only — no connect popup on open.
      walletChoices.value = choices
      accounts.value = []
    } else {
      walletChoices.value = null
      accounts.value = await wallet.listAccounts()
    }
  } catch {
    accounts.value = []
  } finally {
    isLoading.value = false
  }

  // Exactly one wallet: connect it immediately, no extra click. On failure
  // the single row stays visible with the inline error for a manual retry.
  if (walletChoices.value?.length === 1 && !isSelecting.value) {
    await connectWallet(walletChoices.value[0]!.name)
  }
}
```

Add `connectWallet` next to `selectAccount`:

```ts
async function connectWallet(name: string): Promise<void> {
  connectError.value = ""
  isSelecting.value = true
  selectingWallet.value = name

  try {
    await wallet.connectWith(name)
  } finally {
    isSelecting.value = false
    selectingWallet.value = ""
  }

  if (wallet.walletStatus.value === "connected") {
    emit("close")
  } else {
    connectError.value = "Connection failed — the wallet declined or the account is no longer available."
  }
}
```

- [ ] **Step 3: Add the picker branch to the template**

In `WalletSelectModal.vue`, insert between the `ParticleLoader` block and the `accounts.length` template:

```html
      <template v-else-if="walletChoices && walletChoices.length">
        <p class="muted" style="margin: 0; font-size: 13px">Choose a wallet to connect.</p>
        <div class="stack" style="max-height: 300px; overflow: auto; gap: 8px">
          <button
            v-for="choice in walletChoices"
            :key="choice.name"
            class="btn wallet-account-btn"
            type="button"
            :disabled="isSelecting"
            @click="connectWallet(choice.name)"
          >
            <ParticleLoader
              v-if="isSelecting && selectingWallet === choice.name"
              size="inline"
              label="Connecting wallet"
              style="min-width: 0"
            />
            <template v-else>
              <WalletBrandIcon
                v-if="brandForName(choice.name)"
                :brand="brandForName(choice.name)!"
                :size="26"
                class="wallet-account-icon"
              />
              <img
                v-else-if="safeIcon(choice)"
                :src="safeIcon(choice)!"
                alt=""
                width="26"
                height="26"
                class="wallet-account-icon wallet-choice-icon"
              />
              <span class="stack" style="gap: 2px; min-width: 0; flex: 1; text-align: left">
                <strong>{{ choice.name }}</strong>
              </span>
              <span v-if="choice.name === connectedProviderName" class="wallet-connected-badge">Connected</span>
            </template>
          </button>
        </div>
      </template>
```

and add to the scoped styles:

```css
.wallet-choice-icon {
  border-radius: 6px;
  object-fit: contain;
}
```

The existing `accounts.length` / `!walletInstalled` / unlock-hint branches stay as they are — with the picker branch first, Solana never reaches the account flow, and "no wallets" still lands on the install cards (Task 3 keeps `walletInstalled` consistent with registry-only wallets).

- [ ] **Step 4: Update the connect prompt copy**

In `app/components/common/WalletConnectPrompt.vue:29`, change:

```ts
      ? "Connect a Solana wallet (Phantom, Solflare, or Backpack) to continue."
```

to:

```ts
      ? "Connect a Solana wallet to continue."
```

- [ ] **Step 5: Full check**

Run: `npm run test:unit` then `npm run lint` then `npm run typecheck`
Expected: all pass. (The modal has no unit specs; typecheck validates the template bindings via vue-tsc.)

- [ ] **Step 6: Commit**

```bash
git add app/composables/useWallet.ts app/components/common/WalletSelectModal.vue app/components/common/WalletConnectPrompt.vue
git commit -m "feat: wallet picker with single-wallet auto-connect in the select modal"
```

---

## Manual smoke (user, real wallets — after all tasks)

1. **Phantom regression:** only Phantom installed → open Connect Wallet → Phantom pops immediately (auto-connect, no wallet click) → profile save signs successfully.
2. **Arbitrary wallet:** install a non-catalog Wallet Standard wallet (e.g. Nightly) → it appears in the picker with its own icon → connect → profile save → signature accepted by profile-api.
3. **Multi-wallet:** two wallets installed → picker lists both, nothing pops until a row is clicked; connected wallet shows the "Connected" badge on reopen.
4. **Auto-reconnect:** refresh after connecting the arbitrary wallet → session silently restores to the same wallet.

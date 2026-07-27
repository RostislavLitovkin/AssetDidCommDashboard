/// <reference types="nuxt/app" />
/// <reference path="../../.nuxt/types/imports.d.ts" />
import { beforeEach, describe, expect, it, vi } from "vitest"
import { createPinia, defineStore, setActivePinia } from "pinia"

// `app/stores/session.ts` calls the bare `defineStore(...)` identifier and
// reads `import.meta.client`, both relying on Nuxt's auto-import/macro
// pipeline (it never imports `defineStore` itself). Outside that pipeline
// neither exists at runtime, so `defineStore` must be stubbed onto the
// global before the module is evaluated — hence the dynamic import below
// instead of a static one. The triple-slash references above pull in the
// same ambient `declare global` types (.nuxt/types/imports.d.ts, for
// `defineStore`) and the `ImportMeta.client` augmentation (nuxt/app) that
// this file's TypeScript program otherwise lacks, since the root
// tsconfig.json's `include` (tests/**/*.ts) replaces rather than merges
// with .nuxt/tsconfig.json's broader `include` once this file drags
// app/stores/session.ts into the program. (Referencing the full
// .nuxt/nuxt.d.ts instead also pulls in .nuxt/types/components.d.ts, which
// drags every .vue component — including one with a pre-existing bad
// `~/app/types/keys` import — into this program too, so only the two
// specific declaration files needed are referenced here.)
vi.stubGlobal("defineStore", defineStore)
const { useSessionStore } = await import("../../app/stores/session")

/**
 * Investigation note (final-review item 2):
 *
 * This suite's vitest.config.ts runs with `environment: "node"` and does not
 * wire in Nuxt's Vite `define` for `import.meta.client` / `import.meta.server`
 * (Nuxt's own client build sets `"import.meta.client": true` via a Vite
 * `define` in @nuxt/vite-builder — see
 * node_modules/@nuxt/vite-builder/dist/index.mjs). A throwaway probe spec
 * confirmed `import.meta.client` evaluates to `undefined` (falsy) under
 * `npx vitest run` in this repo.
 *
 * Both `loadStoredSession()` (called once, inside the store's `state()`
 * factory) and `persistSession()` (called by `setConnected`) start with
 * `if (!import.meta.client) return`, so neither the legacy-session load path
 * (requirements 1 and 2 below: state derived from a pre-existing
 * `rxm.walletSession` value in localStorage) nor the localStorage *write*
 * half of requirement 3 can be exercised for real here — the guard trips
 * before `localStorage` is ever touched, so stubbing `localStorage` via
 * `vi.stubGlobal` (createPinia()/setActivePinia() included) makes no
 * observable difference; the branch is simply dead code in this test
 * environment. Making it live would require adding a Vite `define` for
 * `import.meta.client` to vitest.config.ts (mirroring Nuxt's client-build
 * config) — a suite-wide change outside this fix's scope, and one that risks
 * flipping on other `import.meta.client`-gated code (e.g. settings.ts) that
 * assumes a real `window`/`localStorage`, neither of which exist under
 * `environment: "node"`.
 *
 * What IS exercised for real, unconditionally, is the in-memory action
 * behavior: `setConnected` assigns `walletKind` from its `kind` argument
 * before ever calling the (here dead) `persistSession`. That's what's tested
 * below for requirement 3 — the kind is correctly threaded onto the store's
 * state, which is the input `persistSession` would serialize to JSON if the
 * write path were reachable. The literal "localStorage now contains a JSON
 * string with kind:solana" assertion could not be made without faking it, so
 * it is not included.
 */
describe("useSessionStore — kind handling (requirement 3 only; see note above)", () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it("setConnected(addr, prov, \"solana\") records kind: \"solana\" on the store state", () => {
    const store = useSessionStore()

    store.setConnected("SoLAddr1111111111111111111111111111111111", "Phantom", "solana")

    expect(store.walletKind).toBe("solana")
    expect(store.walletStatus).toBe("connected")
    expect(store.accountAddress).toBe("SoLAddr1111111111111111111111111111111111")
    expect(store.providerName).toBe("Phantom")
  })

  it("setConnected(addr, prov, \"polkadot\") records kind: \"polkadot\" on the store state", () => {
    const store = useSessionStore()

    store.setConnected("5Example", "polkadot-js", "polkadot")

    expect(store.walletKind).toBe("polkadot")
    expect(store.walletStatus).toBe("connected")
  })
})

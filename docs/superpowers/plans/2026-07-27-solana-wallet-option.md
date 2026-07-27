# Solana Wallet Option Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A settings option choosing the wallet family — Solana (default) or Polkadot — with all API signing working through either, behind a `WalletProvider` interface that also consolidates the app's duplicated signing and address-normalization code.

**Architecture:** New `app/services/wallet/` structure: shared `signingCore` (payload composition + body hashing, identical for both schemes), `PolkadotWalletProvider` (current extension code refactored onto the interface, sr25519 signs the blake2 of the payload), `SolanaWalletProvider` (injected Phantom/Solflare/Backpack, ed25519 signs the raw payload), a `resolveWalletProvider` factory as the only construction point, and one `normalizeApiAddress` replacing four scattered helpers. Consumers (`useWallet`, `useBucketsRepository`, auto-connect plugin, pages) stay wallet-agnostic.

**Tech Stack:** Nuxt 4 (SSR off), TypeScript strict, Vitest, `@polkadot/extension-dapp` (Polkadot path), `@polkadot/util-crypto` (blake2 + base58 for BOTH paths — no new dependencies).

**Spec:** `docs/superpowers/specs/2026-07-27-solana-wallet-option-design.md` (approved).

## Global Constraints

- Signature payload for BOTH schemes: `{METHOD}:{path}:{bodyHash}:{timestamp}` where bodyHash = `0x`+UPPERCASE blake2b-128 (via existing `toCSharpHashHex`) or `""` for empty bodies, timestamp = 7-fractional-digit ISO (via existing `formatSignatureTimestamp`).
- **sr25519 signs `blake2AsHex(payload, 128)`** via extension `signRaw` (unchanged behavior — existing tests must keep passing with identical assertions). **Solana signs the raw UTF-8 payload bytes** via injected `signMessage` — never hash before signing on the Solana path.
- Headers for both: `X-SS58-Address` (the wallet's address as-is), `X-Signature` (hex for Polkadot as today; base58 for Solana via `base58Encode`), `X-Timestamp`. The server detects the scheme from the address format — no scheme header.
- Solana wallet discovery order: `window.phantom?.solana` → `window.solflare` → `window.backpack`; provider names "Phantom"/"Solflare"/"Backpack"; no wallet → throw `new Error("WALLET_EXTENSION_UNAVAILABLE")` (exact string — existing UI handles it).
- Settings default `walletType: "solana"`; localStorage key `asset-didcomm.wallet-type`. Stored wallet session (`rxm.walletSession`) gains `kind`; legacy sessions without `kind` are `"polkadot"`; on startup a stored session's kind wins and the setting syncs to it.
- `normalizeApiAddress`: SS58 (any prefix) → prefix-42 re-encode; anything that fails SS58 decode (including Solana base58) → trimmed passthrough.
- No visual redesign — conditional copy only. No new npm dependencies.
- Commands: `npm run typecheck`, `npx vitest run tests/unit/<file> -v`, `npm run test:unit`. Commit after every task; end commit messages with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Shared signing core + address utils

**Files:**
- Create: `app/services/wallet/signingCore.ts`
- Create: `app/services/wallet/addressUtils.ts`
- Test: `tests/unit/signingCore.spec.ts`
- Test: `tests/unit/addressUtils.spec.ts`

**Interfaces:**
- Consumes: `buildSignaturePayload`, `formatSignatureTimestamp`, `toCSharpHashHex` from `app/services/profile/profileSigning.ts` (existing, unchanged).
- Produces (later tasks rely on these exact signatures):
  - `composeApiSignaturePayload(method: string, path: string, bodyHash: string): { payload: string; timestamp: string }`
  - `hashApiBody(rawBody: string): Promise<string>` — `0x`+UPPERCASE blake2b-128 of the raw string
  - `isSolanaAddress(value: string): boolean`
  - `normalizeApiAddress(value: string): string`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/signingCore.spec.ts
import { describe, expect, it, vi } from "vitest"
import { blake2AsHex } from "@polkadot/util-crypto"
import { composeApiSignaturePayload, hashApiBody } from "../../app/services/wallet/signingCore"
import { toCSharpHashHex } from "../../app/services/profile/profileSigning"

describe("composeApiSignaturePayload", () => {
  it("composes METHOD:path:bodyHash:timestamp with the C# :o timestamp form", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-11T22:58:41.735Z"))

    const { payload, timestamp } = composeApiSignaturePayload("POST", "/graphql", "0xABC")

    expect(timestamp).toBe("2026-07-11T22:58:41.7350000Z")
    expect(payload).toBe("POST:/graphql:0xABC:2026-07-11T22:58:41.7350000Z")
    vi.useRealTimers()
  })

  it("supports the empty body-hash segment", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-11T22:58:41.735Z"))
    const { payload } = composeApiSignaturePayload("POST", "/api/profiles/x/image", "")
    expect(payload).toBe("POST:/api/profiles/x/image::2026-07-11T22:58:41.7350000Z")
    vi.useRealTimers()
  })
})

describe("hashApiBody", () => {
  it("returns the 0x+UPPERCASE blake2b-128 of the raw body", async () => {
    const raw = "{\"query\":\"mutation { x }\"}"
    const expected = toCSharpHashHex(blake2AsHex(raw, 128))
    expect(await hashApiBody(raw)).toBe(expected)
    expect(await hashApiBody(raw)).toMatch(/^0x[0-9A-F]{32}$/)
  })
})
```

```ts
// tests/unit/addressUtils.spec.ts
import { describe, expect, it } from "vitest"
import { encodeAddress } from "@polkadot/util-crypto"
import { isSolanaAddress, normalizeApiAddress } from "../../app/services/wallet/addressUtils"

// 32 known bytes -> valid ss58 in several prefixes, and a base58 "Solana" form.
const KEY = new Uint8Array(Array.from({ length: 32 }, (_, i) => i + 1))
const SS58_PREFIX0 = encodeAddress(KEY, 0)
const SS58_PREFIX42 = encodeAddress(KEY, 42)
// A real Solana address shape: raw base58 of 32 bytes (no ss58 checksum).
const SOLANA = "4Nd1mYQKb2xhkfqAwtLcqEeGiPZKPXTSVKZH1B9DYIn1" // any 43-44 char base58 of 32 bytes

describe("isSolanaAddress", () => {
  it("rejects SS58 addresses", () => {
    expect(isSolanaAddress(SS58_PREFIX42)).toBe(false)
  })
  it("accepts raw base58 32-byte addresses", () => {
    expect(isSolanaAddress(SOLANA)).toBe(true)
  })
  it("rejects garbage and empty", () => {
    expect(isSolanaAddress("hello world")).toBe(false)
    expect(isSolanaAddress("")).toBe(false)
  })
})

describe("normalizeApiAddress", () => {
  it("re-encodes any SS58 prefix to 42", () => {
    expect(normalizeApiAddress(SS58_PREFIX0)).toBe(SS58_PREFIX42)
    expect(normalizeApiAddress(` ${SS58_PREFIX42} `)).toBe(SS58_PREFIX42)
  })
  it("passes Solana base58 addresses through unchanged", () => {
    expect(normalizeApiAddress(SOLANA)).toBe(SOLANA)
  })
  it("passes unparseable input through trimmed", () => {
    expect(normalizeApiAddress("  not-an-address ")).toBe("not-an-address")
  })
})
```

NOTE for the implementer: if the hardcoded `SOLANA` constant turns out not to base58-decode to exactly 32 bytes, replace it with a computed one: `base58Encode(KEY)` (import `base58Encode` from `@polkadot/util-crypto`) — that is by construction a 32-byte base58 string that is not valid SS58. Prefer the computed form if in doubt.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/signingCore.spec.ts tests/unit/addressUtils.spec.ts -v`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

```ts
// app/services/wallet/signingCore.ts
/**
 * Wallet-agnostic half of API request signing. Both the sr25519 and Solana
 * schemes sign the SAME payload string; only the signing of that payload
 * differs (sr25519 signs its blake2-128 hash, Solana signs the raw bytes).
 */
import {
  buildSignaturePayload,
  formatSignatureTimestamp,
  toCSharpHashHex
} from "../profile/profileSigning"

export interface ComposedSignaturePayload {
  payload: string
  timestamp: string
}

export function composeApiSignaturePayload(
  method: string,
  path: string,
  bodyHash: string
): ComposedSignaturePayload {
  const timestamp = formatSignatureTimestamp(new Date())
  return { payload: buildSignaturePayload(method, path, bodyHash, timestamp), timestamp }
}

/** Blake2b-128 of the raw body, in the API's 0x+UPPERCASE form. */
export async function hashApiBody(rawBody: string): Promise<string> {
  const { blake2AsHex, cryptoWaitReady } = await import("@polkadot/util-crypto")
  await cryptoWaitReady()
  return toCSharpHashHex(blake2AsHex(rawBody, 128))
}
```

```ts
// app/services/wallet/addressUtils.ts
/**
 * One address normalizer for everything that talks to the profile API.
 * The API stores addresses as sent; the dashboard convention is SS58 prefix 42
 * for Polkadot identities and raw base58 for Solana identities.
 */
import { base58Decode, decodeAddress, encodeAddress } from "@polkadot/util-crypto"

/** True when the value is a raw base58 32-byte key (Solana) and NOT valid SS58. */
export function isSolanaAddress(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) {
    return false
  }

  try {
    decodeAddress(trimmed)
    return false
  } catch {
    // not SS58 — fall through to the base58 check
  }

  try {
    return base58Decode(trimmed).length === 32
  } catch {
    return false
  }
}

/** SS58 (any prefix) -> prefix 42; Solana base58 and anything else -> trimmed passthrough. */
export function normalizeApiAddress(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    return trimmed
  }

  try {
    return encodeAddress(decodeAddress(trimmed), 42)
  } catch {
    return trimmed
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/signingCore.spec.ts tests/unit/addressUtils.spec.ts -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/services/wallet/signingCore.ts app/services/wallet/addressUtils.ts tests/unit/signingCore.spec.ts tests/unit/addressUtils.spec.ts
git commit -m "feat: shared wallet signing core and API address utils"
```

---

### Task 2: Wallet types + PolkadotWalletProvider

**Files:**
- Create: `app/services/wallet/types.ts`
- Create: `app/services/wallet/polkadotProvider.ts`
- Modify: `tests/unit/useWallet.spec.ts` (rewrite against the new provider; keep the exact payload assertions)
- Reference (do NOT delete yet): `app/services/wallet/extensionProvider.ts` — consumers still import it until Task 4.

**Interfaces:**
- Consumes: `composeApiSignaturePayload` (Task 1); `web3Accounts`, `web3Enable`, `web3FromAddress` from `@polkadot/extension-dapp`.
- Produces:

```ts
// types.ts — exact contents
export type WalletKind = "solana" | "polkadot"

export interface WalletSession {
  address: string
  provider: string
  kind: WalletKind
}

export interface WalletAccountOption {
  address: string
  name: string
  source: string
}

export interface WalletProvider {
  readonly kind: WalletKind
  listAccounts(): Promise<WalletAccountOption[]>
  connect(): Promise<WalletSession>
  connectToAddress(address: string): Promise<WalletSession>
  /** Silent reconnect on startup; never shows a popup. Returns null when unavailable. */
  autoConnect(stored: WalletSession | null): Promise<WalletSession | null>
  /**
   * Sign one API request. bodyHash is precomputed by the caller (hashApiBody
   * for JSON/raw bodies, "" for empty bodies) — identical for both schemes.
   */
  signApiRequest(address: string, method: string, path: string, bodyHash: string): Promise<HeadersInit>
}
```

- `class PolkadotWalletProvider implements WalletProvider` with `kind = "polkadot"`.

- [ ] **Step 1: Rewrite the signing tests (failing first)**

Replace the entire contents of `tests/unit/useWallet.spec.ts`. The three existing tests carry the golden sr25519 assertions — they are PRESERVED, only re-targeted: the body-hash step now happens in the caller (covered by Task 1's `hashApiBody` test), so these tests call `signApiRequest` with the bodyHash directly.

```ts
// tests/unit/useWallet.spec.ts
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
```

IMPORTANT: `signingCore.ts` imports `formatSignatureTimestamp` etc. statically from `profileSigning` (unmocked — good), but calls `blake2AsHex` only inside `hashApiBody`, which these tests do not exercise; the `@polkadot/util-crypto` mock above therefore doesn't break `composeApiSignaturePayload`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/useWallet.spec.ts -v`
Expected: FAIL — `polkadotProvider` module not found.

- [ ] **Step 3: Create `types.ts` (exact contents above) and `polkadotProvider.ts`**

Port from `app/services/wallet/extensionProvider.ts` (read it first — `listAccounts`, `connect`, `connectToAddress`, `autoConnect` move over almost verbatim):

```ts
// app/services/wallet/polkadotProvider.ts
import { web3Accounts, web3Enable, web3FromAddress } from "@polkadot/extension-dapp"
import { composeApiSignaturePayload } from "./signingCore"
import type { WalletAccountOption, WalletProvider, WalletSession } from "./types"

export class PolkadotWalletProvider implements WalletProvider {
  readonly kind = "polkadot" as const

  private async ensureEnabled(): Promise<void> {
    const extensions = await web3Enable("realXmessage Dashboard")
    if (!extensions.length) {
      throw new Error("WALLET_EXTENSION_UNAVAILABLE")
    }
  }

  async listAccounts(): Promise<WalletAccountOption[]> {
    await this.ensureEnabled()
    const accounts = await web3Accounts()
    return accounts.map((account) => ({
      address: account.address,
      name: account.meta.name || "Unnamed",
      source: account.meta.source || "unknown"
    }))
  }

  async connect(): Promise<WalletSession> {
    const [account] = await this.listAccounts()
    if (!account) {
      throw new Error("WALLET_CONNECTION_REJECTED")
    }
    return { address: account.address, provider: account.source, kind: this.kind }
  }

  async connectToAddress(address: string): Promise<WalletSession> {
    const accounts = await this.listAccounts()
    const selected = accounts.find((account) => account.address === address)
    if (!selected) {
      throw new Error("WALLET_ACCOUNT_NOT_FOUND")
    }
    return { address: selected.address, provider: selected.source, kind: this.kind }
  }

  /**
   * Silent reconnect: restore the stored address or fall back to the first
   * account. Retries while the extension finishes injecting (~5s max, matching
   * the old plugin-level polling).
   */
  async autoConnect(stored: WalletSession | null, retries = 10): Promise<WalletSession | null> {
    let extensions: Awaited<ReturnType<typeof web3Enable>>
    try {
      extensions = await web3Enable("realXmessage Dashboard")
    } catch {
      extensions = []
    }

    if (extensions.length) {
      if (stored?.address) {
        try {
          return await this.connectToAddress(stored.address)
        } catch {
          // Address no longer available — fall through to first account
        }
      }

      try {
        const [account] = await this.listAccounts()
        if (account) {
          return { address: account.address, provider: account.source, kind: this.kind }
        }
      } catch {
        // fall through to retry
      }
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
    await this.ensureEnabled()
    const { blake2AsHex, cryptoWaitReady } = await import("@polkadot/util-crypto")
    await cryptoWaitReady()

    const injector = await web3FromAddress(address)
    if (!injector.signer.signRaw) {
      throw new Error("WALLET_SIGNING_UNAVAILABLE")
    }

    const { payload, timestamp } = composeApiSignaturePayload(method, path, bodyHash)

    // The extension wraps signRaw bytes in <Bytes>...</Bytes>, which is the
    // validator's fallback branch. sr25519 signs the blake2-128 of the payload.
    const signed = await injector.signer.signRaw({
      address,
      data: blake2AsHex(payload, 128),
      type: "bytes"
    })

    return {
      "X-SS58-Address": address,
      "X-Signature": signed.signature,
      "X-Timestamp": timestamp
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/useWallet.spec.ts -v`
Expected: PASS (4 tests). Then `npm run typecheck` — PASS (extensionProvider.ts still exists and still compiles; nothing imports the new provider yet).

- [ ] **Step 5: Commit**

```bash
git add app/services/wallet/types.ts app/services/wallet/polkadotProvider.ts tests/unit/useWallet.spec.ts
git commit -m "feat: WalletProvider interface and Polkadot implementation"
```

---

### Task 3: SolanaWalletProvider

**Files:**
- Create: `app/services/wallet/solanaProvider.ts`
- Test: `tests/unit/solanaProvider.spec.ts`

**Interfaces:**
- Consumes: `composeApiSignaturePayload` (Task 1), `WalletProvider`/`WalletSession`/`WalletAccountOption` (Task 2), `base58Encode` from `@polkadot/util-crypto`.
- Produces: `class SolanaWalletProvider implements WalletProvider` with `kind = "solana"`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/solanaProvider.spec.ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/solanaProvider.spec.ts -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// app/services/wallet/solanaProvider.ts
import { composeApiSignaturePayload } from "./signingCore"
import type { WalletAccountOption, WalletProvider, WalletSession } from "./types"

/** The Phantom-style injected provider surface (also matched by Solflare/Backpack). */
interface SolanaInjectedProvider {
  publicKey?: { toBase58(): string } | null
  connect(options?: { onlyIfTrusted?: boolean }): Promise<{ publicKey?: { toBase58(): string } } | void>
  signMessage(message: Uint8Array, display?: "utf8" | "hex"): Promise<{ signature: Uint8Array } | Uint8Array>
}

interface DiscoveredWallet {
  provider: SolanaInjectedProvider
  name: string
}

function findInjectedWallet(): DiscoveredWallet | null {
  if (typeof window === "undefined") {
    return null
  }

  const w = window as unknown as {
    phantom?: { solana?: SolanaInjectedProvider }
    solflare?: SolanaInjectedProvider
    backpack?: SolanaInjectedProvider
  }

  if (w.phantom?.solana) return { provider: w.phantom.solana, name: "Phantom" }
  if (w.solflare) return { provider: w.solflare, name: "Solflare" }
  if (w.backpack) return { provider: w.backpack, name: "Backpack" }
  return null
}

function resolveAddress(
  wallet: DiscoveredWallet,
  connectResult: { publicKey?: { toBase58(): string } } | void
): string {
  // Phantom resolves connect() with the publicKey; Solflare resolves void and
  // sets .publicKey on the provider instead. Accept both.
  const key = connectResult?.publicKey ?? wallet.provider.publicKey
  const address = key?.toBase58()
  if (!address) {
    throw new Error("WALLET_CONNECTION_REJECTED")
  }
  return address
}

export class SolanaWalletProvider implements WalletProvider {
  readonly kind = "solana" as const

  private requireWallet(): DiscoveredWallet {
    const wallet = findInjectedWallet()
    if (!wallet) {
      throw new Error("WALLET_EXTENSION_UNAVAILABLE")
    }
    return wallet
  }

  async connect(): Promise<WalletSession> {
    const wallet = this.requireWallet()
    const result = await wallet.provider.connect()
    return { address: resolveAddress(wallet, result), provider: wallet.name, kind: this.kind }
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
   * Silent reconnect via onlyIfTrusted (no popup). Retries while the wallet
   * script finishes injecting; a not-yet-trusted wallet resolves to null.
   */
  async autoConnect(stored: WalletSession | null, retries = 10): Promise<WalletSession | null> {
    const wallet = findInjectedWallet()

    if (wallet) {
      try {
        const result = await wallet.provider.connect({ onlyIfTrusted: true })
        return { address: resolveAddress(wallet, result), provider: wallet.name, kind: this.kind }
      } catch {
        return null
      }
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
    const wallet = this.requireWallet()
    const { base58Encode } = await import("@polkadot/util-crypto")
    const { payload, timestamp } = composeApiSignaturePayload(method, path, bodyHash)

    // Solana signs the RAW payload bytes (never a hash of them) so the wallet
    // prompt shows readable text; the server verifies ed25519 over these bytes.
    const result = await wallet.provider.signMessage(new TextEncoder().encode(payload), "utf8")
    const signature = result instanceof Uint8Array ? result : result.signature

    return {
      "X-SS58-Address": address,
      "X-Signature": base58Encode(signature),
      "X-Timestamp": timestamp
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/solanaProvider.spec.ts -v`
Expected: PASS (10 tests). Note: this spec does NOT mock `@polkadot/util-crypto` (it uses the real `base58Encode` in both test and implementation).

- [ ] **Step 5: Commit**

```bash
git add app/services/wallet/solanaProvider.ts tests/unit/solanaProvider.spec.ts
git commit -m "feat: Solana injected-wallet provider with raw-payload ed25519 signing"
```

---

### Task 4: Factory, settings/session model, consumer migration

**Files:**
- Create: `app/services/wallet/resolveWalletProvider.ts`
- Modify: `app/stores/settings.ts` (add `walletType`)
- Modify: `app/stores/session.ts` (session gains `kind`)
- Modify: `app/composables/useWallet.ts` (factory + bodyHash-based signing)
- Modify: `app/composables/useBucketsRepository.ts` (factory)
- Modify: `app/plugins/walletAutoConnect.client.ts` (generic autoConnect)
- Modify: `app/services/buckets/types.ts:38` (comment referencing WalletExtensionProvider)
- Delete: `app/services/wallet/extensionProvider.ts` (all consumers migrate in this task)
- Test: `tests/unit/resolveWalletProvider.spec.ts`

**Interfaces:**
- Consumes: `PolkadotWalletProvider` (Task 2), `SolanaWalletProvider` (Task 3), `hashApiBody` (Task 1), `WalletKind`/`WalletProvider`/`WalletSession` (Task 2).
- Produces:
  - `resolveWalletProvider(kind: WalletKind): WalletProvider`
  - settings store: `walletType: WalletKind` state (default `"solana"`), `setWalletType(kind: WalletKind): void` action, persisted under `asset-didcomm.wallet-type`, loaded in `initialize()`.
  - session store: `walletKind: WalletKind` state; `setConnected(accountAddress: string, providerName: string, kind: WalletKind)`; stored payload `{ address, provider, kind }` with legacy fallback `kind: "polkadot"`.
  - `useWallet()` keeps its public shape (`walletStatus`, `accountAddress`, `providerName`, `connect`, `listAccounts`, `connectToAddress`, `signProfileRequest`, `signGraphqlRequest`, `disconnect`) — page consumers (profile pages, AppShell, WalletConnectPrompt, indexed-bucket) need NO changes in this task.

- [ ] **Step 1: Write the failing factory test**

```ts
// tests/unit/resolveWalletProvider.spec.ts
import { describe, expect, it } from "vitest"
import { resolveWalletProvider } from "../../app/services/wallet/resolveWalletProvider"
import { PolkadotWalletProvider } from "../../app/services/wallet/polkadotProvider"
import { SolanaWalletProvider } from "../../app/services/wallet/solanaProvider"

describe("resolveWalletProvider", () => {
  it("maps solana to the Solana provider", () => {
    const provider = resolveWalletProvider("solana")
    expect(provider).toBeInstanceOf(SolanaWalletProvider)
    expect(provider.kind).toBe("solana")
  })

  it("maps polkadot to the Polkadot provider", () => {
    const provider = resolveWalletProvider("polkadot")
    expect(provider).toBeInstanceOf(PolkadotWalletProvider)
    expect(provider.kind).toBe("polkadot")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/resolveWalletProvider.spec.ts -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the factory**

```ts
// app/services/wallet/resolveWalletProvider.ts
import { PolkadotWalletProvider } from "./polkadotProvider"
import { SolanaWalletProvider } from "./solanaProvider"
import type { WalletKind, WalletProvider } from "./types"

/** The only construction point for wallet providers. */
export function resolveWalletProvider(kind: WalletKind): WalletProvider {
  return kind === "polkadot" ? new PolkadotWalletProvider() : new SolanaWalletProvider()
}
```

Run: `npx vitest run tests/unit/resolveWalletProvider.spec.ts -v` — PASS.

- [ ] **Step 4: Settings store — `walletType`**

In `app/stores/settings.ts`, following the file's exact existing per-key pattern:

```ts
// with the other storage keys (top of file):
const WALLET_TYPE_STORAGE_KEY = "asset-didcomm.wallet-type"

// with the other imports:
import type { WalletKind } from "../services/wallet/types"

// with the other loaders:
function loadStoredWalletType(): WalletKind {
  if (!import.meta.client) {
    return "solana"
  }

  const raw = window.localStorage.getItem(WALLET_TYPE_STORAGE_KEY)
  return raw === "polkadot" ? "polkadot" : "solana"
}
```

State: add `walletType: "solana" as WalletKind`. In `initialize()`: add `this.walletType = loadStoredWalletType()` (alongside the other loads). Actions: add

```ts
    setWalletType(kind: WalletKind): void {
      this.walletType = kind

      if (import.meta.client) {
        window.localStorage.setItem(WALLET_TYPE_STORAGE_KEY, kind)
      }
    },
```

- [ ] **Step 5: Session store — session kind**

In `app/stores/session.ts`:

```ts
import type { WalletKind } from "../services/wallet/types"

type StoredWalletSession = {
  address: string
  provider: string
  kind: WalletKind
}
```

In `loadStoredSession()`, after the existing validation: `const kind: WalletKind = parsed.kind === "solana" ? "solana" : "polkadot"` and return `{ address: parsed.address, provider: parsed.provider, kind }` (legacy sessions have no `kind` → `"polkadot"`, the only source that could have written them). `persistSession(address, provider, kind)` stores all three. State: add `walletKind: (stored?.kind ?? "polkadot") as WalletKind`. `setConnected(accountAddress: string, providerName: string, kind: WalletKind)` sets `this.walletKind = kind` and persists it; `disconnect()` leaves `walletKind` as-is (harmless). Update the two existing `setConnected` callers in this task's other files (below) — a repo-wide grep for `setConnected(` must show only 3-arg calls when done.

- [ ] **Step 6: `useWallet` — factory + bodyHash signing**

Replace the provider construction and the two signing functions in `app/composables/useWallet.ts`:

```ts
import { resolveWalletProvider } from "../services/wallet/resolveWalletProvider"
import { hashApiBody } from "../services/wallet/signingCore"
import type { ProfilePayloadBody } from "../services/profile/profileSigning"
import { useSettingsStore } from "../stores/settings"

export function useWallet() {
  const store = useSessionStore()
  const operations = useOperationsStore()
  const settings = useSettingsStore()
  settings.initialize()

  function provider() {
    return resolveWalletProvider(settings.walletType)
  }

  async function connect(): Promise<void> {
    try {
      store.setConnecting()
      const session = await provider().connect()
      store.setConnected(session.address, session.provider, session.kind)
      operations.add("wallet", session.address, "success", "Wallet connected")
    } catch (error) {
      store.setRejected()
      operations.add("wallet", "connect", "error", error instanceof Error ? error.message : "Wallet connection failed")
    }
  }
  // connectToAddress: same change — provider().connectToAddress(address), then
  // store.setConnected(session.address, session.provider, session.kind)
  // listAccounts: return provider().listAccounts()
  // disconnect: unchanged

  async function signProfileRequest(
    method: "POST" | "PUT",
    path: string,
    body: ProfilePayloadBody
  ): Promise<HeadersInit> {
    const address = store.accountAddress
    if (!address) {
      throw new Error("Connect a wallet before saving your profile")
    }

    const bodyHash = body.kind === "empty" ? "" : await hashApiBody(body.canonicalJson)
    return provider().signApiRequest(address, method, path, bodyHash)
  }

  async function signGraphqlRequest(address: string, rawBody: string): Promise<HeadersInit> {
    return provider().signApiRequest(address, "POST", "/graphql", await hashApiBody(rawBody))
  }
  // return object unchanged
}
```

- [ ] **Step 7: `useBucketsRepository` — factory**

Replace the provider lines in `app/composables/useBucketsRepository.ts`:

```ts
import { resolveWalletProvider } from "../services/wallet/resolveWalletProvider"
import { hashApiBody } from "../services/wallet/signingCore"
import { useSettingsStore } from "../stores/settings"
// remove: import { WalletExtensionProvider } from "../services/wallet/extensionProvider"

export function useBucketsRepository(): BucketsRepository {
  const config = useRuntimeConfig()
  const settings = useSettingsStore()
  settings.initialize()

  return new BucketsRepository({
    apiUrl: String(config.public.profileApiUrl),
    pinataConfig: { /* unchanged */ },
    sign: async (address, rawBody) =>
      resolveWalletProvider(settings.walletType).signApiRequest(
        address,
        "POST",
        "/graphql",
        await hashApiBody(rawBody)
      )
  })
}
```

Also update the comment at `app/services/buckets/types.ts:38` to: `/** Signs a raw GraphQL body for \`address\`. Wire via resolveWalletProvider(...).signApiRequest. */`

- [ ] **Step 8: Auto-connect plugin — generic**

Replace the body of `app/plugins/walletAutoConnect.client.ts`:

```ts
import { resolveWalletProvider } from "../services/wallet/resolveWalletProvider"
import { useSessionStore } from "../stores/session"
import { useSettingsStore } from "../stores/settings"
import { useOperationsStore } from "../stores/operations"
import type { WalletSession } from "../services/wallet/types"

export default defineNuxtPlugin(async () => {
  if (!import.meta.client) {
    return
  }

  const session = useSessionStore()
  const settings = useSettingsStore()
  const operations = useOperationsStore()
  settings.initialize()

  // A stored session's kind wins; sync the setting so the UI reflects reality.
  const stored: WalletSession | null = session.accountAddress
    ? { address: session.accountAddress, provider: session.providerName, kind: session.walletKind }
    : null
  const kind = stored?.kind ?? settings.walletType
  if (settings.walletType !== kind) {
    settings.setWalletType(kind)
  }

  const provider = resolveWalletProvider(kind)
  const restored = await provider.autoConnect(stored)

  if (restored) {
    session.setConnected(restored.address, restored.provider, restored.kind)
    operations.add("wallet", restored.address, "success", "Wallet auto-connected")
  } else {
    session.disconnect()
    operations.add("wallet", "session", "error", "Wallet unavailable")
  }
})
```

(The old plugin's 5-second polling now lives inside each provider's `autoConnect` retries.)

- [ ] **Step 9: Delete the old provider and verify**

```bash
git rm app/services/wallet/extensionProvider.ts
```

Run: `grep -rn "extensionProvider\|WalletExtensionProvider" app/ tests/` — expected: no matches.
Run: `npm run typecheck && npm run test:unit` — both PASS.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: wallet provider factory, walletType setting, per-kind sessions"
```

---

### Task 5: Settings UI + wallet-aware connect copy

**Files:**
- Modify: `app/pages/settings.vue` (new "Wallet" section, placed FIRST, above "Chain Configuration")
- Modify: `app/components/common/WalletConnectPrompt.vue` (wallet-aware default copy + empty-state message)

**Interfaces:**
- Consumes: `settings.walletType`, `settings.setWalletType(kind)` (Task 4), `useWallet().disconnect`, session store `walletStatus`.

- [ ] **Step 1: Settings page section**

In `app/pages/settings.vue` script setup, add:

```ts
import { useSessionStore } from "../stores/session"
import { useWallet } from "../composables/useWallet"
import type { WalletKind } from "../services/wallet/types"

const sessionStore = useSessionStore()
const wallet = useWallet()

const WALLET_TYPE_OPTIONS: Array<{ value: WalletKind; name: string; hint: string }> = [
  { value: "solana", name: "Solana", hint: "Phantom, Solflare, Backpack" },
  { value: "polkadot", name: "Polkadot", hint: "Browser extension (polkadot.js compatible)" }
]

function selectWalletType(kind: WalletKind): void {
  if (kind === settings.walletType) {
    return
  }

  settings.setWalletType(kind)

  if (sessionStore.walletStatus === "connected") {
    wallet.disconnect()
  }
}
```

Template — insert as the FIRST section inside `<main class="stack">`, before "Chain Configuration", following the page's existing card/section idiom (reuse the `.swatch`-style option buttons pattern with plain text, no color chip):

```html
    <section class="card stack" style="gap: 10px">
      <h4 style="margin: 0; font-size: 16px;">Wallet</h4>
      <span style="font-weight: 600; font-size: 14px;">Wallet type</span>
      <div class="swatch-row">
        <button
          v-for="option in WALLET_TYPE_OPTIONS"
          :key="option.value"
          type="button"
          class="wallet-option"
          :class="{ 'wallet-option-active': option.value === settings.walletType }"
          :aria-pressed="option.value === settings.walletType"
          @click="selectWalletType(option.value)"
        >
          <strong>{{ option.name }}</strong>
          <span class="muted" style="font-size: 12px">{{ option.hint }}</span>
        </button>
      </div>
      <span class="muted" style="font-size: 13px;">
        Which wallet family the app uses for your identity and request signing.
        Switching disconnects the currently connected wallet.
      </span>
    </section>
```

Style (scoped, alongside the existing `.swatch` rules):

```css
.wallet-option {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 10px 14px;
  border: 1px solid var(--border-default);
  border-radius: 10px;
  background: var(--surface-card);
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
}

.wallet-option:hover,
.wallet-option:focus-visible {
  border-color: var(--color-primary);
}

.wallet-option-active {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary) 30%, transparent);
}
```

- [ ] **Step 2: WalletConnectPrompt wallet-aware copy**

In `app/components/common/WalletConnectPrompt.vue`: the `description` prop keeps working when pages pass one; only the DEFAULT and the empty-state line become wallet-aware.

```ts
import { useSettingsStore } from "../../stores/settings"

const settings = useSettingsStore()
settings.initialize()

const effectiveDescription = computed(() =>
  props.description !== DEFAULT_DESCRIPTION
    ? props.description
    : settings.walletType === "solana"
      ? "Connect a Solana wallet (Phantom, Solflare, or Backpack) to continue."
      : "Connect the Polkadot browser extension to continue."
)

const noWalletsMessage = computed(() =>
  settings.walletType === "solana"
    ? "No Solana wallet found. Install Phantom, Solflare, or Backpack."
    : "No Polkadot extension accounts found. Install and unlock a polkadot.js-compatible extension."
)
```

Concretely: extract the current default `description: "Connect your wallet to continue."` into a `const DEFAULT_DESCRIPTION = "Connect your wallet to continue."` used in `withDefaults`, bind the template's description paragraph to `effectiveDescription`, and replace the hardcoded `<p v-else ...>No wallets found.</p>` with `{{ noWalletsMessage }}`. Import `computed` from vue (already imported? check — the file currently imports only `ref`; add `computed`).

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run test:unit`
Expected: PASS. Then `npm run dev` and eyeball `/settings`: the Wallet section renders first, defaults to Solana on a fresh profile (clear localStorage), switching shows immediately and disconnects a connected wallet.

- [ ] **Step 4: Commit**

```bash
git add app/pages/settings.vue app/components/common/WalletConnectPrompt.vue
git commit -m "feat: wallet type setting UI and wallet-aware connect copy"
```

---

### Task 6: Address consolidation + final verification

**Files:**
- Modify: `app/services/profile/avatarResolver.ts` (delete `toSs58Prefix42`, use `normalizeApiAddress` internally if it referenced it)
- Modify: `app/pages/indexed-bucket/[id]/index.vue:6,507` (import + call site)
- Modify: `app/pages/messages/bucket/[id]/index.vue:10,505` (import + call site)
- Modify: `app/pages/messages/bucket/[id]/info.vue:449,462-466` (delete local `toSs58Prefix42`, switch call site)
- Modify: `app/pages/messages/bucket/add-member/[id].vue:18-24,121,174,261` (delete `convertToPrefix42`, switch 3 call sites)
- Modify: `app/pages/messages/my-buckets.vue:62-74,141` (delete `resolveApiAddress`, switch call site; remove now-unused `decodeAddress`/`encodeAddress` imports if nothing else uses them)
- Modify: `app/composables/useAddress.ts:56-65` (`addressesEqual` base58 case-sensitivity)
- Test: extend `tests/unit/addressUtils.spec.ts`

**Interfaces:**
- Consumes: `normalizeApiAddress`, `isSolanaAddress` (Task 1).

- [ ] **Step 1: Write the failing test for the `addressesEqual` fix**

There is no existing useAddress spec — add the case to `tests/unit/addressUtils.spec.ts` as a behavioral note test on `isSolanaAddress` usage, and fix `useAddress` by inspection (it has no test harness for Pinia stores; the change is 3 lines):

```ts
// append to tests/unit/addressUtils.spec.ts
describe("base58 case sensitivity contract", () => {
  it("distinct base58 addresses differing only by case are different identities", () => {
    // documents why addressesEqual must NOT lowercase base58 addresses
    const a = "4Nd1mYQKb2xhkfqAwtLcqEeGiPZKPXTSVKZH1B9DYIn1"
    const b = a.toLowerCase()
    expect(a).not.toBe(b)
    expect(isSolanaAddress(a) && a === b).toBe(false)
  })
})
```

- [ ] **Step 2: Fix `addressesEqual`**

In `app/composables/useAddress.ts`, replace the fallback compare:

```ts
import { isSolanaAddress } from "../services/wallet/addressUtils"

  function addressesEqual(left: string, right: string): boolean {
    const leftHex = toPublicKeyHex(left)
    const rightHex = toPublicKeyHex(right)

    if (leftHex && rightHex) {
      return leftHex === rightHex
    }

    // base58 is case-sensitive — never lowercase Solana addresses.
    if (isSolanaAddress(left) || isSolanaAddress(right)) {
      return left.trim() === right.trim()
    }

    return left.trim().toLowerCase() === right.trim().toLowerCase()
  }
```

- [ ] **Step 3: Swap the four normalization helpers**

For each file, delete the local helper and import `normalizeApiAddress` from the wallet service (adjust relative depth per file):

| File | Delete | Replace calls |
|---|---|---|
| `app/services/profile/avatarResolver.ts` | `export function toSs58Prefix42` (lines ~5-10) | internal uses (if any) → `normalizeApiAddress`; keep other exports untouched |
| `app/pages/indexed-bucket/[id]/index.vue` | import of `toSs58Prefix42` (line 6) | `toSs58Prefix42(addr)` at ~507 → `normalizeApiAddress(addr)` |
| `app/pages/messages/bucket/[id]/index.vue` | import of `toSs58Prefix42` (line 10) | call at ~505 → `normalizeApiAddress(address)` |
| `app/pages/messages/bucket/[id]/info.vue` | local `function toSs58Prefix42` (~462-466) | call at ~449 → `normalizeApiAddress(address)` |
| `app/pages/messages/bucket/add-member/[id].vue` | `function convertToPrefix42` (~18-24) | calls at ~121, ~174, ~261 → `normalizeApiAddress(...)`; drop now-unused `decodeAddress`/`encodeAddress` imports if orphaned |
| `app/pages/messages/my-buckets.vue` | `function resolveApiAddress` (~62-74) | call at ~141 → `normalizeApiAddress(session.accountAddress)`; drop orphaned `decodeAddress`/`encodeAddress` imports (KEEP `base64url` and the viewer-key logic) |

After the sweep: `grep -rn "toSs58Prefix42\|convertToPrefix42\|resolveApiAddress" app/` — expected: no matches.

- [ ] **Step 4: Full verification**

```bash
npm run typecheck
npm run test
npm run generate
```

Expected: all PASS. Bundle check: `grep -l "polkadot" .output/public/_nuxt/*.js` chunks may include extension-dapp/util-crypto (expected); nothing new.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: consolidate API address normalization, base58-safe equality"
```

---

## Manual smoke checklist (human, after all tasks)

1. Fresh profile (clear localStorage) → settings shows Solana selected by default.
2. With Phantom installed: connect → address shows base58; save profile; create namespace → bucket → send message (one `signMessage` prompt showing readable `POST:/graphql:0x…` text); reload → auto-reconnects silently.
3. Switch setting to Polkadot → current wallet disconnects → connect extension account → all of the above still works (sr25519 path unchanged).
4. Legacy check: seed `localStorage["rxm.walletSession"]` without a `kind` field → app treats it as Polkadot and syncs the setting.
5. Mixed bucket: add a member by their Solana address from a Polkadot session (and vice versa) — both render in member lists with profiles/avatars.

## Plan Self-Review (completed)

- **Spec coverage:** architecture → Tasks 1-4; server contract (raw-payload ed25519, base58 signature, same payload string) → Task 3 with exact byte-level tests; settings/session model incl. legacy sync → Tasks 4-5; address consolidation + `addressesEqual` case fix → Task 6; UI copy → Task 5; error codes (`WALLET_EXTENSION_UNAVAILABLE`) → Tasks 2-3; testing incl. sr25519 preservation → Task 2 keeps the golden payload assertions verbatim; manual smoke → checklist above.
- **Placeholder scan:** clean — the two "unchanged" comments in Task 4 Step 6 refer to code shown fully in the current file, with the exact replacement lines specified.
- **Type consistency:** `WalletKind`/`WalletSession`/`WalletProvider` (Task 2 types.ts) used identically in Tasks 3-6; `signApiRequest(address, method, path, bodyHash)` consistent everywhere; `setConnected(address, provider, kind)` 3-arg form enforced by the Task 4 grep step.

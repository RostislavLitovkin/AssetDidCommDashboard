# Solana Wallet Option — Design

**Date:** 2026-07-27
**Status:** Approved

## Goal

Add a settings option choosing which wallet family the app uses for identity and
request signing: **Solana (default)** or Polkadot. All signature flows (profile
REST + buckets GraphQL against `profile-api.xcavate.io`) work with either. The
work also consolidates the repeated wallet/signing/address patterns that grew
during the chain-removal migration.

## Decisions (user-approved)

1. **Solana integration = injected providers** — Phantom (`window.phantom?.solana`),
   Solflare (`window.solflare`), Backpack (`window.backpack`); first available wins.
   No new npm dependencies (base58 via `@polkadot/util-crypto`'s `base58Encode`).
2. **The setting is a mode switch with per-type sessions.** Switching disconnects
   the current session. Fresh installs default to Solana; an existing stored
   session keeps working with its own type and syncs the setting to itself on load.
3. **Separate identities.** A Solana address is its own account/profile/memberships.
   Buckets may mix SS58 and base58 members (the API supports both). No migration
   or linking.
4. **Approach A: provider interface + factory** (vs. internal branching or
   parallel composables).

## Server contract (from XcavateProfile `2026-07-25-solana-signatures-design.md`)

- Same signature payload for both schemes:
  `{METHOD}:{path}:{blake2b-128 body hash, 0x+UPPERCASE}:{timestamp :o}` —
  the body hash stays Blake2b-128 even for Solana.
- **sr25519 signs `blake2AsHex(payload, 128)`** via extension `signRaw`
  (`<Bytes>`-wrapped; validator fallback branch) — unchanged from today.
- **Solana signs the raw UTF-8 payload string directly** via `signMessage`
  (human-readable in the wallet prompt; ed25519 over raw bytes).
- `X-Signature` accepts `0x`-hex or base58 (64 bytes decoded); we send base58
  (native output shape of `signMessage`).
- Same `X-SS58-Address` / `X-Signature` / `X-Timestamp` headers; the server
  detects the scheme from the address format (SS58 checksum decode vs. 32-byte
  base58). No scheme header exists.
- Identical rules for REST and `/graphql`.

## Architecture

```
app/services/wallet/
  types.ts             -- WalletKind, WalletSession {address, provider, kind},
                          WalletAccountOption, WalletProvider interface
  signingCore.ts       -- composeApiSignaturePayload(method, path, bodyHash)
                          -> { payload, timestamp } (shared, wallet-agnostic)
  polkadotProvider.ts  -- current extensionProvider refactored onto the interface
  solanaProvider.ts    -- injected-wallet implementation
  resolveWalletProvider.ts -- factory: (kind) => WalletProvider
  addressUtils.ts      -- normalizeApiAddress(), isSolanaAddress()
```

`WalletProvider`:

```ts
interface WalletProvider {
  readonly kind: WalletKind
  listAccounts(): Promise<WalletAccountOption[]>
  connect(): Promise<WalletSession>
  connectToAddress(address: string): Promise<WalletSession>
  autoConnect(stored: WalletSession | null): Promise<WalletSession | null>
  /** Sign one API request. bodyHash is precomputed by the caller
   *  (canonical-JSON hash for profile REST, raw-body hash for GraphQL,
   *  "" for empty bodies) — identical for both schemes. */
  signApiRequest(address: string, method: string, path: string, bodyHash: string): Promise<HeadersInit>
}
```

- The `signProfileRequest`/`signGraphqlRequest` duplication collapses into
  `signApiRequest` + shared `signingCore`; callers (`useWallet`,
  `ProfileClient` signing callback, `useBucketsRepository`) compute their
  body hash and pass it in.
- `resolveWalletProvider(kind)` is the only construction point, used by
  `useWallet`, `useBucketsRepository`, and `plugins/walletAutoConnect.client.ts`,
  with `kind` read from the settings store.

### Solana provider specifics

- Discovery order: `window.phantom?.solana` → `window.solflare` →
  `window.backpack`; the reported provider name matches the source.
- `connect()` → injected `connect()` → single account
  (`publicKey.toBase58()`); `listAccounts()` returns that one entry.
- `autoConnect` uses `connect({ onlyIfTrusted: true })` — silent, no popup;
  not-yet-trusted wallets leave the app disconnected (parity with Polkadot
  auto-connect fallback).
- `signApiRequest`: `signMessage(new TextEncoder().encode(payload))`
  (some providers require a second arg `"utf8"` — pass it; Phantom ignores
  extras) → `base58Encode(signature)` → headers
  `{ "X-SS58-Address": base58Address, "X-Signature": base58Sig, "X-Timestamp": timestamp }`.

## Settings & session model

- Settings store: `walletType: WalletKind`, own localStorage key, default
  `"solana"`, action `setWalletType(kind)`.
- Stored session (`rxm.walletSession`) gains `kind`; legacy sessions without it
  are `"polkadot"`. On startup a stored session's kind wins and the setting is
  synced to it. Session store state gains `walletKind`.
- Changing the setting while connected: disconnect (existing action + a
  notification), then the user connects a wallet of the new type. Auto-connect
  always uses the current `walletType`.

## Address handling

- `normalizeApiAddress(address)`: SS58 (any prefix) → re-encoded prefix 42;
  valid Solana base58 (decodes to exactly 32 bytes, and is NOT a valid SS58
  address — SS58 checksum decode is tried first) → unchanged; anything else →
  trimmed passthrough. Replaces `toSs58Prefix42` (avatarResolver), the local
  copy in `info.vue`, `convertToPrefix42` (add-member), `resolveApiAddress`
  (my-buckets). All call sites move to `normalizeApiAddress`; the old helpers
  and the `avatarResolver.toSs58Prefix42` export are deleted.
- `isSolanaAddress(address)`: base58 decode yields 32 bytes and SS58 decode
  fails. Used by `useAddress` display logic (base58 shown as-is, shortened the
  same way) and anywhere behavior forks.
- Mixed member lists are expected; profile/avatar lookups key on
  `normalizeApiAddress` output.

## UI

- Settings page: "Wallet type" section (Solana / Polkadot) using the page's
  existing control patterns, with copy noting that switching disconnects the
  current wallet.
- `AppShell` wallet area, `WalletConnectPrompt`, `WalletConnectionCard`: copy
  driven by `walletType` ("Connect a Solana wallet (Phantom, Solflare,
  Backpack)" vs. "Connect the Polkadot browser extension"). Account switcher
  UI unchanged; Solana simply lists one account.
- No visual redesign; conditional copy only.

## Error handling

- No injected wallet: reject with the existing `WALLET_EXTENSION_UNAVAILABLE`
  code so current UI handling applies; message names the supported wallets.
- User rejection of connect/sign: existing rejected-status and
  operation-error notification paths.
- 401s: unchanged ("Signature rejected …"); Solana-specific risk (a wallet
  altering the message before signing) is covered by the manual smoke.
- Legacy stored session: polkadot, no disconnect.

## Testing

- `solanaProvider.signApiRequest` unit test (mock injected wallet): asserts the
  exact raw payload bytes handed to `signMessage`, the base58 `X-Signature`,
  and the header trio — mirroring the existing sr25519 signing test.
- `normalizeApiAddress` unit tests: SS58 prefix 0/2/42 → 42; valid base58
  32-byte → unchanged; garbage → trimmed passthrough.
- Factory tests: kind mapping; settings default solana; legacy session →
  polkadot sync.
- Existing wallet/signing tests migrate to the factory with `kind: "polkadot"`
  and must pass unchanged (proves sr25519 behavior is preserved).
- Manual smoke (user, real wallets): Phantom connect → profile save → namespace/
  bucket/message → verify ed25519 accepted. Joins the still-pending Polkadot
  smoke from the chain-removal migration.

## Out of scope

- Identity linking/migration between a user's Polkadot and Solana addresses.
- Wallet Standard discovery and @solana/wallet-adapter.
- Any server-side changes (the API already supports both schemes).
- Solana chain interaction of any kind (the wallet is used purely for signing).

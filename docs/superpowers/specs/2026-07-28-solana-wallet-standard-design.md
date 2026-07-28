# Arbitrary Solana Wallets via Wallet Standard — Design

**Date:** 2026-07-28
**Status:** Approved

## Goal

Any installed Solana wallet can connect and sign, not only the hardcoded three
(Phantom, Solflare, Backpack). Discovery uses the Wallet Standard event
protocol that all modern Solana wallets implement. When several wallets are
installed, the Select Wallet modal lets the user pick which one connects.
Curated install suggestions and brand icons stay limited to the known three —
arbitrary wallets need no bespoke UI beyond their own name/icon.

## Decisions (user-approved)

1. **Approach A: in-house Wallet Standard discovery.** ~40-line event-based
   registry, no new npm dependency (consistent with the 2026-07-27 design's
   "no new deps" decision). `@wallet-standard/app` and the full
   `@solana/wallet-adapter` stack were rejected.
2. **Multi-wallet arbitration: wallet picker.** The existing Select Wallet
   modal lists every discovered wallet; clicking one triggers that wallet's
   connect popup. Replaces today's behavior where opening the modal
   immediately pops the first hardcoded wallet.
3. **Legacy paths preserved.** The tested `window.phantom?.solana` /
   `window.solflare` / `window.backpack` global detection stays and ranks
   first; Wallet Standard wallets are additive and deduped by name.

## Wallet Standard protocol (what we implement)

- Wallets dispatch `wallet-standard:register-wallet` with a callback as
  `detail`; the app invokes it with `{ register }`.
- The app dispatches `wallet-standard:app-ready` with `{ register }` as
  `detail`; already-loaded wallets respond by calling `register(wallet)`.
- A registered wallet exposes `name`, `icon` (data: URI), `chains`, and
  `features` keyed by feature id.
- Features we use: `standard:connect` (`connect({ silent? })` →
  `{ accounts }`, account addresses are base58 strings) and
  `solana:signMessage` (`signMessage({ account, message })` →
  `[{ signature }]`).

## Architecture

```
app/services/wallet/
  solanaWalletRegistry.ts  -- NEW: client-only Wallet Standard registry
  solanaProvider.ts        -- discovery over legacy globals + registry;
                              two wallet adapters; listWallets/connectWith
  walletCatalog.ts         -- hasInstalledWallet("solana") consults registry
  types.ts                 -- optional listWallets/connectWith on WalletProvider
```

### solanaWalletRegistry.ts

- Module-level list of accepted Wallet Standard wallets.
- `initSolanaWalletRegistry()` — idempotent, no-op on server: adds the
  `wallet-standard:register-wallet` listener, then dispatches
  `wallet-standard:app-ready`. Called from
  `plugins/walletAutoConnect.client.ts` at startup and lazily by the provider.
- Acceptance filter: wallet has `standard:connect` and `solana:signMessage`
  features and at least one `solana:*` chain.
- `registeredSolanaWallets()` — current snapshot (registration order).

### solanaProvider.ts

- Internal `DiscoveredWallet` abstraction with two implementations:
  - **Legacy injected** — current Phantom-style surface, unchanged
    (`connect({ onlyIfTrusted })`, `signMessage(bytes, "utf8")`, `publicKey`).
  - **Wallet Standard adapter** — `standard:connect` with `{ silent }` for
    silent reconnects; caches the connected account; signs via
    `solana:signMessage({ account, message })` and unwraps `[{ signature }]`.
    If asked to sign without a cached account, it connects first (popup is
    acceptable; signing already prompts).
- `discoverWallets()` — legacy globals first (Phantom → Solflare → Backpack),
  then registry wallets whose names don't collide (case-insensitive) with an
  already-listed wallet.
- `listWallets(): Array<{ name, icon? }>` — discovery only, **never pops a
  wallet**. `icon` is the wallet-provided data: URI (absent for legacy
  globals — the modal uses `WalletBrandIcon` for those).
- `connectWith(name)` — connect the named discovered wallet; unknown name →
  `WALLET_EXTENSION_UNAVAILABLE`.
- `connect()` — unchanged meaning: first discovered wallet (single-wallet
  behavior and existing tests keep working).
- `autoConnect(stored)` — silent-connect the wallet matching
  `stored.provider` (name) first; if absent or it fails, try the remaining
  discovered wallets silently in order. Retry loop for late-injecting
  scripts stays.
- `signApiRequest(address, …)` — among discovered wallets, pick the one whose
  active address equals `address`; if none exposes an active address, fall
  back to the first discovered wallet (today's tolerance, generalized). A
  wallet whose
  active address differs still throws `WALLET_ACCOUNT_NOT_FOUND` before
  signing. Payload composition, base58 signature, and the
  `X-SS58-Address`/`X-Signature`/`X-Timestamp` header trio are unchanged.

### types.ts

`WalletProvider` gains **optional** members so Polkadot is untouched:

```ts
listWallets?(): Promise<Array<{ name: string; icon?: string }>>
connectWith?(name: string): Promise<WalletSession>
```

The modal feature-detects them (present → picker flow, absent → account flow).

### walletCatalog.ts

`hasInstalledWallet("solana")` also returns true when the registry holds at
least one wallet — mirroring the existing Polkadot `injectedWeb3` catch-all.
Catalog entries (curated install cards, brand icons) are unchanged.

## Modal flow (Solana only)

- On open: `listWallets()` instead of `listAccounts()` — **no connect popup on
  open** (behavior change from today, where the first wallet pops
  immediately).
- Wallet rows: `WalletBrandIcon` for known brands, else the wallet's own
  `icon` rendered as an `<img>`; wallet name; "Connected" badge on the row
  matching the current session's provider name.
- Click → `connectWith(name)` → on success close the modal; on failure show
  the existing inline connect error.
- No wallets discovered → existing "No Solana wallet detected" install-cards
  state, unchanged.
- The Polkadot account-list flow is untouched.

## Copy

`WalletConnectPrompt`: "Connect a Solana wallet (Phantom, Solflare, or
Backpack) to continue." → "Connect a Solana wallet to continue."

## Error handling

- No discovered wallet: `WALLET_EXTENSION_UNAVAILABLE` (unchanged code path).
- User rejects connect/sign: existing rejected-status and operation-error
  notification paths.
- Malformed registry wallets (missing features) are filtered at registration
  and can never be selected.

## Testing

- Registry: register-wallet event accepted; app-ready dispatch collects
  pre-loaded wallets; feature/chain filtering rejects non-conforming wallets;
  init is idempotent.
- Standard adapter signing: exact raw payload bytes passed to
  `solana:signMessage`, `{ account, message }` call shape, base58
  `X-Signature`, header trio — mirroring the existing legacy signing test.
- Discovery: legacy-first ordering; name dedupe when a wallet is present both
  as a global and in the registry.
- `connectWith`: connects the named wallet; unknown name rejects.
- `autoConnect`: prefers the stored provider name; falls back over remaining
  wallets silently.
- All existing wallet tests pass unchanged.
- Manual smoke (user, real wallets): connect a non-catalog Wallet Standard
  wallet end-to-end (connect → profile save → verify signature accepted),
  plus Phantom regression.

## Out of scope

- Adding non-catalog wallets to the curated install cards or `WalletBrandIcon`.
- `standard:events` account-change subscriptions (session model unchanged).
- Polkadot flow changes of any kind.
- Server-side changes.

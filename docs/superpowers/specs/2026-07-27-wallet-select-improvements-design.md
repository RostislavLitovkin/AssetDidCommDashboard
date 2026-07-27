# Wallet Select & Wallet Type UX Improvements — Design

**Date:** 2026-07-27
**Status:** Implemented

## Goal

Make the wallet selection experience self-explanatory when no wallet is
installed: show branded install links instead of a bare error string, surface
per-wallet install detection on the settings page, and consolidate the two
duplicated "Select Wallet" popups into one component.

## What was built

### `app/services/wallet/walletCatalog.ts`

Data + detection for the six supported wallets:

| Kind | Wallet | Detection | Download |
| --- | --- | --- | --- |
| solana | Phantom | `window.phantom?.solana` | phantom.com/download |
| solana | Solflare | `window.solflare` | solflare.com/download |
| solana | Backpack | `window.backpack` | backpack.app/download |
| polkadot | polkadot.js | `injectedWeb3["polkadot-js"]` | polkadot.js.org/extension |
| polkadot | Talisman | `injectedWeb3["talisman"]` | talisman.xyz/download |
| polkadot | SubWallet | `injectedWeb3["subwallet-js"]` | subwallet.app/download.html |

- `detectInstalledWallets(kind, host?)` — set of installed catalog ids; the
  host parameter exists for tests.
- `hasInstalledWallet(kind)` — for Polkadot, *any* `injectedWeb3` key counts,
  since unknown polkadot.js-compatible extensions still work.
- Unit-tested in `tests/unit/walletCatalog.spec.ts`.

### `app/components/common/WalletBrandIcon.vue`

Hand-drawn simplified inline-SVG brand marks (32×32 tiles) for the six wallets
plus the two chain families (Solana gradient bars, Polkadot ball). No remote
image requests; scales crisply at 14–40 px.

### `app/components/common/WalletSelectModal.vue`

Single popup replacing the duplicated markup in `AppShell` and
`WalletConnectPrompt`. States:

- **Loading** — ParticleLoader.
- **Accounts** — brand icon per account (matched from `source`), formatted
  address, and a green "Connected" badge on the active account.
- **No wallet installed** — headline + grid of branded install cards linking
  to each download page (new tab), a refresh-the-page hint, and a
  "Check again" button that re-runs detection + account listing.
- **Installed but no accounts** — unlock/authorize guidance, "Check again",
  and a compact row of install icon links for getting another wallet.

Also: `role="dialog"`, `aria-modal`, Esc-to-close, backdrop click close,
entrance animation with `prefers-reduced-motion` respected, inline error when
a connect attempt ends rejected (previously the popup closed silently).

### Settings page wallet type selector

- Chain brand icon + clearer hint per option.
- Per-wallet chips under each option showing install state (green dot =
  detected; undetected chips are dimmed/grayscale). Detection is client-only
  (`onMounted`, re-checked once after 1.5 s) to keep hydration deterministic.
- When the *selected* family has no installed wallet, a warning-tinted callout
  shows branded download links right on the page.

### `walletAutoConnect.client.ts` no longer blocks boot

The plugin previously `await`ed `autoConnect`, so app boot hung indefinitely
when `web3Enable` waited on a pending extension authorization prompt (repro:
Talisman installed but not yet authorized). The session store already restores
a persisted session optimistically at store creation, so the plugin now runs
autoConnect as a background reconciliation instead of a boot gate.

## Out of scope

- Official brand SVG assets (simplified marks are drawn by hand).
- Wallet Standard discovery / @solana/wallet-adapter.
- Mobile wallets (Nova, mobile Phantom) — extension-only catalog.

# DID Page Removal + X25519 Key Management — Design

**Date:** 2026-07-26
**Status:** Approved

## Goal

Three independent changes:

1. Remove the DID page and everything that only it used.
2. Let the user remove the stored X25519 key.
3. When no key is stored, let the user generate one — automatically adopted as
   the active key and downloaded as a file.

## Background

- The app's *effective* X25519 key is `settings.x25519SecretJwk` in
  `app/stores/settings.ts`. It is persisted to `localStorage`, injected by
  native hosts through `app/services/injection/x25519InjectionBridge.ts`, and
  read by the messaging code.
- All key UI lives in the sidebar of `app/components/layout/AppShell.vue`: show
  the public key, click to copy, and load/replace it from a JSON file.
  `clearX25519Secret()` already exists there but is wired to no button, and
  `Trash2` is imported but unused — the remove control was started, never
  finished.
- `app/composables/useKeys.ts` wraps `X25519KeyService` but keeps its own local
  `activeKey` ref that is never persisted and never reaches the settings store.
  It is a parallel, half-wired abstraction, used only by
  `app/pages/messages/index.vue`.
- Key *generation* currently exists only on the DID page, so deleting that page
  removes the app's only way to make a key.
- `app/services/crypto/x25519KeyService.ts` already provides
  `generate()` / `import()` / `export()`. `export()` emits
  `{ publicJwk, privateJwk }`, which is exactly what the sidebar's
  `loadX25519SecretFromFile` accepts.

## Decisions

### 1. DID removal

Delete the page and everything only it referenced. Verified by grep that no
other `app/` code imports any of these:

- `app/pages/did.vue`
- `app/components/did/{DidLookupPanel,DidOperationTimeline,DidRegistrationForm,DidUpdateForm}.vue`
- `app/composables/useDid.ts`
- `app/services/papi/didRepository.ts`
- `app/types/did.ts`
- `tests/unit/didOperationForm.spec.ts`
- `tests/integration/didOperations.spec.ts`, `tests/integration/didRepository.spec.ts`
- `tests/e2e/us1-wallet-did.spec.ts`, `tests/e2e/us3-did-write.spec.ts`

`app/stores/operations.ts` and `app/stores/session.ts` are used app-wide and
stay. In `AppShell.vue`, the `/did` sidebar link and the now-unused
`Fingerprint` icon import go. `tests/e2e/primary-color-query.spec.ts` navigates
to `/did`, so it is repointed at `/profile`.

Git history keeps everything if the feature is ever wanted back.

### 2. Removing the key

A `Remove X25519 Key` button (Trash2) appears in the sidebar key section when a
key is active. Removal is irreversible and costs access to encrypted messages
if the user has no backup, so it is a **two-step inline confirm**: the button
swaps to `Confirm remove` / `Cancel` in place. Inline rather than a modal keeps
the sidebar self-contained and needs no overlay plumbing. Confirming calls the
existing `settings.clearX25519SecretJwk()`.

### 3. Generating a key

A `Generate X25519 Key` button appears in the sidebar **only when no key is
active**, alongside `Load X25519 Key`. It:

1. calls `X25519KeyService.generate()`,
2. adopts the key via `settings.setX25519SecretJwk({ publicJwk, privateJwk })`
   — the store normalizer takes `d` from the private JWK and backfills `x` from
   the public one,
3. downloads `x25519-key-<keyId>.json` containing `{ publicJwk, privateJwk }`.

That is the shape `X25519KeyService.export()` produces and the shape the
sidebar's file loader accepts, so a generated file round-trips through
`Load X25519 Key`.

The success message states the download is the only copy.

**New module:** `app/services/crypto/x25519KeyFile.ts` holds the filename and
JSON construction as a pure function (unit-testable under the repo's node-env
vitest) plus a thin DOM download helper. This keeps the logic out of
`AppShell.vue`, which is already 751 lines.

## Testing

- Unit: `tests/unit/x25519KeyFile.spec.ts` — filename derivation, JSON shape,
  and that the produced payload round-trips through the settings store's
  normalizer.
- Existing `npm run test:unit`, `npm run lint`, `npm run typecheck` stay green.
- Manual browser verification of generate (key adopted + file downloaded) and
  remove (confirm step, key cleared).

## Out of scope

- Publishing the generated public key to the chain or the user's profile.
- Reworking or removing `useKeys()`; it stays as-is for
  `app/pages/messages/index.vue`.

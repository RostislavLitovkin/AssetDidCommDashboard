# Unified "Add Member" Page — Design

Date: 2026-07-18

## Goal

Combine the two separate bucket-membership pages
(`/messages/bucket/viewers/[id]` and `/messages/bucket/members/[id]`) into a
single "Add Member" page. One entry per address, one Role selector, and
role-driven extrinsic submission that always resolves the member's X25519
encryption key from their profile.

## Routing & navigation

- **New page:** `app/pages/messages/bucket/add-member/[id].vue`
- **Deleted:** `app/pages/messages/bucket/viewers/[id].vue`,
  `app/pages/messages/bucket/members/[id].vue`
- **`info.vue`:** the three buttons (Add Admin / Add Contributor / Add Viewer)
  are replaced by a single **Add Member** button linking to
  `/messages/bucket/add-member/{bucketId}?namespaceId={namespaceId}`.
- Default role on the page = **Admin**.

## Page state & flow

Inputs:
- **Member Address** — SS58 text input.
- **Role** — segmented control with three options: Admin / Contributor / Viewer.
- **Namespace ID** — editable (as today), seeded from query / bucket fetch.
- **Bucket ID** — read-only.

Profile lookup:
- Triggered automatically on the address field settling — debounce (~400ms)
  and on blur.
- Uses `ProfileClient.getProfile(address)`.
- States:
  - **Not queried yet / in-flight** → Submit disabled, neutral hint.
  - **`null` (404)** → error: "No profile exists for this address, so it cannot
    be added." Submit disabled.
  - **Profile without `x25519Key`** → error: "This profile has no X25519
    encryption key and cannot be added." Submit disabled. (Every role adds a
    viewer, which requires the key.)
  - **Profile with `x25519Key`** → success hint "profile found" (nickname if
    present), Submit enabled.
- Changing address, role, or namespace clears prior success state, matching the
  existing pages.

## Submission (role → calls)

The SS58 address is used for admin/contributor calls; the profile's `x25519Key`
is used for the viewer call.

| Role        | Calls                                                             | Method            |
|-------------|------------------------------------------------------------------|-------------------|
| Admin       | `batchAll[addAdmin(ss58), addContributor(ss58), addViewer(x25519)]` | `utility.batchAll` |
| Contributor | `batchAll[addContributor(ss58), addViewer(x25519)]`              | `utility.batchAll` |
| Viewer      | `addViewer(x25519)` (direct)                                     | `buckets.addViewer` |

## Repository changes (`app/services/papi/didCommRepository.ts`)

- New public method
  `addBucketMemberWithRole(role, namespaceId, bucketId, ss58Address, x25519Key, ownerAddress?, onUpdate?)`
  returning `{ txHash, method }`.
  - **Viewer** → delegates to existing `addBucketViewer` (member arg = x25519Key).
  - **Admin / Contributor** → new private submitter
    `submitBucketsAddMemberBatchExtrinsic` that resolves the `buckets.addAdmin`,
    `buckets.addContributor`, and `buckets.addViewer` methods, composes the
    role-appropriate calls, and submits them via `utility.batchAll`. Modeled on
    the existing `submitBucketsBatchKeyRotationExtrinsic`: same tip-retry loop,
    `logEncodedCallBytes`, `web3FromAddress`, and `api.disconnect()` teardown.
  - Injectable via constructor (like `submitBucketKeyRotationBatchExtrinsic`)
    so it can be unit-tested.

## Error handling & operations log

- Reuse the existing `operations.add(...)` + `logExtrinsicUpdate` logging from
  the current pages.
- Wallet-not-connected → existing `WalletConnectPrompt` component.

## Out of scope

- Removing members / roles (existing `removeBucket*` methods untouched).
- Profile creation / editing.
- Handling a chain where any of `addAdmin` / `addContributor` / `addViewer` is
  unavailable beyond the existing "extrinsic not available" errors.

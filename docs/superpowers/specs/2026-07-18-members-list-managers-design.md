# Members List — Match Managers Design + Profile Identity — Design

Date: 2026-07-18

## Goal

Bring the **Members** list on the bucket info page
(`/messages/bucket/{id}/info`) to visual parity with the **Managers** list on
the namespace page (`/messages/namespace/{namespaceId}`), and enrich each member
row with profile identity:

- Compact single-row cards like Managers (resolved name · role pill(s) · one
  action button).
- Display each member's **profile nickname** instead of the SS58 address. If no
  profile exists for the address, display the literal text **"Profile Not
  Found"**.
- Replace the three per-role remove buttons with **one** trash button that
  removes **all** roles the member holds in a single `utility.batchAll`
  extrinsic.

## Scope

- `app/services/papi/didCommRepository.ts` — new batch role-removal method.
- `app/pages/messages/bucket/[id]/info.vue` — profile lookup + restyled Members
  list + single-button batch removal.
- `tests/integration/didCommRepository.spec.ts` — coverage for the new method.

Out of scope: the Metadata and Communication-Encryption-Key cards; the existing
per-role `removeBucketAdmin/Contributor/Viewer` methods (kept — still used by the
namespace/managers flows and callers elsewhere).

## Repository — batch role removal

Add:

```
removeBucketMemberRoles(
  namespaceId, bucketId, memberAddress,
  roles: BucketMemberRole[], ownerAddress?, onUpdate?
): Promise<AddBucketMemberResult>  // { txHash, method: "utility.batchAll" }
```

- Validates namespace id, bucket id, member address, non-empty `roles`, and a
  connected `ownerAddress` (mirrors the existing remove methods' guards).
- Delegates to a new injectable `submitBucketsRemoveMemberBatchExtrinsic`
  (constructor param, defaulted — same pattern as
  `submitBucketsAddMemberBatchExtrinsic`).
- The submitter resolves `removeAdmin` / `removeContributor` / `removeViewer`
  via `resolveBucketsTxMethod`, pushes one call per role present (in a stable
  admin→contributor→viewer order), wraps them in `utility.batchAll`, and signs
  **once** with the same tip-retry loop as its siblings.
- All three remove calls take `(namespaceId, bucketId, memberAddress)` — the
  member is an SS58 address for every role (confirmed:
  `fetchBucketAdmins/Contributors/Viewers` all return `subjectId`).

## Info page — profile resolution

- Instantiate `ProfileClient`.
- After `loadBucketMembers`, fetch profiles in parallel
  (`Promise.all`) for each unique member address into
  `memberProfiles: Record<string, Profile | null>`; track a `profilesLoading`
  flag. A failed lookup is treated the same as "not found".
- Display name for a member address:
  - profile has a `nickname` → **nickname**
  - lookup returned `null` (or errored) → **"Profile Not Found"**
  - still loading, or profile exists without a nickname → **formatted address**

## Info page — Members list restyled

- `<ul class="bucket-members-list">` of compact single-row `<li>` cards, reusing
  the exact inline styling from the Managers `<li>` (padding, `#f6f7f9`
  background, border, radius, single-line flex row).
- Row content: resolved name (`<strong>`, truncated, `flex: 1 0 0%`) · one role
  pill per role the member holds (`admin`/`contributor`/`viewer`,
  `var(--color-primary)` pill) · **one** trash button.
- The trash button calls `removeAllRoles(member)` →
  `removeBucketMemberRoles(..., member.roles, ...)`, showing `spinner-small`
  while in flight and disabled when another removal is running or the wallet is
  disconnected.
- Reuse the Managers scoped CSS: `.member-remove-btn`, `.spinner-small`,
  `@keyframes spin`, and the `@media (max-width: 600px)` label-hide rule.
- **Drop** the secondary `X25519: …` and `Viewer` sublines — identity now comes
  from the profile nickname, keeping rows single-line like Managers.

## Testing

- Integration test: `removeBucketMemberRoles` invokes the injected batch
  submitter with the member's roles and returns `method: "utility.batchAll"`.
- Guard test: empty `roles` (or missing owner) rejects with a clear error.

# Standalone bucket creation from My messages

**Date:** 2026-07-29
**Status:** Approved (autonomous session — design derived from the updated
XcavateProfile API and existing dashboard patterns)

## Goal

Add an "Add Bucket" button to `/messages/my-buckets` that creates a bucket
**without a namespace** — a "standalone bucket", the off-chain extension the
updated XcavateProfile API introduced (`createBucket` with `namespaceId`
omitted/null).

## What the API guarantees (verified against XcavateProfile master)

- `createBucket(namespaceId: BigInt, metadata: BucketMetadataInput!)` —
  `namespaceId` is now **nullable**. Any signed caller may create a standalone
  bucket; with a namespace the caller must still be a manager.
- `Bucket.namespaceId` / `Bucket.namespace` are nullable. A standalone bucket
  is addressed by passing null (or omitting) `namespaceId` to every
  bucket-scoped mutation (`write`, `resumeWriting`, `rotateKey`, `addAdmin`,
  `addContributor`, `addViewer`, `remove*`, `pauseWriting`,
  `forceRemoveBucket`).
- The **creator stands in for the namespace manager**: only the creator may
  `addAdmin`/`removeAdmin` on a standalone bucket. The creator is *not*
  auto-added as admin/contributor — new buckets start locked with no members,
  exactly like namespaced ones.
- `BucketMetadataInput.category` is validated with `Required` (non-blank) —
  empty category is rejected with `INVALID_INPUT`.

## Design

### 1. Entry point (`app/pages/messages/my-buckets.vue`)

`PageHeader` gains an `#actions` slot with
`<NuxtLink class="btn" to="/messages/bucket/create">Add Bucket</NuxtLink>` —
the exact pattern the namespace page uses for its own Add Bucket link.

Because the creator is not a member, the MyBuckets query would never show a
freshly created standalone bucket. `fetchMyBuckets` therefore adds a fourth
`or` branch — `{ and: [{ creator: { eq: $address } }, { namespaceId: { eq:
null } }] }` — and maps a new `isCreator` flag (creator field added to the
node selection). The card shows a "Creator" chip alongside the existing role
chips, and the debug line renders `standalone` when `namespaceId` is null.

### 2. Create page (`app/pages/messages/bucket/create/index.vue`, new)

A sibling of the namespaced `create/[namespaceId].vue` route: same
PageHeader / WalletConnectPrompt / SubmitButton / useSubmitState skeleton,
minus the namespace field and minus the manager gate (any signed caller may
create). Name and Category are both required (category because the API's
validator rejects blank). On success the page navigates to
`/indexed-bucket/{id}` so the setup timeline (add members → generate key)
takes over; a standalone bucket is otherwise only reachable via My messages.

### 3. Repository (`app/services/buckets/bucketsRepository.ts`)

Bucket-scoped mutations accept `namespaceId: string | null` and declare
`$namespaceId: BigInt` (nullable) instead of `BigInt!`, passing `null` for
standalone buckets: `createBucket`, `setBucketPublicKey`,
`rotateBucketKeyAndShare`, `addBucketMemberWithRole`,
`removeBucketMemberRoles`, `removeMember` + its three wrappers.
`resolveNamespaceId` returns `string | null` (cache keyed with `has()`), and
the `write` document is relaxed the same way, so messaging in standalone
buckets works. Namespace-scoped mutations (`createNamespace`, `addManager`,
`removeManager`) keep `BigInt!`.

Types: `ApiBucket.namespaceId` and `MyBucketSummary.namespaceId` become
`string | null`; `MyBucketSummary` gains `isCreator`.

### 4. Downstream pages reachable for standalone buckets

- `indexed-bucket/[id]/index.vue` — `canManageBucket` also accepts the
  connected wallet being the **creator of a standalone bucket** (mirrors the
  API's manager-equivalence rule); the rotate-key path passes
  `namespaceId ?? null` instead of hard-failing "Namespace id is required".
  The page already tolerates a null namespace elsewhere (manager fetch,
  add-member link).
- `bucket/add-member/[id].vue` — when the bucket loads with a null
  namespace, the page marks it standalone and submits with `null` instead of
  blocking on the empty namespace field.
- The `messages/bucket/[id]` pages keep their namespace guards — they are
  only reached from namespace listings, never for standalone buckets.

### 5. Targeted fix in `create/[namespaceId].vue`

Category is currently labeled "(Optional)" and submitted as `""`, which the
API rejects (`Required` validator). The field becomes required with a submit
guard — same mutation, same fix as the new page.

## Error handling

Unchanged patterns: `useSubmitState` drives the submit button phases, pages
log one terminal operations entry per submit, repository mutations emit
signing/submitting/success/error updates. API errors carry
`extensions.code`; the existing client already surfaces `errors[0].message`.

## Testing

- `bucketsRepository.mutations.spec.ts`: standalone `createBucket` sends
  `namespaceId: null` and a nullable `$namespaceId: BigInt` declaration;
  existing namespaced expectations unchanged.
- `bucketsRepository.myBuckets.spec.ts`: creator-only standalone bucket maps
  to `isCreator: true` with all role flags false; query contains the
  creator/namespaceId-null branch.
- Existing specs must stay green (they assert variables via `toMatchObject`
  and field names, not nullability markers).

## Out of scope

`pauseWriting` / `forceRemove*` (not used by the dashboard), showing
standalone buckets anywhere besides My messages, and any namespace-page
changes.

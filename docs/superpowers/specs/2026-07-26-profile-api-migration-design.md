# Profile API Migration — Replace Substrate Extrinsics & SubQuery Indexer

**Date:** 2026-07-26
**Status:** Approved

## Goal

Replace every Xcavate Substrate blockchain interaction — buckets-pallet extrinsic
submissions and SubQuery indexer queries — with the XcavateProfile API deployed at
`https://profile-api.xcavate.io/`. After this migration the dashboard has **no chain
connection at all**: the wallet extension is used only for address selection and
Sr25519 request signing.

The API (repo: `pyrahermesagent/XcavateProfile`) exposes:

- REST profile endpoints (already integrated via `app/services/profile/`).
- A GraphQL endpoint `POST /graphql` (Hot Chocolate) that is a full port of the
  buckets pallet: queries for namespaces, buckets, messages, tags, managers,
  admins/contributors/viewers with cursor pagination, and 1:1 mutations for every
  extrinsic the app submits today. Schema reference:
  `docs/graphql/schema.graphql` in the API repo.

## Decisions (user-approved)

1. **Remove the chain entirely.** Delete all `@polkadot/api` WsProvider usage, RPC
   storage fallbacks, and block-time estimation. Keep `@polkadot/extension-dapp`
   (wallet connect + `signRaw`) and `@polkadot/util-crypto` (blake2).
2. **Keep Pinata/IPFS for message content durability.** `write` still uploads the
   encrypted payload to Pinata first; the CID remains the `reference`, and the full
   payload is *also* mirrored into the API's `ipfsContent` field (stored verbatim).
3. **Simplify operation status** from the extrinsic stage machine
   (submitted/broadcast/inBlock/finalized) to `pending | success | error`.
4. **Approach A — clean new service layer.** New `app/services/buckets/` module;
   all pages migrate to it; the old papi/indexer layer is deleted (no adapter, no
   incremental strangler).

## Architecture

```
app/services/buckets/
  bucketsApiClient.ts    -- GraphQL transport (plain queries, signed mutations)
  bucketsRepository.ts   -- typed operations used by pages; options-object ctor
  types.ts               -- ApiNamespace, ApiBucket, ApiMessage, ApiBucketMember, ...
app/composables/useBucketsRepository.ts  -- builds repository from runtimeConfig
```

- `bucketsApiClient.ts` exposes `queryGraphql(document, variables)` (no auth
  headers) and `mutateGraphql(document, variables, signerAddress)` (signed). Both
  POST to `{profileApiUrl}/graphql`, parse the `{data, errors}` envelope, and throw
  typed errors.
- `bucketsRepository.ts` is constructed from an **options object**
  `{ apiUrl, pinataConfig? }` — deliberately replacing the 22-positional-argument
  `DidCommRepository` constructor that has caused silent misalignment bugs before.
- Entity ids are strings (the API's `BigInt` scalar serializes as string, matching
  SubQuery's convention: bucket entity id = `"{bucketId}"`, message id =
  `"{bucketId}-{messageId}"`). Timestamps are real `createdAt` ISO strings; the
  block-number-to-time estimation (`services/chain/blockTime.ts`) is deleted and
  pages render actual timestamps.

## Mutation signing

Mutations reuse the profile REST API's `SignatureValidator` contract, already
implemented and golden-vector-tested in `app/services/profile/profileSigning.ts`.
GraphQL is the *simpler* case because the server hashes the **raw request body
bytes** (no C# JSON re-serialization matching):

1. Serialize `{query, variables}` **once**; the same exact bytes are hashed and sent.
2. `bodyHash` = `0x` + UPPERCASE hex of blake2b-128 over those bytes
   (reuse `toCSharpHashHex`).
3. `timestamp` = C# `:o` format — 7 fractional digits + `Z`
   (reuse `formatSignatureTimestamp`).
4. Signature payload: `POST:/graphql:{bodyHash}:{timestamp}`, signed with
   `signRaw({ data: blake2AsHex(payload, 128), type: "bytes" })` via the wallet
   extension (the extension's `<Bytes>` wrapping matches the validator's fallback
   branch).
5. Headers: `X-SS58-Address`, `X-Signature`, `X-Timestamp`. The server enforces a
   5-minute timestamp window. Queries send no auth headers.

## Read-path mapping (subqueryClient → GraphQL)

Same cursor-pagination loop pattern (`pageInfo { hasNextPage endCursor }`), but Hot
Chocolate syntax: `where: { field: { eq: X } }` replaces
`filter: { field: { equalTo: X } }`; `order: [{ createdAt: ASC }]` replaces
`orderBy: [CREATED_BLOCK_ASC]`.

| Current function | New query |
|---|---|
| `fetchIndexedNamespaces` | `namespaces(order: [{createdAt: ASC}])` |
| `fetchIndexedNamespaceById` | `namespace(id: $id)` |
| `fetchIndexedNamespacesByAddress` | `namespaces(where: {creator: {eq: $addr}})` (SS58 is case-sensitive; the old `equalToInsensitive` is unnecessary) |
| `fetchIndexedNamespaceManagers` | `namespaceManagers(where: {namespaceId: {eq}})` |
| `fetchIndexedBucketsByNamespace` | `buckets(where: {namespaceId: {eq}}, order: [{createdAt: ASC}])` |
| `fetchIndexedBucketsFiltered` | `buckets(where: …)` translated per call site |
| `fetchIndexedBucketDetail` | `bucket(id)` with nested `admins/contributors/viewers/messages` lists |
| `fetchIndexedMessages` | `messages(where: {bucket: {bucketId: {eq}}}, order: [{createdAt: ASC}])` — message filters reach the bucket via the nested relation |
| `fetchIndexedMessagesByTag` | same + `tag: {eq}` |
| `fetchFileMessagesPage` | same + `contentType: {neq: null, nin: [TEXT, KEY_SHARING]}`, `order: [{createdAt: DESC}]`, `first/after` paging |

Notes:

- Member counts: the new nested `admins`/`contributors` are plain lists, not
  connections — counts come from list length (`admins { subjectId }`).
- `createdBlock` disappears from all types and consumers; `createdAt` replaces it.
- The indexer-first / RPC-fallback dance is gone. The API is the single source of
  truth; failures surface as errors instead of silently falling back to a chain
  that no longer backs the data.

## Write-path mapping (extrinsics → signed mutations)

| Current extrinsic | New mutation |
|---|---|
| `buckets.createNamespace` | `createNamespace(metadata: {name, schemaUri: null, properties: []})` |
| `buckets.createBucket` | `createBucket(namespaceId, metadata: {name, category: category ?? "", properties: []})` — `category` is required (`String!`); empty string when absent |
| `buckets.write` | Pinata upload (unchanged) → `write(namespaceId, bucketId, message: {reference: cid, tag, ipfsContent: payload, metadata: {description: "", contentType, contentHash: sha256Hex, properties: []}})` |
| `buckets.addAdmin/addContributor/addViewer` | `addAdmin/addContributor/addViewer(namespaceId, bucketId, subject)` |
| `buckets.removeAdmin/removeContributor/removeViewer` | `removeAdmin/removeContributor/removeViewer(...)` |
| `buckets.addNamespaceManager` / `removeNamespaceManager` | `addManager(namespaceId, newManager)` / `removeManager(namespaceId, oldManager)` |
| `buckets.createTag` | `createTag(bucketId, newTag)` |
| `buckets.resumeWriting` | `resumeWriting(namespaceId, bucketId, newEncryptionKey)` |
| `utility.batchAll` (rotateKey + key-sharing write) | **one signed document**: `mutation { rotateKey(...) write(...) }` — root mutation fields execute serially; one wallet popup |
| `utility.batchAll` (add role + viewer) | one signed document with aliased `addAdmin`/`addContributor` + `addViewer` fields; role removal likewise |

Value formats:

- Encryption keys and viewer keys keep the existing `normalizeFixed32ByteKey`
  32-byte hex form, consistent with data the chain/indexer produced.
- Names, tags, categories, content types are sent as plain strings (the API stores
  strings, not SCALE hex bytes) — `utf8ToHexBytes` is not used on the wire.
- `write` requires `namespaceId`; the chat page only knows `bucketId`. The
  repository resolves namespaceId via `buckets(where: {bucketId: {eq}})` and caches
  the result per bucket (replacing the chain-storage scan
  `resolveNamespaceIdForBucketWrite`).

## Status lifecycle & error handling

- `ExtrinsicUpdate` → `OperationUpdate { stage: "pending" | "success" | "error", message }`.
  Callers keep an `onUpdate` hook; stage vocabulary shrinks.
- Mutation results return the created entity id (bucket id, message id, …) instead
  of a fake tx hash. UI spots that displayed tx hashes show the entity id or nothing.
- HTTP 401 → "Signature rejected — check wallet and clock" (5-minute window).
- GraphQL `errors[]` (authorization: "not a contributor"; preconditions: "bucket is
  locked", "at least two managers required") → messages surfaced via the existing
  notifications store.
- No retry-with-tip loops; a failed call reports its error once.

## Config

`runtimeConfig.public` changes:

- **Add** `profileApiUrl` (default `https://profile-api.xcavate.io`,
  env `NUXT_PUBLIC_PROFILE_API_URL`).
- **Remove** `xcavateWsEndpoint`, `subqueryIndexerUrl`.
- **Keep** `pinataJwt/pinataApiKey/pinataApiSecret/pinataGateway`,
  `publicFreeCommunicationBucket`.
- `app/services/profile/profileClient.ts` switches its hardcoded `PROFILE_API_URL`
  to the same config value (targeted improvement while touching config).

## Deletions

- `app/services/papi/didCommRepository.ts` (~3,300 lines)
- `app/services/papi/client.ts`
- `app/services/indexer/subqueryClient.ts`
- `app/services/chain/blockTime.ts`
- `app/plugins/papi.client.ts`
- `@polkadot/api` from package.json dependencies

Untouched: wallet connection UX (`extension-dapp`), the mock `DidRepository` and
DID pages, profile services, crypto/key services, Pinata storage adapter.

## Page migration

Every consumer of `new DidCommRepository(...)` or direct `subqueryClient` imports
switches to `useBucketsRepository()` / the new client:

`pages/messages/index.vue`, `pages/messages/my-buckets.vue`,
`pages/messages/namespaces/new.vue`, `pages/messages/namespace/[namespaceId].vue`,
`pages/messages/namespace/managers/[namespaceId].vue`,
`pages/messages/bucket/create/[namespaceId].vue`,
`pages/messages/bucket/add-member/[id].vue`, `pages/messages/bucket/[id]/index.vue`,
`pages/messages/bucket/[id]/info.vue`, `pages/messages/bucket/[id]/files.vue`,
`pages/indexed-bucket/[id]/index.vue`.

`my-buckets.vue` and `indexed-bucket/[id]/index.vue` drop `blockTime` usage in
favor of `createdAt`.

## Testing

- **Signing unit tests:** payload construction over a known raw GraphQL body,
  extending the golden-vector style of `tests/unit/profileSigning.spec.ts`
  (vectors regenerable via the .NET harness referencing
  `XcavateProfileApiClient`).
- **Repository unit tests:** query/filter document construction and entity mapping
  with mocked `fetch`.
- **Integration smoke test:** env-gated (skipped in CI) read query against the live
  `/graphql` endpoint.
- **Manual verification** before merge: create namespace → create bucket → write
  message → read back, against the live API.

## Out of scope

- Server-side data backfill (chain history → API database) — a concern of the API
  deployment, not this dashboard.
- Solana signature support (the API accepts it; the dashboard remains Sr25519).
- DID page behavior (mock repository stays as is).

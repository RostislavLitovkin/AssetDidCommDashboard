# Bucket File Library (infinite scroll) — Design

**Date:** 2026-07-21
**Route:** `/messages/bucket/[id]/files`
**Status:** Approved

## Problem

A bucket's chat mixes text, key-sharing events, and file/image attachments. There
is no dedicated place to browse just the files. A prior attempt exists
(`app/pages/messages/bucket/[id]/files.vue`, committed in `9eabe04`) but it:

1. **Is not infinite-scrolling.** `fetchFileMessages()` eagerly loops through every
   page up front and renders all results at once as chat bubbles.
2. **Cannot decrypt files.** In `loadAll()` it derives key-sharing messages from the
   file-query results, but the GraphQL filter already excludes key-sharing messages,
   so that array is always empty, `activeSecretJwk` stays `null`, and no file ever
   decrypts.

## Goal

Rework the existing page into a dedicated, cursor-paginated, **infinitely-scrolling
file gallery** that correctly recovers the bucket's decryption key so files and
images render. The info page's existing "View Files" link is kept.

## Non-goals

- No new route (the page already exists; it is reworked in place).
- No changes to how files are sent/encrypted in the main chat.
- No server/indexer schema changes — only new client queries against existing fields.

## Domain recap

- A **file message** carries the real MIME type in the on-chain `contentType`; its
  `reference` is an IPFS CID pointing at a **compact JWE**.
- Decrypting that JWE with the bucket's active X25519 secret yields the raw file
  bytes; the filename is in the JWE `protectedHeader.filename`.
- The bucket secret is recovered by decrypting the latest **key-sharing** message
  (`tag = "didcomm/key-sharing-v1"`) with the user's personal X25519 secret
  (`settings.x25519SecretJwk`). The key-sharing plaintext JSON carries
  `keys: [<X25519 secret JWK>]`.
- Content-type discriminators:
  - text: `text/plain;charset=utf-8`
  - key-sharing: `application/didcomm-encrypted+json`
  - anything else with a non-null `contentType` is a file.

## Data layer — `app/services/indexer/subqueryClient.ts`

Add a **paged** file query (the eager `fetchFileMessages` stays for other callers):

```ts
export interface MessagePage {
  nodes: IndexedMessage[]
  hasNextPage: boolean
  endCursor: string | null
}

export async function fetchFileMessagesPage(
  endpoint: string,
  bucketId: string,
  opts?: { first?: number; after?: string | null }
): Promise<MessagePage>
```

- Orders **newest-first** (`CREATED_BLOCK_DESC`) so recent files appear on top and
  scrolling down pulls older pages. `first` defaults to `20`.
- Filter discriminates on **`contentType` only**:
  `contentType: { isNull: false, notEqualTo: "text/plain;charset=utf-8" }` combined
  with excluding `application/didcomm-encrypted+json`. This avoids the current
  query's `tag: { notEqualTo: "didcomm/key-sharing-v1" }`, which in SQL evaluates to
  NULL (falsey) for null-tagged rows and would silently drop legitimate files.
  (SubQuery/Postgraphile filters combine multiple conditions on one field with an
  implicit AND; if a single-field double-condition is not expressible, use an `and:`
  list of two `contentType` conditions.)
- Returns one page plus `{ hasNextPage, endCursor }` for the caller to advance.

A small client-side `isFileMessage(m)` guard mirrors the content-type logic as
belt-and-suspenders against any unexpected rows.

## Decryption keys

On mount, **separately** fetch key-sharing messages with the existing
`fetchIndexedMessagesByTag(url, bucketId, "didcomm/key-sharing-v1")`, hydrate their
IPFS payloads, and decrypt the latest working one with `settings.x25519SecretJwk` to
recover the bucket's active X25519 secret (`activeSecretJwk`). Each file's compact
JWE is then decrypted with that secret to produce `{ contentType, fileName, data }`.

Note: the indexed bucket's `encryptionKey` field is the **public** key identifier and
is not sufficient to decrypt on its own; the actual secret comes from the key-sharing
message, so that is what we fetch.

## Page component — `files.vue` (reworked)

State: accumulated `files[]`, `cursor`, `hasNextPage`, `loadingPage`,
`initialLoading`, `error`, `activeSecretJwk`, plus the payload / attachment / error
maps keyed by message id (reuse the helpers already in the file:
`hydratePayloads`, `bytesToBase64`, `looksLikeCompactJwe`, `isX25519Secret`,
`resolveUrl`, and the key-sharing decrypt).

Flow:

1. `settings.initialize()`.
2. Fetch + decrypt key-sharing → recover `activeSecretJwk`.
3. `loadNextPage()`: `fetchFileMessagesPage` → hydrate IPFS payloads for the page →
   decrypt attachments → append to `files[]`, advance `cursor`/`hasNextPage`.
4. An **IntersectionObserver** on a bottom sentinel calls `loadNextPage()` when the
   sentinel is near the viewport and `hasNextPage && !loadingPage`.

Watch `settings.x25519SecretJwk`: on change, re-derive `activeSecretJwk` and
re-decrypt already-loaded files (reset the attachment map, keep the fetched list).

## Presentation — new `app/components/common/BucketFileCard.vue`

One gallery row per file, visually distinct from chat bubbles. Props: a
`ChatMessageAttachment` (reused type) plus sender/timestamp/CID/error metadata.

- **image/**: inline thumbnail + `name · type · size`; click → download/open.
- **video/** and **audio/**: inline `<video controls>` / `<audio controls>`, capped
  height (mirrors chat media sizing).
- **other**: file card — icon + `name · type · size` + download button.
- **Locked state** (no personal key set, or decrypt failed): a 🔒 row showing the
  on-chain `contentType` and a short CID, plus a "load your X25519 key to view" note.
  The list still renders; only previews/downloads are withheld.

`formatFileSize`, the data-URL builder, and `downloadAttachment` mirror the small
helpers already in `ChatMessageEntry.vue` (kept local to the component; not worth a
shared util yet).

## States & ordering

- **Ordering:** newest-first; scroll down loads older.
- **Initial load:** `LoadingBar`.
- **Paging:** a small spinner at the bottom sentinel while fetching the next page.
- **Empty:** friendly "No files found for this bucket" state.
- **Error:** inline error banner (query or indexer failure).
- **No key:** a top banner prompting the user to load their X25519 secret in
  settings; rows render in the locked state until a key is available.

## Info page

`info.vue` already has a "Files & Images" card linking to the files route
(`info.vue:1604-1615`). Keep it; lightly adjust the copy now that decryption works.

## Testing

- **Vitest unit** (`tests/unit`) for `fetchFileMessagesPage`: mock `fetch` and assert
  the `first`/`after` variables are sent, the content-type filter shape is correct,
  and `{ nodes, hasNextPage, endCursor }` is returned from the page's `pageInfo`.
- **Unit** for `isFileMessage` content-type discrimination (text / key-sharing / file).
- **Manual/e2e:** load `/messages/bucket/3/files`, confirm files decrypt and render,
  and that scrolling loads additional pages.

## Risks / open questions

- The exact filter syntax for two conditions on `contentType` depends on the
  indexer's generated schema; if a single-field object with two operators is
  rejected, fall back to an `and: [{ contentType: {...} }, { contentType: {...} }]`
  list. Verify against the live indexer during implementation.
- Large files become large base64 data URLs in memory. Acceptable for typical sizes;
  revisit with lazy per-item decryption if it becomes a problem.

# File messages as CID pointers with real content types

**Date:** 2026-07-19
**Status:** Approved

## Problem

When a file is sent in a bucket today, the dashboard base64-encodes it, wraps it in a
JSON envelope (`{type: "attachment", contentType, fileName, data}`), encrypts that
envelope with the bucket key, and uploads the JWE to IPFS. Consequences:

- The message payload on IPFS (surfaced by the SubQuery indexer as `ipfsContent`) is a
  multi-megabyte JWE blob instead of something small and meaningful.
- The on-chain `buckets.write` metadata `contentType` is hardcoded to
  `text/plain;charset=utf-8` for every non-key-sharing message, so it never reflects
  what the message actually carries.

## Goal

For file sends, the message's IPFS content must be **only the IPFS CID** of the file
(no JSON wrapping), and the on-chain `contentType` must be the **actual MIME type** of
the file. Text messages and key-sharing messages are unchanged.

## Decisions (made with the user)

1. **Files stay encrypted.** The file bytes are compact-JWE-encrypted with the bucket
   key before upload — no JSON envelope, just the JWE. `contentType` records the MIME
   type of the decrypted file.
2. **Text messages are unchanged.** JWE-encrypted text on IPFS,
   `contentType = text/plain;charset=utf-8`.
3. **CID-pointer structure (double indirection).** Two IPFS objects per file message:
   the encrypted file, and a tiny message payload whose entire content is the file's
   CID as a bare string. The on-chain `reference` points at the pointer message.
4. **File name travels in the JWE protected header** of the encrypted file (custom
   `filename` param, plus standard `cty` for the MIME type) — off-chain, recovered at
   decrypt time.

## Message layout

### File message (new)

```
1. file bytes → compact JWE (bucket key, ECDH-ES+A256KW / A256GCM)
     protected header: { alg, enc, typ, kid, cty: file.type, filename: file.name }
   → IPFS → fileCid
2. message content = "<fileCid>"   (bare string, unencrypted) → IPFS → msgCid
3. buckets.write:
     reference               = msgCid
     metadataInput.contentType = file.type  (fallback application/octet-stream)
     metadataInput.contentHash = sha256("<fileCid>")   — existing invariant:
                                 hash of the bytes at `reference`
     tag                     = none
```

The CID pointer is deliberately not encrypted: the file it points to already is, and a
bare CID is what keeps the indexer's `ipfsContent` small and readable.

### Text message (unchanged)

`JWE(text)` on IPFS; `reference = cid`; `contentType = text/plain;charset=utf-8`.

### Key-sharing message (unchanged)

General JWE JSON; `contentType = application/didcomm-encrypted+json`;
tag `didcomm/key-sharing-v1`.

## File-message detection rule (read side)

A message is a file message iff all of:

- `tag !== "didcomm/key-sharing-v1"`,
- on-chain `contentType` is set and is not one of the two exact message content types
  the dashboard itself writes for non-file messages: `text/plain;charset=utf-8` (text)
  and `application/didcomm-encrypted+json` (key-sharing),
- the hydrated payload (trimmed) looks like a bare CID (single alphanumeric token).

The exclusion is by exact match, not `text/` prefix, so a `.txt` attachment
(`contentType = text/plain`, no charset suffix) is still detected as a file. A text
message whose body happens to be a pasted CID is never misdetected because text sends
always write exactly `text/plain;charset=utf-8`. If the payload does not look like a
bare CID, fall back to the legacy rendering path instead of fetching.

## Changes by file

### `app/services/papi/didCommRepository.ts`

- `createMessage(bucketId, message, ownerAddress?, onUpdate?, tag?, contentType?)` —
  new optional `contentType` threaded through `submitMessageExtrinsic` into
  `buildBucketsWriteMessageInput`. An explicit `contentType` overrides the current
  tag-derived default; when absent, behavior is exactly as today.
- New `createFileMessage(bucketId, fileJwe, fileContentType, ownerAddress?, onUpdate?)`:
  1. Uploads `fileJwe` to IPFS via the Pinata adapter. Upload failure aborts before
     any extrinsic, reporting through `onUpdate` (same pattern as the existing
     message-upload failure path).
  2. Delegates to the `createMessage` flow with `message = fileCid` and
     `contentType = fileContentType`.

### `app/pages/indexed-bucket/[id]/index.vue` and `app/pages/messages/bucket/[id]/index.vue`

Send side (both pages, same duplicated pattern as today):

- Delete `buildAttachmentEnvelope`.
- Generalize the page's encrypt helper (`encryptOutgoing` /
  `encryptOutgoingBucketMessage`) to accept `Uint8Array | string` plaintext and
  optional extra protected-header params.
- Attachment branch of `sendMessage`: `await file.arrayBuffer()` → encrypt bytes with
  header `{cty: file.type, filename: file.name}` → 
  `didCommRepository.createFileMessage(bucketId, jwe, file.type || "application/octet-stream", …)`.
  Text branch unchanged. Existing pending/rollback/error UX unchanged.

Read side (both pages, in their respective hydrate/decrypt pipelines):

- After hydration/decryption, messages matching the detection rule get their payload
  treated as `fileCid`: fetch via the existing gateway resolver, `compactDecrypt` with
  the active bucket key, recover `filename` from the protected header, and store an
  attachment record `{contentType (on-chain), fileName, data (base64)}` keyed by
  message id. Fetch/decrypt failures land in the existing per-message error maps and
  render in the bubble like today's payload errors. A missing bucket key shows the
  same "decrypt" error text messages get.
- The chat-message mapping passes this record to `ChatMessageEntry` as a new
  `attachment` prop.

### `app/components/common/ChatMessageEntry.vue`

- `ChatMessageProps` gains optional
  `attachment?: { contentType: string; fileName?: string; data: string }`.
- Rendering prefers the explicit prop; when absent it falls back to the existing
  body-JSON envelope parsing. All current media rendering (image/video/audio/file,
  download) is reused as-is.

## Backward compatibility

Legacy messages on-chain have `contentType = text/plain;charset=utf-8`, so they never
match the file-message detection rule; they decrypt as before and render through the
envelope-parsing fallback. Nothing is migrated; old and new messages coexist.

## Error handling summary

- IPFS upload failure (file or pointer): abort before signing, surface via `onUpdate`
  error + `sendError`, restore the pending attachment (existing behavior).
- File fetch/decrypt failure on read: per-message bubble error (existing maps).
- Empty `file.type`: fall back to `application/octet-stream`.

## Testing

Extend `tests/integration/didCommRepository.spec.ts`:

- `createFileMessage` uploads the JWE, then submits `buckets.write` with
  `reference = msgCid` and the overridden `contentType`.
- `createMessage` without `contentType` keeps today's defaults (text and key-sharing
  paths) — guard against regressions.
- Upload failure in `createFileMessage` rejects without submitting an extrinsic.

Manual verification: send a text message, an image, and a non-media file in a bucket;
confirm bubbles render, downloads keep their file name, on-chain `contentType` shows
the real MIME type, and the indexer's `ipfsContent` holds only the CID.

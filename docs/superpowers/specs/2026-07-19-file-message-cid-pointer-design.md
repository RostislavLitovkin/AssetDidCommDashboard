# File messages as direct IPFS references with real content types

**Date:** 2026-07-19 (revised same day: switched from CID-pointer to direct reference)
**Status:** Approved

## Problem

When a file is sent in a bucket today, the dashboard base64-encodes it, wraps it in a
JSON envelope (`{type: "attachment", contentType, fileName, data}`), encrypts that
envelope with the bucket key, and uploads the JWE to IPFS. Consequences:

- What sits on IPFS is a JWE of a JSON wrapper around base64 file data — the file is
  double-encoded and buried in an ad-hoc envelope format instead of being stored as
  an encrypted file object.
- The on-chain `buckets.write` metadata `contentType` is hardcoded to
  `text/plain;charset=utf-8` for every non-key-sharing message, so it never reflects
  what the message actually carries.

## Goal

For file sends, the on-chain `reference` must point **directly at the encrypted file
on IPFS** (no JSON wrapping anywhere), and the on-chain `contentType` must be the
**actual MIME type** of the file. Text messages and key-sharing messages are
unchanged.

## Decisions (made with the user)

1. **Files stay encrypted.** The file bytes are compact-JWE-encrypted with the bucket
   key before upload — no JSON envelope, just the JWE. `contentType` records the MIME
   type of the decrypted file.
2. **Text messages are unchanged.** JWE-encrypted text on IPFS,
   `contentType = text/plain;charset=utf-8`.
3. **Direct file reference.** One IPFS object per file message: the encrypted file
   JWE itself. It goes through the standard write flow as the message content, so the
   on-chain `reference` is its CID. (An earlier revision used a CID-pointer message —
   a second IPFS object holding the file's CID as a bare string — to keep the
   indexer's `ipfsContent` tiny; the user chose the simpler direct structure,
   accepting that `ipfsContent` holds the whole JWE blob.)
4. **File name travels in the JWE protected header** of the encrypted file (custom
   `filename` param, plus standard `cty` for the MIME type) — off-chain, recovered at
   decrypt time.

## Message layout

### File message (new)

```
1. file bytes → compact JWE (bucket key, ECDH-ES+A256KW / A256GCM)
     protected header: { alg, enc, typ, kid, cty: file.type, filename: file.name }
2. the JWE is the message content → IPFS → fileCid  (standard write flow)
3. buckets.write:
     reference                 = fileCid
     metadataInput.contentType = file.type  (fallback application/octet-stream)
     metadataInput.contentHash = sha256(fileJwe)   — existing invariant:
                                 hash of the bytes at `reference`
     tag                       = none
```

The reference points straight at the encrypted file; there is no intermediate
pointer object. The indexer's `ipfsContent` therefore contains the JWE blob itself.

### Text message (unchanged)

`JWE(text)` on IPFS; `reference = cid`; `contentType = text/plain;charset=utf-8`.

### Key-sharing message (unchanged)

General JWE JSON; `contentType = application/didcomm-encrypted+json`;
tag `didcomm/key-sharing-v1`.

## File-message detection rule (read side)

A message is a file message iff both:

- `tag !== "didcomm/key-sharing-v1"`, and
- on-chain `contentType` is set and is not one of the two exact message content types
  the dashboard itself writes for non-file messages: `text/plain;charset=utf-8` (text)
  and `application/didcomm-encrypted+json` (key-sharing).

The exclusion is by exact match, not `text/` prefix, so a `.txt` attachment
(`contentType = text/plain`, no charset suffix) is still detected as a file. File
messages are skipped by the text-decryption pass (their JWE plaintext is binary); the
attachment pass decrypts the already-hydrated reference payload instead, refusing
payloads that do not look like a compact JWE.

## Changes by file

### `app/services/papi/didCommRepository.ts`

- `createMessage(bucketId, message, ownerAddress?, onUpdate?, tag?, contentType?)` —
  new optional `contentType` threaded through `submitMessageExtrinsic` into
  `buildBucketsWriteMessageInput`. An explicit `contentType` overrides the current
  tag-derived default; when absent, behavior is exactly as today.
- New `createFileMessage(bucketId, fileJwe, fileContentType, ownerAddress?, onUpdate?)`:
  a thin wrapper that validates the JWE, defaults a blank content type to
  `application/octet-stream`, and delegates to `createMessage` with the JWE as the
  message content. The standard write flow uploads it to IPFS and uses its CID as
  `reference`; upload failure aborts before any extrinsic exactly as for text
  messages.

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

- The text-decryption pass skips messages matching the detection rule (their JWE
  plaintext is binary, not UTF-8 text).
- A separate attachment pass takes the already-hydrated reference payload (the file
  JWE), `compactDecrypt`s it with the active bucket key, recovers `filename` from the
  protected header, and stores an attachment record
  `{contentType (on-chain), fileName, data (base64)}` keyed by message id. Decrypt
  failures land in the existing per-message error maps and render in the bubble like
  today's payload errors. A missing bucket key shows the same "decrypt" error text
  messages get.
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

- IPFS upload failure: abort before signing, surface via `onUpdate` error +
  `sendError`, restore the pending attachment (existing behavior, shared with text
  messages).
- File decrypt failure on read (including a reference payload that is not a compact
  JWE): per-message bubble error (existing maps).
- Empty `file.type`: fall back to `application/octet-stream`.

## Testing

Extend `tests/integration/didCommRepository.spec.ts`:

- `createFileMessage` submits the file JWE as the message content with the file's
  `contentType` and no tag.
- Blank `fileContentType` falls back to `application/octet-stream`.
- Empty `fileJwe` rejects with "File payload is required".
- `createMessage` without `contentType` keeps today's defaults (text and key-sharing
  paths) — guard against regressions.

Manual verification: send a text message, an image, and a non-media file in a bucket;
confirm bubbles render, downloads keep their file name, on-chain `contentType` shows
the real MIME type, and the on-chain `reference` resolves to the encrypted file JWE
on IPFS.

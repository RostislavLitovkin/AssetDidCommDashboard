# File Messages as CID Pointers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** File sends store the encrypted file as its own IPFS object; the message payload becomes the bare file CID and the on-chain `contentType` records the file's real MIME type.

**Architecture:** The bucket-key JWE encryption moves from "JSON envelope with base64 file" to "raw file bytes, file name in the JWE protected header". A new `DidCommRepository.createFileMessage` uploads the file JWE to IPFS, then reuses the existing `createMessage` flow with the file CID as the message body and an explicit `contentType` override threaded through to `buckets.write`. Both chat pages detect file messages on read (contentType + bare-CID payload), fetch and decrypt the file, and hand `ChatMessageEntry` an explicit attachment; the legacy envelope path stays as a rendering fallback for old messages.

**Tech Stack:** Nuxt 4 / Vue 3, TypeScript, jose (JWE), Pinata IPFS, @polkadot/api, vitest.

**Spec:** `docs/superpowers/specs/2026-07-19-file-message-cid-pointer-design.md`

## Global Constraints

- Text message contentType stays exactly `text/plain;charset=utf-8`; key-sharing stays exactly `application/didcomm-encrypted+json`; file contentType fallback is `application/octet-stream`.
- File-message detection: tag ≠ `didcomm/key-sharing-v1` AND contentType set AND contentType not one of the two exact strings above AND payload matches `/^[A-Za-z0-9]{32,128}$/` (bare CID). Exclusion is by exact match, never `text/` prefix.
- File name travels only in the file JWE protected header params `{cty: <mime>, filename: <name>}` — never on-chain, never in a JSON body.
- The CID-pointer message payload is the bare CID string, unencrypted, no JSON.
- `DidCommRepository` has a 22-positional-arg constructor — when constructing it in tests, count `undefined`s carefully; misalignment fails silently. Position 7 = message submitter, positions 8–15 = eight member/key/tag submitters, position 16 = `pinataConfig`.
- Tests: `npm run test:integration` / `npm run test:unit`. Typecheck: `npm run typecheck`. Lint: `npm run lint`.
- Do not modify the batchAll key-rotation path (`didCommRepository.ts` ~line 1685) — key-sharing behavior is unchanged.

---

### Task 1: Thread `contentType` through `createMessage` → submitter → `buildBucketsWriteMessageInput`

**Files:**
- Modify: `app/services/papi/didCommRepository.ts` (type `MessageExtrinsicSubmitter` ~line 48; `createMessage` ~line 778; `submitBucketsAddMessageExtrinsic` ~line 1497; `buildBucketsWriteMessageInput` ~line 2581)
- Test: `tests/integration/didCommRepository.spec.ts`

**Interfaces:**
- Consumes: existing `createMessage(bucketId, message, ownerAddress?, onUpdate?, tag?)`.
- Produces: `createMessage(bucketId: string, message: string, ownerAddress?: string, onUpdate?: ExtrinsicUpdateHandler, tag?: string, contentType?: string): Promise<CreateMessageResult>` — an explicit `contentType` overrides the tag-derived default in the on-chain metadata. Task 2 calls this with a contentType; Tasks 4/6 call it without one (unchanged text path).

- [ ] **Step 1: Write the failing tests**

In `tests/integration/didCommRepository.spec.ts`, after the existing `it("submits buckets.write extrinsic", ...)` block (~line 224), add:

```ts
  it("passes contentType override through to the message submitter", async () => {
    let receivedContentType: string | undefined = "unset"
    const repository = new DidCommRepository(
      {
        rpc: async () => [] as unknown[],
        getEndpoint: () => "wss://example-chain"
      },
      async () => "0xignored",
      async () => "0xignored-bucket",
      async () => [],
      async () => [],
      async () => [],
      async (_endpoint, _bucketId, _message, _ownerAddress, _onUpdate, _tag, _pinataConfig, contentType) => {
        receivedContentType = contentType
        return "0xmsg790"
      }
    )

    await repository.createMessage("bucket-7", "bafy-file-cid", "5F3sa2TJ...owner", undefined, undefined, "image/png")

    expect(receivedContentType).toBe("image/png")
  })

  it("passes no contentType to the message submitter when none is given", async () => {
    let receivedContentType: string | undefined = "unset"
    const repository = new DidCommRepository(
      {
        rpc: async () => [] as unknown[],
        getEndpoint: () => "wss://example-chain"
      },
      async () => "0xignored",
      async () => "0xignored-bucket",
      async () => [],
      async () => [],
      async () => [],
      async (_endpoint, _bucketId, _message, _ownerAddress, _onUpdate, _tag, _pinataConfig, contentType) => {
        receivedContentType = contentType
        return "0xmsg791"
      }
    )

    await repository.createMessage("bucket-7", "hello world", "5F3sa2TJ...owner")

    expect(receivedContentType).toBeUndefined()
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/integration/didCommRepository.spec.ts -t "contentType"`
Expected: the override test FAILS with `expected undefined to be 'image/png'` (vitest strips types at runtime, so the extra argument is silently ignored until the threading exists; the "no contentType" test passes already and stays as a regression guard).

- [ ] **Step 3: Implement the threading**

In `app/services/papi/didCommRepository.ts`:

3a. `MessageExtrinsicSubmitter` type (~line 48–59) — add trailing `contentType?: string`:

```ts
type MessageExtrinsicSubmitter = (
  endpoint: string,
  bucketId: string,
  message: string,
  ownerAddress: string,
  onUpdate?: ExtrinsicUpdateHandler,
  tag?: string,
  pinataConfig?: PinataConfig,
  contentType?: string
) => Promise<string>
```

3b. `createMessage` (~line 778) — add the 6th parameter and pass it through. The signature becomes:

```ts
  async createMessage(
    bucketId: string,
    message: string,
    ownerAddress?: string,
    onUpdate?: ExtrinsicUpdateHandler,
    tag?: string,
    contentType?: string
  ): Promise<CreateMessageResult> {
```

After the existing `const trimmedTag = ...` line (~795), add:

```ts
    const trimmedContentType = typeof contentType === "string" ? contentType.trim() : ""
```

And extend the `this.submitMessageExtrinsic(...)` call (~line 806) with the extra argument:

```ts
    const txHash = await this.submitMessageExtrinsic(
      endpoint,
      trimmedBucketId,
      trimmedMessage,
      ownerAddress,
      onUpdate,
      trimmedTag || undefined,
      this.pinataConfig,
      trimmedContentType || undefined
    )
```

3c. `submitBucketsAddMessageExtrinsic` (~line 1497) — add trailing param to the signature:

```ts
async function submitBucketsAddMessageExtrinsic(
  endpoint: string,
  bucketId: string,
  message: string,
  ownerAddress: string,
  onUpdate?: ExtrinsicUpdateHandler,
  tag?: string,
  pinataConfig?: PinataConfig,
  contentType?: string
): Promise<string> {
```

and pass it to the input builder (~line 1544):

```ts
      const messageInput = await buildBucketsWriteMessageInput(cid, message, tag, contentType)
```

3d. `buildBucketsWriteMessageInput` (~line 2581) — accept the override. Signature:

```ts
async function buildBucketsWriteMessageInput(referenceCid: string, message: string, tag?: string, contentTypeOverride?: string): Promise<{
```

and replace the `const contentType = ...` assignment (~line 2600–2602) with:

```ts
  const trimmedContentTypeOverride = typeof contentTypeOverride === "string" ? contentTypeOverride.trim() : ""
  const contentType = trimmedContentTypeOverride || (normalizedTag === "didcomm/key-sharing-v1"
    ? "application/didcomm-encrypted+json"
    : "text/plain;charset=utf-8")
```

Do NOT touch the `buildBucketsWriteMessageInput(cid, message, tag)` call in the batchAll key-rotation path (~line 1689) — it keeps the tag-derived default.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/integration/didCommRepository.spec.ts`
Expected: PASS, including all pre-existing tests.

- [ ] **Step 5: Commit**

```bash
git add app/services/papi/didCommRepository.ts tests/integration/didCommRepository.spec.ts
git commit -m "feat: thread contentType override through createMessage to buckets.write metadata"
```

---

### Task 2: Add `DidCommRepository.createFileMessage`

**Files:**
- Modify: `app/services/papi/didCommRepository.ts` (insert new method directly after `createMessage`, i.e. after the closing brace at ~line 819)
- Test: `tests/integration/didCommRepository.spec.ts`

**Interfaces:**
- Consumes: `createMessage(..., contentType?)` from Task 1; module-level `resolvePinataConfig` and imported `PinataStorageAdapter` (both already present in the file).
- Produces: `createFileMessage(bucketId: string, fileJwe: string, fileContentType: string, ownerAddress?: string, onUpdate?: ExtrinsicUpdateHandler): Promise<CreateMessageResult>` — uploads the file JWE to IPFS, then submits the bare file CID as the message with the file's contentType. Tasks 4 and 6 call this from the pages.

- [ ] **Step 1: Write the failing tests**

In `tests/integration/didCommRepository.spec.ts`, change the vitest import (line 1) to:

```ts
import { afterEach, describe, expect, it, vi } from "vitest"
```

Inside the top-level `describe`, add an `afterEach` hook (put it right under `describe("DidCommRepository", () => {`):

```ts
  afterEach(() => {
    vi.unstubAllGlobals()
  })
```

Then add these tests after the Task 1 tests:

```ts
  it("uploads the file JWE and submits buckets.write with the bare file CID and real content type", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: { cid: "bafy-file-cid" } })
    })))

    const submitted: { message?: string; tag?: string; contentType?: string } = {}
    const repository = new DidCommRepository(
      {
        rpc: async () => [] as unknown[],
        getEndpoint: () => "wss://example-chain"
      },
      async () => "0xignored",
      async () => "0xignored-bucket",
      async () => [],
      async () => [],
      async () => [],
      async (_endpoint, _bucketId, message, _ownerAddress, _onUpdate, tag, _pinataConfig, contentType) => {
        submitted.message = message
        submitted.tag = tag
        submitted.contentType = contentType
        return "0xfile123"
      },
      // Positions 8-15 (member/key/tag submitters) use defaults; position 16 is pinataConfig.
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      { jwt: "test-jwt" }
    )

    const result = await repository.createFileMessage(
      "bucket-7",
      "eyJhbGciOiJFQ0RILUVTK0EyNTZLVyJ9.a.b.c.d",
      "image/png",
      "5F3sa2TJ...owner"
    )

    expect(result.method).toBe("buckets.write")
    expect(result.txHash).toBe("0xfile123")
    expect(submitted.message).toBe("bafy-file-cid")
    expect(submitted.contentType).toBe("image/png")
    expect(submitted.tag).toBeUndefined()
  })

  it("aborts createFileMessage without submitting when the file upload fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => "server error"
    })))

    const submitter = vi.fn(async () => "0xshould-not-be-called")
    const updates: { stage: string; message: string }[] = []
    const repository = new DidCommRepository(
      {
        rpc: async () => [] as unknown[],
        getEndpoint: () => "wss://example-chain"
      },
      async () => "0xignored",
      async () => "0xignored-bucket",
      async () => [],
      async () => [],
      async () => [],
      submitter,
      // Positions 8-15 (member/key/tag submitters) use defaults; position 16 is pinataConfig.
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      { jwt: "test-jwt" }
    )

    await expect(
      repository.createFileMessage(
        "bucket-7",
        "eyJhbGciOiJFQ0RILUVTK0EyNTZLVyJ9.a.b.c.d",
        "image/png",
        "5F3sa2TJ...owner",
        (update) => updates.push(update)
      )
    ).rejects.toThrow("IPFS file upload failed")

    expect(submitter).not.toHaveBeenCalled()
    expect(updates.some((update) => update.stage === "error")).toBe(true)
  })

  it("falls back to application/octet-stream when the file content type is blank", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: { cid: "bafy-file-cid" } })
    })))

    let receivedContentType: string | undefined
    const repository = new DidCommRepository(
      {
        rpc: async () => [] as unknown[],
        getEndpoint: () => "wss://example-chain"
      },
      async () => "0xignored",
      async () => "0xignored-bucket",
      async () => [],
      async () => [],
      async () => [],
      async (_endpoint, _bucketId, _message, _ownerAddress, _onUpdate, _tag, _pinataConfig, contentType) => {
        receivedContentType = contentType
        return "0xfile124"
      },
      // Positions 8-15 (member/key/tag submitters) use defaults; position 16 is pinataConfig.
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      { jwt: "test-jwt" }
    )

    await repository.createFileMessage("bucket-7", "eyJhbGciOi.a.b.c.d", "   ", "5F3sa2TJ...owner")

    expect(receivedContentType).toBe("application/octet-stream")
  })

  it("rejects createFileMessage when the file payload is empty", async () => {
    const repository = new DidCommRepository(
      { rpc: async () => "0xignored", getEndpoint: () => "wss://example-chain" },
      async () => "0xignored",
      async () => "0xignored-bucket"
    )

    await expect(
      repository.createFileMessage("bucket-7", "   ", "image/png", "5F3sa2TJ...owner")
    ).rejects.toThrow("File payload is required")
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/integration/didCommRepository.spec.ts -t "createFileMessage"`
Expected: FAIL with "repository.createFileMessage is not a function" (and typecheck errors for the missing method).

- [ ] **Step 3: Implement `createFileMessage`**

In `app/services/papi/didCommRepository.ts`, insert directly after the closing brace of `createMessage` (~line 819):

```ts
  async createFileMessage(
    bucketId: string,
    fileJwe: string,
    fileContentType: string,
    ownerAddress?: string,
    onUpdate?: ExtrinsicUpdateHandler
  ): Promise<CreateMessageResult> {
    const trimmedBucketId = bucketId.trim()
    if (!trimmedBucketId) {
      throw new Error("Bucket id is required")
    }

    const trimmedFileJwe = fileJwe.trim()
    if (!trimmedFileJwe) {
      throw new Error("File payload is required")
    }

    if (!ownerAddress) {
      throw new Error("Wallet must be connected to submit buckets.write extrinsic")
    }

    const trimmedContentType = fileContentType.trim() || "application/octet-stream"

    const storageAdapter = new PinataStorageAdapter(resolvePinataConfig(this.pinataConfig))
    let fileCid = ""
    try {
      fileCid = await storageAdapter.upload(trimmedFileJwe)
    } catch (error) {
      const details = error instanceof Error ? error.message : "Unknown upload error"
      const failureMessage = `IPFS file upload failed; aborting buckets.write submission. ${details}`
      onUpdate?.({
        stage: "error",
        message: failureMessage
      })
      throw new Error(failureMessage)
    }

    return this.createMessage(trimmedBucketId, fileCid, ownerAddress, onUpdate, undefined, trimmedContentType)
  }
```

(`PinataStorageAdapter` and `resolvePinataConfig` are already imported/defined in this module — no import changes.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/integration/didCommRepository.spec.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add app/services/papi/didCommRepository.ts tests/integration/didCommRepository.spec.ts
git commit -m "feat: add createFileMessage uploading encrypted files as separate IPFS objects"
```

---

### Task 3: `ChatMessageEntry` explicit attachment prop

**Files:**
- Modify: `app/components/common/ChatMessageEntry.vue` (interfaces ~lines 2–32, `attachment` computed ~line 46)

**Interfaces:**
- Produces: exported `interface ChatMessageAttachment { contentType: string; fileName?: string; data: string }` and `ChatMessageProps.attachment?: ChatMessageAttachment`. Rendering prefers the prop, falls back to the legacy body-envelope parse. Tasks 5 and 7 build these attachment objects.

There is no component-test infrastructure in this repo (no @vue/test-utils), so this task is gated by typecheck plus the read-side tasks' manual verification.

- [ ] **Step 1: Add the attachment types**

In the first `<script lang="ts">` block, add after the `AttachmentEnvelope` interface (~line 32):

```ts
export interface ChatMessageAttachment {
  contentType: string
  fileName?: string
  data: string // base64
}
```

and add to `ChatMessageProps` (after `contentType?: string`):

```ts
  attachment?: ChatMessageAttachment
```

- [ ] **Step 2: Prefer the explicit prop in the attachment computed**

Replace (line 46):

```ts
const attachment = computed(() => parseAttachmentEnvelope(props.message.body))
```

with:

```ts
function defaultFileName(contentType: string): string {
  const subtype = contentType.split("/")[1]?.split(";")[0]?.trim()
  return `attachment.${subtype || "bin"}`
}

const attachment = computed<AttachmentEnvelope | null>(() => {
  const explicit = props.message.attachment
  if (explicit) {
    return {
      type: "attachment",
      contentType: explicit.contentType,
      fileName: explicit.fileName || defaultFileName(explicit.contentType),
      data: explicit.data
    }
  }
  return parseAttachmentEnvelope(props.message.body)
})
```

Everything downstream (`isImage`, `dataUrl`, download, template) already consumes this computed and needs no changes.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no new errors (pre-existing errors, if any, are unchanged — note them in the task report).

- [ ] **Step 4: Commit**

```bash
git add app/components/common/ChatMessageEntry.vue
git commit -m "feat: accept explicit attachment prop in ChatMessageEntry with legacy envelope fallback"
```

---

### Task 4: Indexed-bucket page — send files as encrypted CID-pointer messages

**Files:**
- Modify: `app/pages/indexed-bucket/[id]/index.vue` (`encryptOutgoing` ~line 335; `buildAttachmentEnvelope` ~line 382; `sendMessage` ~line 392)

**Interfaces:**
- Consumes: `didCommRepository.createFileMessage(bucketId, fileJwe, fileContentType, ownerAddress, onUpdate)` from Task 2.
- Produces: nothing consumed by later tasks; page-local change.

- [ ] **Step 1: Generalize `encryptOutgoing` to binary plaintext with extra header params**

Replace the function (~lines 335–349) with:

```ts
async function encryptOutgoing(plaintext: Uint8Array | string, extraProtectedHeader?: Record<string, string>): Promise<string> {
  const sk = activeSecretJwk.value
  if (!sk || !isX25519Secret(sk)) {
    throw new Error("No decrypted bucket key available. Decrypt key-sharing first.")
  }

  const recipientPublicJwk: jose.JWK = {
    kty: "OKP", crv: "X25519", x: sk.x as string, use: "enc",
    kid: typeof sk.kid === "string" ? sk.kid : undefined
  }
  const publicKey = await jose.importJWK(recipientPublicJwk, "ECDH-ES+A256KW")
  const plaintextBytes = typeof plaintext === "string" ? new TextEncoder().encode(plaintext) : plaintext
  return await new jose.CompactEncrypt(plaintextBytes)
    .setProtectedHeader({ alg: "ECDH-ES+A256KW", enc: "A256GCM", typ: "didcomm/encrypted-message-v1", kid: recipientPublicJwk.kid, ...extraProtectedHeader })
    .encrypt(publicKey)
}
```

- [ ] **Step 2: Delete `buildAttachmentEnvelope`**

Remove the whole function (~lines 382–390):

```ts
function buildAttachmentEnvelope(file: File, base64Data: string): string {
  const base64 = base64Data.includes(",") ? base64Data.split(",")[1]! : base64Data
  return JSON.stringify({
    type: "attachment",
    contentType: file.type || "application/octet-stream",
    fileName: file.name,
    data: base64,
  })
}
```

- [ ] **Step 3: Branch `sendMessage` between file and text sends**

Replace the `try` block body of `sendMessage` (~lines 404–413, from `const plaintext = attachment` through `await loadAll()`) with:

```ts
    let result
    if (attachment) {
      const fileContentType = attachment.file.type || "application/octet-stream"
      const fileBytes = new Uint8Array(await attachment.file.arrayBuffer())
      const fileJwe = await encryptOutgoing(fileBytes, { cty: fileContentType, filename: attachment.file.name })
      result = await didCommRepository.createFileMessage(
        bucketId.value, fileJwe, fileContentType, session.accountAddress, logExtrinsicUpdate
      )
    } else {
      const encrypted = await encryptOutgoing(textPayload)
      result = await didCommRepository.createMessage(
        bucketId.value, encrypted, session.accountAddress, logExtrinsicUpdate
      )
    }
    operations.add("bucket_write", result.method, "success", `Message submitted: ${result.txHash}`)
    await loadAll()
```

The `catch`/`finally` blocks stay exactly as they are (they already restore `savedText` and the pending attachment).

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add "app/pages/indexed-bucket/[id]/index.vue"
git commit -m "feat: send files as encrypted CID-pointer messages on indexed-bucket page"
```

---

### Task 5: Indexed-bucket page — resolve and render file messages

**Files:**
- Modify: `app/pages/indexed-bucket/[id]/index.vue` (imports ~line 5; state ~line 97; `chatMessages` ~line 152; `loadAll` ~line 220; helpers near `summarize` ~line 587; watcher ~line 607)

**Interfaces:**
- Consumes: `ChatMessageAttachment` and `ChatMessageProps.attachment` from Task 3.
- Produces: nothing consumed by later tasks; Task 7 mirrors the same pattern with its own local names.

- [ ] **Step 1: Import the attachment type and add state**

Extend the import on line 5:

```ts
import ChatMessageEntry, { type ChatMessageProps, type ChatMessageAttachment } from "../../../components/common/ChatMessageEntry.vue"
```

After `const decryptErrorById = ref<Record<string, string>>({})` (~line 97), add:

```ts
const attachmentById = ref<Record<string, ChatMessageAttachment>>({})
```

- [ ] **Step 2: Add detection helpers and attachment hydration**

Insert after the `decryptMessages` function (~line 332, before the "Send message" section):

```ts
// ── File attachments (CID-pointer messages) ────────────────────────
const textMessageContentType = "text/plain;charset=utf-8"
const keySharingContentType = "application/didcomm-encrypted+json"

function looksLikeBareCid(value: string): boolean {
  return /^[A-Za-z0-9]{32,128}$/.test(value)
}

// A file message carries a real MIME contentType on-chain and a bare file CID as payload.
function fileMessagePayloadCid(m: IndexedMessage): string | undefined {
  if (m.tag === keySharingTag) return undefined
  const ct = m.contentType?.trim()
  if (!ct || ct === textMessageContentType || ct === keySharingContentType) return undefined
  const payload = (decryptedById.value[m.id] ?? payloadById.value[m.id])?.trim()
  return payload && looksLikeBareCid(payload) ? payload : undefined
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

async function hydrateAttachments(msgs: IndexedMessage[]) {
  const next: Record<string, ChatMessageAttachment> = { ...attachmentById.value }
  const nextE: Record<string, string> = { ...decryptErrorById.value }
  const sk = activeSecretJwk.value

  await Promise.all(msgs.map(async m => {
    if (next[m.id]) return
    const fileCid = fileMessagePayloadCid(m)
    if (!fileCid) return
    try {
      if (!sk || !isX25519Secret(sk)) throw new Error("No decrypted bucket key available. Decrypt key-sharing first.")
      const res = await fetch(resolveUrl(fileCid))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const fileJwe = (await res.text()).trim()
      const key = await jose.importJWK(sk as jose.JWK, "ECDH-ES+A256KW")
      const { plaintext, protectedHeader } = await jose.compactDecrypt(fileJwe, key)
      next[m.id] = {
        contentType: m.contentType?.trim() || "application/octet-stream",
        fileName: typeof protectedHeader.filename === "string" ? protectedHeader.filename : undefined,
        data: bytesToBase64(plaintext)
      }
    } catch (e) {
      nextE[m.id] = e instanceof Error ? e.message : "Attachment unavailable"
    }
  }))

  attachmentById.value = next
  decryptErrorById.value = nextE
}
```

- [ ] **Step 3: Hydrate attachments after decryption in both pipelines**

In `loadAll`, after `// 5. Decrypt normal messages using the active key` / `await decryptMessages(detail.messages)` (~line 220), add:

```ts
    // 6. Resolve file attachments referenced by CID-pointer messages
    await hydrateAttachments(detail.messages)
```

In the `settings.x25519SecretJwk` watcher (~line 607), after `await decryptMessages(messages.value)`, add:

```ts
  await hydrateAttachments(messages.value)
```

- [ ] **Step 4: Pass the attachment into `ChatMessageEntry`**

In the `chatMessages` computed (~line 170), add `attachment` to the returned object (after `contentType: m.contentType ?? undefined,`):

```ts
      attachment: attachmentById.value[m.id],
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add "app/pages/indexed-bucket/[id]/index.vue"
git commit -m "feat: resolve and render CID-pointer file messages on indexed-bucket page"
```

---

### Task 6: Messages page — send files as encrypted CID-pointer messages

**Files:**
- Modify: `app/pages/messages/bucket/[id]/index.vue` (`encryptOutgoingBucketMessage` ~line 259; `buildAttachmentEnvelope` ~line 1404; `sendMessage` ~line 1414)

**Interfaces:**
- Consumes: `didCommRepository.createFileMessage(...)` from Task 2.
- Produces: nothing consumed by later tasks; page-local change.

- [ ] **Step 1: Generalize `encryptOutgoingBucketMessage`**

Replace the function (~lines 259–283) with:

```ts
async function encryptOutgoingBucketMessage(plaintext: Uint8Array | string, extraProtectedHeader?: Record<string, string>): Promise<string> {
  const secretJwk = activeBucketEncryptionSecretJwk.value
  if (!secretJwk || !isX25519SecretJwk(secretJwk)) {
    throw new Error("No decrypted bucket encryption key is available. Decrypt latest key-sharing payload first.")
  }

  const recipientPublicJwk: jose.JWK = {
    kty: "OKP",
    crv: "X25519",
    x: secretJwk.x,
    use: "enc",
    kid: typeof secretJwk.kid === "string" ? secretJwk.kid : undefined
  }

  const publicKey = await jose.importJWK(recipientPublicJwk, "ECDH-ES+A256KW")
  const plaintextBytes = typeof plaintext === "string" ? new TextEncoder().encode(plaintext) : plaintext
  const encryptor = new jose.CompactEncrypt(plaintextBytes)
    .setProtectedHeader({
      alg: "ECDH-ES+A256KW",
      enc: "A256GCM",
      typ: encryptedMessageTag,
      kid: recipientPublicJwk.kid,
      ...extraProtectedHeader
    })

  return await encryptor.encrypt(publicKey)
}
```

- [ ] **Step 2: Delete `buildAttachmentEnvelope`**

Remove the whole function (~lines 1404–1412):

```ts
function buildAttachmentEnvelope(file: File, base64Data: string): string {
  const base64 = base64Data.includes(",") ? base64Data.split(",")[1]! : base64Data
  return JSON.stringify({
    type: "attachment",
    contentType: file.type || "application/octet-stream",
    fileName: file.name,
    data: base64,
  })
}
```

- [ ] **Step 3: Branch `sendMessage`**

In `sendMessage` (~line 1445), replace:

```ts
    const plaintext = attachment
      ? buildAttachmentEnvelope(attachment.file, attachment.dataUrl)
      : textPayload
    const encryptedPayload = await encryptOutgoingBucketMessage(plaintext)
    const result = await didCommRepository.createMessage(
      bucketId.value,
      encryptedPayload,
      session.accountAddress,
      logExtrinsicUpdate
    )
```

with:

```ts
    let result
    if (attachment) {
      const fileContentType = attachment.file.type || "application/octet-stream"
      const fileBytes = new Uint8Array(await attachment.file.arrayBuffer())
      const fileJwe = await encryptOutgoingBucketMessage(fileBytes, { cty: fileContentType, filename: attachment.file.name })
      result = await didCommRepository.createFileMessage(
        bucketId.value,
        fileJwe,
        fileContentType,
        session.accountAddress,
        logExtrinsicUpdate
      )
    } else {
      const encryptedPayload = await encryptOutgoingBucketMessage(textPayload)
      result = await didCommRepository.createMessage(
        bucketId.value,
        encryptedPayload,
        session.accountAddress,
        logExtrinsicUpdate
      )
    }
```

The surrounding pending-message bookkeeping, `catch`, and `finally` stay unchanged.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add "app/pages/messages/bucket/[id]/index.vue"
git commit -m "feat: send files as encrypted CID-pointer messages on bucket messages page"
```

---

### Task 7: Messages page — resolve and render file messages

**Files:**
- Modify: `app/pages/messages/bucket/[id]/index.vue` (import ~line 4; `ChatMessage` interface ~line 63; state ~line 121; `loadMessages` ~line 200; helpers near `decryptReceivedMessages` ~line 407; `toChatMessage` ~line 1229; `toChatMessageProps` ~line 1335; post-key-decrypt call sites ~lines 335 and 1503)

**Interfaces:**
- Consumes: `ChatMessageAttachment` / `ChatMessageProps.attachment` from Task 3; existing page helpers `resolveMessageTag`, `resolveGatewayUrl`, `toRecord`, `firstString`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Import the attachment type, extend interfaces and state**

Extend the import on line 4:

```ts
import ChatMessageEntry, { type ChatMessageProps, type ChatMessageAttachment } from "../../../../components/common/ChatMessageEntry.vue"
```

Add to the `ChatMessage` interface (~line 63, after `payloadLength?: number`):

```ts
  attachment?: ChatMessageAttachment
```

After `const messageDecryptErrorById = ref<Record<string, string>>({})` (~line 121), add:

```ts
const messageAttachmentById = ref<Record<string, ChatMessageAttachment>>({})
```

- [ ] **Step 2: Extract a shared contentType resolver**

Add next to `resolveMessageTag` (~line 350):

```ts
function resolveMessageContentType(message: BucketMessage): string | undefined {
  const rawRecord = toRecord(message.raw)
  const metadataRecord =
    toRecord(rawRecord?.metadataInput) ??
    toRecord(rawRecord?.metadata) ??
    toRecord(rawRecord?.messageMetadata)

  return (
    firstString(metadataRecord, ["contentType", "mimeType", "type"]) ??
    firstString(rawRecord, ["contentType", "mimeType"])
  )
}
```

In `toChatMessage` (~line 1240), replace the inline extraction:

```ts
  const contentType =
    firstString(metadataRecord, ["contentType", "mimeType", "type"]) ??
    firstString(rawRecord, ["contentType", "mimeType"])
```

with:

```ts
  const contentType = resolveMessageContentType(message)
```

(The local `metadataRecord` in `toChatMessage` remains in use for other fields — leave it.)

- [ ] **Step 3: Add detection helpers and attachment hydration**

Insert after `decryptReceivedMessages` (~line 407):

```ts
// ── File attachments (CID-pointer messages) ────────────────────────
const textMessageContentType = "text/plain;charset=utf-8"
const keySharingContentType = "application/didcomm-encrypted+json"

function looksLikeBareCid(value: string): boolean {
  return /^[A-Za-z0-9]{32,128}$/.test(value)
}

// A file message carries a real MIME contentType on-chain and a bare file CID as payload.
function fileMessagePayloadCid(entry: BucketMessage): string | undefined {
  if (resolveMessageTag(entry) === keySharingTag) return undefined
  const contentType = resolveMessageContentType(entry)?.trim()
  if (!contentType || contentType === textMessageContentType || contentType === keySharingContentType) return undefined
  const payload = (decryptedMessagePayloadById.value[entry.id] ?? messagePayloadById.value[entry.id])?.trim()
  return payload && looksLikeBareCid(payload) ? payload : undefined
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

async function hydrateMessageAttachments(entries: BucketMessage[]): Promise<void> {
  const next: Record<string, ChatMessageAttachment> = { ...messageAttachmentById.value }
  const nextErrors: Record<string, string> = { ...messageDecryptErrorById.value }
  const secretJwk = activeBucketEncryptionSecretJwk.value

  await Promise.all(entries.map(async (entry) => {
    if (next[entry.id]) return
    const fileCid = fileMessagePayloadCid(entry)
    if (!fileCid) return
    try {
      if (!secretJwk || !isX25519SecretJwk(secretJwk)) {
        throw new Error("No active bucket encryption key is available for decrypting attachments")
      }
      const response = await fetch(`${resolveGatewayUrl()}/ipfs/${fileCid}`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const fileJwe = (await response.text()).trim()
      const privateKey = await jose.importJWK(secretJwk as jose.JWK, "ECDH-ES+A256KW")
      const { plaintext, protectedHeader } = await jose.compactDecrypt(fileJwe, privateKey)
      next[entry.id] = {
        contentType: resolveMessageContentType(entry)?.trim() || "application/octet-stream",
        fileName: typeof protectedHeader.filename === "string" ? protectedHeader.filename : undefined,
        data: bytesToBase64(plaintext)
      }
    } catch (error) {
      nextErrors[entry.id] = error instanceof Error ? error.message : "Attachment unavailable"
    }
  }))

  messageAttachmentById.value = next
  messageDecryptErrorById.value = nextErrors
}
```

- [ ] **Step 4: Hydrate after every decrypt pass**

There are three `decryptReceivedMessages` call sites; add a matching hydration call after each:

- `loadMessages` (~line 209): after `await decryptReceivedMessages(loadedMessages)` add
  `await hydrateMessageAttachments(loadedMessages)`
- ~line 335 (after key-sharing decrypt): after `await decryptReceivedMessages(messages.value)` add
  `await hydrateMessageAttachments(messages.value)`
- ~line 1503 (watcher): after `await decryptReceivedMessages(messages.value)` add
  `await hydrateMessageAttachments(messages.value)`

- [ ] **Step 5: Thread the attachment into the chat props**

In `toChatMessage`'s returned object (~line 1254), add after `payloadLength: ...`:

```ts
    attachment: messageAttachmentById.value[message.id]
```

In `toChatMessageProps` (~line 1335), add after `payloadError: message.payloadError,`:

```ts
    attachment: message.attachment,
```

- [ ] **Step 6: Typecheck and full test run**

Run: `npm run typecheck`
Expected: no new errors.
Run: `npm test`
Expected: PASS (unit + integration).

- [ ] **Step 7: Commit**

```bash
git add "app/pages/messages/bucket/[id]/index.vue"
git commit -m "feat: resolve and render CID-pointer file messages on bucket messages page"
```

---

### Task 8: Final verification

**Files:** none new — verification only.

- [ ] **Step 1: Full automated pass**

Run: `npm run lint`, `npm run typecheck`, `npm test`
Expected: all pass with no new findings versus the state before this plan.

- [ ] **Step 2: Manual end-to-end check (requires wallet, chain, Pinata credentials — coordinate with the user)**

In a bucket with a shared key, verify on both `/indexed-bucket/<id>` and `/messages/bucket/<id>`:

1. Send a text message → renders as before; debug panel shows `Content Type: text/plain;charset=utf-8`.
2. Send an image → bubble renders the image; debug panel shows the real MIME type (e.g. `image/png`) and the indexer's payload (`ipfsContent` / IPFS Ref content) is a bare CID.
3. Send a non-media file (e.g. PDF) → file card shows the original file name; download preserves the name.
4. An old pre-change attachment message still renders via the envelope fallback.

- [ ] **Step 3: Report results to the user**

Report test/typecheck/lint output and which manual checks were or were not executable in the session.

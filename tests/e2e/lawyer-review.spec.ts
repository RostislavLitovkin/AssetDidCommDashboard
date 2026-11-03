import { createHash } from "node:crypto"
import { PublicKey } from "@solana/web3.js"
import { expect, test, type Page, type Route } from "@playwright/test"
import { CompactEncrypt, compactDecrypt, exportJWK, generateKeyPair, importJWK, type JWK } from "jose"
import type { ApiBucket, ApiMessage } from "../../app/services/buckets/types"
import { getLegalClusterConfig } from "../../app/services/lawyer/cluster"

const SPV = new PublicKey(new Uint8Array(32).fill(1)).toBase58()
const DEVELOPER = new PublicKey(new Uint8Array(32).fill(2)).toBase58()
const OTHER = new PublicKey(new Uint8Array(32).fill(3)).toBase58()
const BLOCKHASH = new PublicKey(new Uint8Array(32).fill(4)).toBase58()
const SPV_PDF = new TextEncoder().encode("%PDF-SPV")
const DEVELOPER_PDF = new TextEncoder().encode("%PDF-DEVELOPER")

test.describe.configure({ timeout: 120_000 })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("rxm.setupTutorial.v1", "done"))
})

interface ReviewFixture {
  category?: string
  properties?: Record<string, unknown> | null
  messages?: ApiMessage[]
  taggedMessages?: ApiMessage[]
  outgoingMessages?: string[]
  listing?: Record<string, unknown>
  lawyerCandidacies?: Record<string, unknown>[]
  spvFinalization?: Record<string, unknown> | null
  settlement?: Record<string, unknown> | null
}

interface CapturedInstruction {
  programId: string
  data: number[]
  keys: { pubkey: string; isSigner: boolean; isWritable: boolean }[]
}

function message(overrides: Partial<ApiMessage>): ApiMessage {
  return {
    id: "message-1",
    messageId: "1",
    bucketId: "39",
    contributor: "Admin",
    reference: null,
    tag: "lawyer/terms-document",
    description: "terms.pdf",
    contentType: "application/pdf",
    contentHash: null,
    ipfsContent: null,
    createdAt: "2026-10-01T12:00:01.000Z",
    ...overrides,
  }
}

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64")
}

function expectedDocumentHash(
  spvBytes: Uint8Array = SPV_PDF,
  developerBytes: Uint8Array = DEVELOPER_PDF,
): string {
  const domain = new TextEncoder().encode("XCAVATE_LEGAL_DOCUMENT_SET_V1")
  const payload = new Uint8Array(domain.length + 16 + spvBytes.length + developerBytes.length)
  const view = new DataView(payload.buffer)
  let offset = 0
  payload.set(domain, offset)
  offset += domain.length
  view.setBigUint64(offset, BigInt(spvBytes.length), true)
  offset += 8
  payload.set(spvBytes, offset)
  offset += spvBytes.length
  view.setBigUint64(offset, BigInt(developerBytes.length), true)
  offset += 8
  payload.set(developerBytes, offset)
  return `0x${createHash("sha256").update(payload).digest("hex")}`
}

function reviewProperties(cluster?: "devnet" | "mainnet"): Record<string, unknown> {
  return {
    property_id: "42",
    listing_id: "42",
    ...(cluster ? { cluster } : {}),
    spv_lawyer: SPV,
    developer_lawyer: DEVELOPER,
  }
}

function listing(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    listingId: "42",
    assetId: "42",
    spvLawyer: SPV,
    spvLawyerDocStatus: "PENDING",
    spvLawyerDocumentsHash: "0x00",
    developerLawyer: DEVELOPER,
    developerLawyerDocStatus: "PENDING",
    developerLawyerDocumentsHash: "0x00",
    secondAttempt: false,
    status: "SOLD_OUT",
    legalDeadline: 1_900_000_000,
    ...overrides,
  }
}

async function mockBackend(page: Page, fixture: ReviewFixture): Promise<{
  indexerRequests: string[]
  bucketDetailRequests: string[]
  tagRequests: string[]
}> {
  const indexerRequests: string[] = []
  const bucketDetailRequests: string[] = []
  const tagRequests: string[] = []
  const bucket: ApiBucket = {
    id: "row-39",
    bucketId: "39",
    namespaceId: null,
    creator: "Admin",
    name: "Lawyer review 42",
    category: fixture.category ?? "lawyer-document-review",
    isWritable: true,
    encryptionKey: null,
    createdAt: "2026-10-01T12:00:00.000Z",
    updatedAt: "2026-10-01T12:00:00.000Z",
    properties: fixture.properties === null
      ? null
      : JSON.stringify(fixture.properties ?? reviewProperties("devnet")),
  }
  const messages = fixture.messages ?? []
  const taggedMessages = fixture.taggedMessages ?? []
  const admins = [{ subjectId: "Admin" }]
  const contributors = [{ subjectId: SPV }, { subjectId: DEVELOPER }]

  await page.route("https://profile-api.xcavate.io/**", async (route) => {
    const request = route.request()
    if (!request.url().endsWith("/graphql")) {
      await route.fulfill({ status: 404, contentType: "application/json", body: "{}" })
      return
    }
    const body = request.postDataJSON() as {
      query: string
      variables?: { tag?: string; message?: { ipfsContent?: string | null } }
    }
    let data: Record<string, unknown> = {}
    if (body.query.includes("mutation WriteMessage")) {
      if (fixture.outgoingMessages && body.variables?.message?.ipfsContent) {
        fixture.outgoingMessages.push(body.variables.message.ipfsContent)
      }
      data = { write: { id: "outgoing-message", messageId: "9" } }
    } else if (body.query.includes("query BucketDetail")) {
      bucketDetailRequests.push(request.postData() ?? "")
      data = {
        bucket: {
          ...bucket,
          admins,
          contributors,
          viewers: [],
          messages,
        },
      }
    } else if (body.query.includes("query BucketByBucketId")) {
      data = { buckets: { nodes: [bucket] } }
    } else if (body.query.includes("query BucketMessagesByTag")) {
      tagRequests.push(request.postData() ?? "")
      const nodes = [...messages, ...taggedMessages]
        .filter((entry) => entry.tag === body.variables?.tag)
        .map(({ bucketId: _bucketId, ...entry }) => ({ ...entry, bucket: { bucketId: "39" } }))
      data = { messages: { nodes, pageInfo: { hasNextPage: false, endCursor: null } } }
    } else if (body.query.includes("query BucketMessages")) {
      const nodes = messages.map(({ bucketId: _bucketId, ...entry }) => ({ ...entry, bucket: { bucketId: "39" } }))
      data = { messages: { nodes, pageInfo: { hasNextPage: false, endCursor: null } } }
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ data }) })
  })

  await page.route("https://indexer-devnet.xcavate.io/graphql", async (route) => {
    indexerRequests.push(route.request().postData() ?? "")
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          listings: { nodes: [fixture.listing ?? listing()] },
          lawyerCandidacies: { nodes: fixture.lawyerCandidacies ?? [] },
          pendingFinalizations: {
            executeDeal: fixture.settlement ?? null,
            spvElection: fixture.spvFinalization ?? null,
          },
        },
      }),
    })
  })
  return { indexerRequests, bucketDetailRequests, tagRequests }
}

async function mockRpc(page: Page, beforeError?: () => Promise<void>): Promise<void> {
  await page.route("https://api.devnet.solana.com/**", async (route) => {
    const body = route.request().postDataJSON() as { id: number; method: string }
    if (beforeError) await beforeError()
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        error: { code: -32000, message: `Offline ${body.method} failure` },
      }),
    })
  })
}

async function mockSuccessfulRpc(
  page: Page,
  beforeBlockhash?: () => Promise<void>,
  multipleAccountValues: unknown[][] = [],
): Promise<void> {
  await page.route("https://api.devnet.solana.com/**", async (route) => {
    const body = route.request().postDataJSON() as { id: number; method: string }
    if (body.method === "getLatestBlockhash" && beforeBlockhash) await beforeBlockhash()
    const value = body.method === "getLatestBlockhash"
      ? { blockhash: BLOCKHASH, lastValidBlockHeight: 100 }
      : body.method === "simulateTransaction"
        ? { err: null, logs: [] }
        : body.method === "getSignatureStatuses"
          ? [{ slot: 1, confirmations: 1, err: null, confirmationStatus: "confirmed" }]
          : body.method === "getBlockHeight" || body.method === "getSlot"
            ? 1
            : body.method === "getBlockTime"
              ? 1_800_000_000
              : body.method === "getMultipleAccounts"
                ? multipleAccountValues.shift()
                : undefined
    if (value === undefined) throw new Error(`Unexpected mocked RPC method: ${body.method}`)
    const directResult = body.method === "getBlockHeight" || body.method === "getSlot" || body.method === "getBlockTime"
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: directResult ? value : { context: { slot: 1 }, value },
      }),
    })
  })
}

async function installWallet(
  page: Page,
  address: string,
  kind: "solana" | "polkadot" = "solana",
  mockedSignature?: string,
): Promise<void> {
  await page.addInitScript(({ walletAddress, walletKind, signature }) => {
    localStorage.setItem("rxm.walletSession", JSON.stringify({
      address: walletAddress,
      provider: "Phantom",
      kind: walletKind,
    }))
    const target = window as unknown as { phantom: unknown; capturedInstructions: CapturedInstruction[] }
    target.capturedInstructions = []
    const publicKey = { toBase58: () => walletAddress }
    target.phantom = {
      solana: {
        publicKey,
        connect: async () => ({ publicKey }),
        signMessage: async () => ({ signature: new Uint8Array(64).fill(9) }),
        signAndSendTransaction: async (transaction: {
          instructions: {
            programId: { toBase58: () => string }
            data: Uint8Array
            keys: { pubkey: { toBase58: () => string }; isSigner: boolean; isWritable: boolean }[]
          }[]
        }) => {
          if (!signature) throw new Error("A real transaction must not be submitted by this test")
          target.capturedInstructions.push(...transaction.instructions.map((instruction) => ({
            programId: instruction.programId.toBase58(),
            data: Array.from(instruction.data),
            keys: instruction.keys.map((key) => ({
              pubkey: key.pubkey.toBase58(),
              isSigner: key.isSigner,
              isWritable: key.isWritable,
            })),
          })))
          return { signature }
        },
      },
    }
  }, { walletAddress: address, walletKind: kind, signature: mockedSignature })
}

async function installPlaintextKey(page: Page): Promise<ApiMessage> {
  const pair = await generateKeyPair("ECDH-ES+A256KW", { crv: "X25519", extractable: true })
  const privateJwk = await exportJWK(pair.privateKey)
  privateJwk.use = "enc"
  privateJwk.kid = "browser-review-key"
  await page.addInitScript((jwk) => {
    localStorage.setItem("asset-didcomm.x25519-secret-jwk", JSON.stringify(jwk))
  }, privateJwk)
  return message({
    id: "key",
    messageId: "1",
    tag: "didcomm/key-sharing-v1",
    contentType: "application/json",
    ipfsContent: JSON.stringify({ id: "key-document", from: "Admin", to: [SPV, DEVELOPER], keys: [privateJwk] }),
  })
}

async function encryptedDocumentFixture(
  spvBytes: Uint8Array = SPV_PDF,
  developerBytes: Uint8Array = DEVELOPER_PDF,
): Promise<{ messages: ApiMessage[]; secretJwk: JWK }> {
  const pair = await generateKeyPair("ECDH-ES+A256KW", { crv: "X25519", extractable: true })
  const publicJwk = await exportJWK(pair.publicKey)
  const secretJwk = await exportJWK(pair.privateKey)
  publicJwk.use = "enc"
  publicJwk.kid = "hydrated-review-key"
  secretJwk.use = "enc"
  secretJwk.kid = "hydrated-review-key"
  const publicKey = await importJWK(publicJwk, "ECDH-ES+A256KW")
  const encrypt = async (bytes: Uint8Array, fileName: string) => await new CompactEncrypt(bytes)
    .setProtectedHeader({
      alg: "ECDH-ES+A256KW",
      enc: "A256GCM",
      typ: "didcomm/encrypted-message-v1",
      kid: publicJwk.kid,
      cty: "application/pdf",
      filename: fileName,
    })
    .encrypt(publicKey)
  const keyMessage = message({
    id: "key-1",
    messageId: "1",
    contributor: "Admin",
    tag: "didcomm/key-sharing-v1",
    description: null,
    contentType: "application/json",
    ipfsContent: JSON.stringify({ id: "key-document", from: "Admin", to: [SPV, DEVELOPER], keys: [secretJwk] }),
    createdAt: "2026-10-01T12:00:00.000Z",
  })
  const spv = message({
    id: "spv-2",
    messageId: "2",
    reference: "spv-cid",
    ipfsContent: await encrypt(spvBytes, "spv.pdf"),
    createdAt: "2026-10-01T12:00:02.000Z",
  })
  const developer = message({
    id: "developer-3",
    messageId: "3",
    reference: "https://documents.example/developer.pdf",
    ipfsContent: await encrypt(developerBytes, "developer.pdf"),
    createdAt: "2026-10-01T12:00:03.000Z",
  })
  return { messages: [keyMessage, spv, developer], secretJwk }
}

test("renders legacy review buckets as explicit devnet with read-only missing-document state", async ({ page }) => {
  const { indexerRequests } = await mockBackend(page, { properties: reviewProperties() })
  await page.goto("/indexed-bucket/39")

  await expect(page.getByRole("heading", { name: "Lawyer document review" })).toBeVisible()
  await expect(page.locator(".review-property")).toHaveText("Property 42 · devnet")
  await expect(page.getByText("Read-only review.", { exact: false })).toBeVisible()
  await expect(page.getByText("One or both lawyer documents are missing", { exact: false })).toBeVisible()
  await expect(page.getByRole("button", { name: "Submit document verdict" })).toHaveCount(0)
  expect(indexerRequests).toHaveLength(1)
})

test("announces malformed review metadata instead of hiding the review-category error", async ({ page }) => {
  await mockBackend(page, {
    properties: { ...reviewProperties("devnet"), spv_lawyer: "" },
  })
  await page.goto("/indexed-bucket/39")

  await expect(page.getByRole("alert").filter({ hasText: "This is not a valid lawyer review bucket." })).toBeVisible()
  await expect(page.getByRole("button", { name: "Retry review" })).toBeVisible()
})

test("loads inline base64 PDF bytes and derives the document-set hash", async ({ page }) => {
  await mockBackend(page, {
    messages: [
      message({ id: "spv", messageId: "1", ipfsContent: base64(SPV_PDF) }),
      message({ id: "developer", messageId: "2", ipfsContent: base64(DEVELOPER_PDF), createdAt: "2026-10-01T12:00:02.000Z" }),
    ],
  })
  await page.goto("/indexed-bucket/39")

  await expect(page.locator(".document-hash code")).toHaveAttribute("title", expectedDocumentHash())
  await expect(page.getByText("One or both lawyer documents are missing", { exact: false })).toHaveCount(0)
})

test("loads public URL and CID PDF references when no hydrated attachment exists", async ({ page }) => {
  const documentRequests: string[] = []
  await mockBackend(page, {
    messages: [
      message({ id: "spv", messageId: "1", reference: "https://documents.example/spv.pdf" }),
      message({ id: "developer", messageId: "2", reference: "developer-cid", createdAt: "2026-10-01T12:00:02.000Z" }),
    ],
  })
  await page.route("https://documents.example/spv.pdf", async (route) => {
    documentRequests.push(route.request().url())
    await route.fulfill({ contentType: "application/pdf", body: Buffer.from(SPV_PDF) })
  })
  await page.route("https://gateway.pinata.cloud/ipfs/developer-cid", async (route) => {
    documentRequests.push(route.request().url())
    await route.fulfill({ contentType: "application/pdf", body: Buffer.from(DEVELOPER_PDF) })
  })
  await page.goto("/indexed-bucket/39")

  await expect(page.locator(".document-hash code")).toHaveAttribute("title", expectedDocumentHash())
  expect(documentRequests).toEqual([
    "https://documents.example/spv.pdf",
    "https://gateway.pinata.cloud/ipfs/developer-cid",
    "https://documents.example/spv.pdf",
    "https://gateway.pinata.cloud/ipfs/developer-cid",
  ])
})

test("prefers existing hydrated attachments over downloading public references again", async ({ page }) => {
  const fixture = await encryptedDocumentFixture()
  await mockBackend(page, { messages: fixture.messages })
  await page.addInitScript((jwk) => {
    localStorage.setItem("asset-didcomm.x25519-secret-jwk", JSON.stringify(jwk))
  }, fixture.secretJwk)
  const documentRequests: string[] = []
  await page.route("https://gateway.pinata.cloud/ipfs/spv-cid", async (route) => {
    documentRequests.push(route.request().url())
    await route.fulfill({ contentType: "text/plain", body: fixture.messages[1]!.ipfsContent! })
  })
  await page.route("https://documents.example/developer.pdf", async (route) => {
    documentRequests.push(route.request().url())
    await route.fulfill({ contentType: "text/plain", body: fixture.messages[2]!.ipfsContent! })
  })
  await page.goto("/indexed-bucket/39")

  await expect(page.locator(".document-hash code")).toHaveAttribute("title", expectedDocumentHash())
  expect(documentRequests).toHaveLength(0)
})

test("clears a transient PDF hydration error after a successful reload", async ({ page }) => {
  const fixture = await encryptedDocumentFixture()
  await mockBackend(page, {
    messages: fixture.messages.map((entry) => entry.reference ? { ...entry, ipfsContent: null } : entry),
  })
  await page.addInitScript((jwk) => {
    localStorage.setItem("asset-didcomm.x25519-secret-jwk", JSON.stringify(jwk))
  }, fixture.secretJwk)
  let spvAttempts = 0
  await page.route("https://gateway.pinata.cloud/ipfs/spv-cid", async (route) => {
    spvAttempts += 1
    if (spvAttempts === 1) {
      await route.abort("failed")
      return
    }
    await route.fulfill({ contentType: "text/plain", body: fixture.messages[1]!.ipfsContent! })
  })
  await page.route("https://documents.example/developer.pdf", async (route) => {
    await route.fulfill({ contentType: "text/plain", body: fixture.messages[2]!.ipfsContent! })
  })
  await page.goto("/indexed-bucket/39")

  const warning = page.locator(".chat-warning").filter({ hasText: "Failed to fetch" })
  await expect(warning).toBeVisible()
  await expect(warning).toHaveCSS("color", "rgb(90, 90, 90)")
  await page.getByRole("button", { name: "Reload", exact: true }).click()

  await expect(page.locator(".chat-attachment-file")).toHaveCount(2)
  await expect(page.locator(".chat-warning").filter({ hasText: "Failed to fetch" })).toHaveCount(0)
})

test("shows undecryptable messages as neutral permission notices", async ({ page }) => {
  const fixture = await encryptedDocumentFixture()
  const wrongKeyMessage = await installPlaintextKey(page)
  await mockBackend(page, { messages: [wrongKeyMessage, ...fixture.messages.slice(1)] })
  await page.goto("/indexed-bucket/39")

  const permissionBubble = page.locator(".chat-bubble-undecryptable").first()
  const permissionNotice = page.getByText("You do not have permission to read this message", { exact: true }).first()
  await expect(permissionNotice).toBeVisible()
  await expect(permissionNotice).toHaveCSS("color", "rgb(90, 90, 90)")
  await expect(permissionNotice).toHaveCSS("animation-name", "none")
  await expect(permissionBubble.locator("canvas")).toHaveCount(0)
  await expect(page.getByText("Unable to decrypt message", { exact: true })).toHaveCount(0)
})

test("hydrates legacy S3 terms-document references through ProfileApi", async ({ page }) => {
  const fixture = await encryptedDocumentFixture()
  const legacyReference = "https://objects.example/xcavate-profile/terms-documents/by-candidacy/candidate-1.pdf"
  const profileApiUrl = "https://profile-api.xcavate.io/api/terms-documents/by-candidacy/candidate-1"
  await mockBackend(page, {
    messages: [
      fixture.messages[0]!,
      { ...fixture.messages[1]!, reference: legacyReference, ipfsContent: null },
      fixture.messages[2]!,
    ],
  })
  await page.addInitScript((jwk) => {
    localStorage.setItem("asset-didcomm.x25519-secret-jwk", JSON.stringify(jwk))
  }, fixture.secretJwk)
  const profileApiRequests: string[] = []
  const legacyRequests: string[] = []
  await page.route(profileApiUrl, async (route) => {
    profileApiRequests.push(route.request().url())
    await route.fulfill({ contentType: "text/plain", body: fixture.messages[1]!.ipfsContent! })
  })
  await page.route(legacyReference, async (route) => {
    legacyRequests.push(route.request().url())
    await route.fulfill({ status: 404, body: "Legacy object unavailable" })
  })
  await page.goto("/indexed-bucket/39")

  await expect(page.locator(".chat-attachment-file-name").filter({ hasText: "spv.pdf" })).toBeVisible()
  expect(profileApiRequests).toEqual([profileApiUrl])
  expect(legacyRequests).toHaveLength(0)
})

test("hydrates object-storage review snapshots through ProfileApi without the .pdf suffix", async ({ page }) => {
  const fixture = await encryptedDocumentFixture()
  const hash = "f7adfcd9aa4fc5aa1973fbca008e119ab9452184e9a34a2d9bf622bebc153c36"
  const spvReference = `https://xcavate-profile.fsn1.your-objectstorage.com/terms-documents/by-listing/22/spv-lawyer-${hash}.pdf`
  const developerReference = `https://objects.example/xcavate-profile/terms-documents/by-listing/22/developer-lawyer-${hash}.pdf`
  const spvApiUrl = `https://profile-api.xcavate.io/api/terms-documents/by-listing/22/spv-lawyer-${hash}`
  const developerApiUrl = `https://profile-api.xcavate.io/api/terms-documents/by-listing/22/developer-lawyer-${hash}`
  await mockBackend(page, {
    messages: [
      fixture.messages[0]!,
      { ...fixture.messages[1]!, reference: spvReference, ipfsContent: null },
      { ...fixture.messages[2]!, reference: developerReference, ipfsContent: null },
    ],
  })
  await page.addInitScript((jwk) => {
    localStorage.setItem("asset-didcomm.x25519-secret-jwk", JSON.stringify(jwk))
  }, fixture.secretJwk)
  const profileApiRequests: string[] = []
  const objectStorageRequests: string[] = []
  const record = async (bucket: string[], route: Route, body: string) => {
    bucket.push(route.request().url())
    await route.fulfill({ contentType: "text/plain", body })
  }
  await page.route(spvApiUrl, (route) => record(profileApiRequests, route, fixture.messages[1]!.ipfsContent!))
  await page.route(developerApiUrl, (route) => record(profileApiRequests, route, fixture.messages[2]!.ipfsContent!))
  for (const origin of ["https://xcavate-profile.fsn1.your-objectstorage.com/**", "https://objects.example/**"]) {
    await page.route(origin, (route) => record(objectStorageRequests, route, "Legacy object unavailable"))
  }
  await page.goto("/indexed-bucket/39")

  await expect(page.locator(".document-hash code")).toHaveAttribute("title", expectedDocumentHash())
  expect(profileApiRequests.sort()).toEqual([developerApiUrl, spvApiUrl].sort())
  expect(objectStorageRequests).toHaveLength(0)
})

test("keeps fetching a review document that is not a hashed snapshot from its own origin", async ({ page }) => {
  const fixture = await encryptedDocumentFixture()
  const legacyReference = "https://xcavate-profile.fsn1.your-objectstorage.com/terms-documents/by-listing/22/spv-lawyer.pdf"
  const rewrittenReference = "https://profile-api.xcavate.io/api/terms-documents/by-listing/22/spv-lawyer"
  await mockBackend(page, {
    messages: [
      fixture.messages[0]!,
      { ...fixture.messages[1]!, reference: legacyReference, ipfsContent: null },
      fixture.messages[2]!,
    ],
  })
  await page.addInitScript((jwk) => {
    localStorage.setItem("asset-didcomm.x25519-secret-jwk", JSON.stringify(jwk))
  }, fixture.secretJwk)
  const objectStorageRequests: string[] = []
  const profileApiRequests: string[] = []
  await page.route(legacyReference, async (route) => {
    objectStorageRequests.push(route.request().url())
    await route.fulfill({ contentType: "text/plain", body: fixture.messages[1]!.ipfsContent! })
  })
  await page.route(rewrittenReference, async (route) => {
    profileApiRequests.push(route.request().url())
    await route.fulfill({ contentType: "text/plain", body: fixture.messages[1]!.ipfsContent! })
  })
  await page.route("https://documents.example/developer.pdf", async (route) => {
    await route.fulfill({ contentType: "text/plain", body: fixture.messages[2]!.ipfsContent! })
  })
  await page.goto("/indexed-bucket/39")

  await expect(page.locator(".chat-attachment-file-name").filter({ hasText: "spv.pdf" })).toBeVisible()
  expect(objectStorageRequests).toEqual([legacyReference])
  expect(profileApiRequests).toHaveLength(0)
})

test("renders plaintext voting JSON instead of treating it as an encrypted attachment", async ({ page }) => {
  const keyMessage = await installPlaintextKey(page)
  const vote = message({
    id: "vote-2",
    messageId: "2",
    tag: "voting/terms",
    description: null,
    contentType: "application/json",
    ipfsContent: JSON.stringify({
      kind: "terms",
      listingId: "42",
      round: 1,
      expiresAt: "2030-01-01T00:00:00.000Z",
      status: "open",
    }),
  })
  await mockBackend(page, { messages: [keyMessage, vote] })
  await page.goto("/indexed-bucket/39")

  await expect(page.locator(".chat-vote-card")).toBeVisible()
  await expect(page.getByText("You do not have permission to read this message", { exact: true })).toHaveCount(0)
})

test("keeps ordinary No vote styling red on non-SPV cards", async ({ page }) => {
  const vote = message({
    id: "proposal-result",
    contributor: "system:voting",
    tag: "voting/result",
    description: null,
    contentType: "application/json",
    ipfsContent: JSON.stringify({
      kind: "proposal",
      id: "7",
      listingId: "42",
      status: "passed",
      yes: 25,
      no: 75,
    }),
  })
  await mockBackend(page, { category: "property", properties: null, messages: [vote] })
  await page.goto("/indexed-bucket/39")

  const card = page.locator(".chat-vote-card")
  await expect(card.locator(".chat-vote-split-no")).toHaveText("No 75%")
  const colors = await card.evaluate((element) => {
    const probe = document.createElement("span")
    probe.style.color = "var(--error, #c62828)"
    element.append(probe)
    const expectedNoColor = getComputedStyle(probe).color
    probe.remove()
    return {
      expectedNoColor,
      noColor: getComputedStyle(element.querySelector(".chat-vote-split-no")!).color,
      barColor: getComputedStyle(element.querySelector(".chat-vote-bar")!).backgroundColor,
    }
  })
  expect(colors.noColor).toBe(colors.expectedNoColor)
  expect(colors.barColor).toBe(colors.expectedNoColor)
})

test("shows a compact SPV lawyer election banner and chat card with a live countdown", async ({ page }) => {
  const lawyer = `Lawyer-${"LongNickname".repeat(24)}`
  const vote = message({
    id: "vote-spv",
    messageId: "2",
    contributor: "system:voting",
    tag: "voting/terms",
    description: null,
    contentType: "application/json",
    ipfsContent: JSON.stringify({
      kind: "terms",
      listingId: "42",
      round: 1,
      expiresAt: new Date(Date.now() + 15_000).toISOString(),
      status: "open",
    }),
  })
  await mockBackend(page, {
    category: "spv-lawyer-terms",
    properties: { listing_id: "42", cluster: "devnet", lawyer, candidacy: "CandidacyPDA111" },
    listing: listing({ spvElectionRound: 1, soldShareAmount: 100 }),
    lawyerCandidacies: [{ round: 1, lawyer, costs: 1, votePower: 100 }],
    messages: [vote],
  })
  await page.goto("/indexed-bucket/39")

  const card = page.locator(".chat-vote-card")
  const status = card.locator(".chat-vote-status")
  await expect(status).toHaveText("1m left")
  await expect(card).not.toContainText("Round 1")
  await expect(card).not.toContainText("Solana Devnet")
  await expect(card.locator(".chat-vote-split-yes")).toHaveText("Approve 100%")
  await expect(card.locator(".chat-vote-split-no")).toHaveText("Not voted 0%")

  const lawyerName = card.locator(".chat-vote-lawyer-name")
  await expect(lawyerName).toHaveAttribute("title", lawyer)
  const lawyerStyle = await lawyerName.evaluate((element) => {
    const style = getComputedStyle(element)
    return { overflow: style.textOverflow, whitespace: style.whiteSpace }
  })
  expect(lawyerStyle).toEqual({ overflow: "ellipsis", whitespace: "nowrap" })
  expect(await card.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)

  const banner = page.getByRole("region", { name: "Governance vote" })
  const bannerLawyer = banner.locator(".ib-offer-lawyer")
  await expect(bannerLawyer).toHaveText(`Lawyer: ${lawyer}`)
  await expect(bannerLawyer).toHaveAttribute("title", lawyer)
  await expect(banner).toContainText("1m left")
  await expect(banner).not.toContainText("Solana Devnet")
  await expect(banner).not.toContainText("Not voting counts as rejecting the terms")
  const bannerLawyerLayout = await bannerLawyer.evaluate((element) => {
    const style = getComputedStyle(element)
    const range = document.createRange()
    range.selectNodeContents(element)
    return {
      overflow: style.overflow,
      textOverflow: style.textOverflow,
      whiteSpace: style.whiteSpace,
      lineCount: new Set(Array.from(range.getClientRects(), (rect) => Math.round(rect.top))).size,
      truncated: element.scrollWidth > element.clientWidth,
    }
  })
  expect(bannerLawyerLayout).toEqual({
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    lineCount: 1,
    truncated: true,
  })

  const splitStyle = await card.evaluate((element) => {
    const probe = document.createElement("span")
    probe.style.color = "var(--text-secondary)"
    probe.style.backgroundColor = "var(--border-default)"
    element.append(probe)
    const expectedNoColor = getComputedStyle(probe).color
    const expectedBarColor = getComputedStyle(probe).backgroundColor
    probe.remove()
    const splits = element.querySelector(".chat-vote-splits")!
    const yes = splits.querySelector(".chat-vote-split-yes")!
    const no = splits.querySelector(".chat-vote-split-no")!
    return {
      visualGap: no.getBoundingClientRect().left - yes.getBoundingClientRect().right,
      expectedNoColor,
      expectedBarColor,
      noColor: getComputedStyle(no).color,
      barColor: getComputedStyle(element.querySelector(".chat-vote-bar")!).backgroundColor,
    }
  })
  expect(splitStyle.visualGap).toBeGreaterThanOrEqual(40)
  expect(splitStyle.noColor).toBe(splitStyle.expectedNoColor)
  expect(splitStyle.barColor).toBe(splitStyle.expectedBarColor)
  await expect(page.getByRole("button", { name: "Approve terms", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Finalize SPV election", exact: true })).toHaveCount(0)
  await expect(status).toHaveText("Closed", { timeout: 20_000 })
})

async function mockFinalizableSpvElection(page: Page, winner: string | null, finalizationDue = true): Promise<void> {
  const expiry = Math.floor(Date.now() / 1000) - 1
  const vote = message({
    id: "vote-spv-expired",
    messageId: "2",
    contributor: "system:voting",
    tag: "voting/terms",
    description: null,
    contentType: "application/json",
    ipfsContent: JSON.stringify({
      kind: "terms",
      listingId: "42",
      round: 1,
      expiresAt: new Date(expiry * 1000).toISOString(),
      status: "open",
    }),
  })
  await mockBackend(page, {
    category: "spv-lawyer-terms",
    properties: { listing_id: "42", cluster: "devnet", lawyer: SPV, candidacy: "CandidacyPDA111" },
    listing: listing({ spvElectionRound: 1, spvElectionExpiry: expiry, spvElectionCandidateCount: 2, soldShareAmount: 100 }),
    lawyerCandidacies: [
      { round: 1, lawyer: SPV, costs: 1, votePower: 60 },
      { round: 1, lawyer: DEVELOPER, costs: 1, votePower: 40 },
    ],
    spvFinalization: finalizationDue ? { winner, round: "1", candidates: [SPV, DEVELOPER] } : null,
    messages: [vote],
  })
}

test("hides an expired SPV election banner without finalization evidence", async ({ page }) => {
  await mockFinalizableSpvElection(page, null, false)
  await page.goto("/indexed-bucket/39")

  await expect(page.locator(".chat-vote-status")).toHaveText("Closed")
  await expect(page.getByRole("region", { name: "Governance vote" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Approve terms", exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Finalize SPV election", exact: true })).toHaveCount(0)
})

test("finalizes an ended SPV election once from the banner", async ({ page }) => {
  let releaseBlockhash!: () => void
  const blockhashGate = new Promise<void>((resolve) => { releaseBlockhash = resolve })
  await installWallet(page, OTHER, "solana", "1".repeat(64))
  await mockFinalizableSpvElection(page, SPV)
  await mockSuccessfulRpc(page, () => blockhashGate)
  await page.goto("/indexed-bucket/39")

  const finalize = page.getByRole("button", { name: "Finalize SPV election", exact: true })
  await expect(finalize).toBeVisible()
  await expect(page.getByRole("button", { name: "Approve terms", exact: true })).toHaveCount(0)
  await finalize.evaluate((button: HTMLButtonElement) => {
    button.click()
    button.click()
  })

  const finalizing = page.getByRole("button", { name: "Finalizing…", exact: true })
  await expect(finalizing).toBeVisible()
  await expect(finalizing).toBeDisabled()
  releaseBlockhash()
  await expect(page.locator(".ib-vote-notice")).toContainText("SPV election finalized (11111111…)")
  const instructions = await page.evaluate(() => (
    (window as unknown as { capturedInstructions: CapturedInstruction[] }).capturedInstructions
  ))
  expect(instructions).toHaveLength(1)
  expect(instructions[0]!.data.slice(0, 8)).toEqual([2, 249, 39, 73, 224, 169, 145, 100])
  expect(instructions[0]!.keys[0]).toEqual({ pubkey: OTHER, isSigner: true, isWritable: false })
})

test("finalizes an ended SPV election with no winner on a tie", async ({ page }) => {
  await installWallet(page, OTHER, "solana", "1".repeat(64))
  await mockFinalizableSpvElection(page, null)
  await mockSuccessfulRpc(page)
  await page.goto("/indexed-bucket/39")

  await page.getByRole("button", { name: "Finalize SPV election", exact: true }).click()
  await expect(page.locator(".ib-vote-notice")).toContainText("SPV election finalized")
  const instructions = await page.evaluate(() => (
    (window as unknown as { capturedInstructions: CapturedInstruction[] }).capturedInstructions
  ))
  expect(instructions).toHaveLength(1)
  expect(instructions[0]!.keys[3]).toEqual({
    pubkey: "dj9Q3CpHvDHwexCbkgJ5APDx4JsTxPssNebkvP15g1T",
    isSigner: false,
    isWritable: false,
  })
  expect(instructions[0]!.keys).toHaveLength(6)
})

test("surfaces SPV election finalization errors without a success notice", async ({ page }) => {
  await installWallet(page, OTHER)
  await mockFinalizableSpvElection(page, SPV)
  await mockRpc(page)
  await page.goto("/indexed-bucket/39")

  await page.getByRole("button", { name: "Finalize SPV election", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "Offline getLatestBlockhash failure" })).toBeVisible()
  await expect(page.locator(".ib-vote-notice")).toHaveCount(0)
})

test("rejects large encrypted public documents instead of hashing ciphertext", async ({ page }) => {
  const largePdf = new Uint8Array(4096).fill(65)
  largePdf.set(SPV_PDF)
  const fixture = await encryptedDocumentFixture(largePdf, largePdf)
  const encryptedByUrl = new Map(
    fixture.messages.slice(1).map((entry) => [entry.reference, entry.ipfsContent!]),
  )
  await mockBackend(page, {
    messages: fixture.messages.slice(1).map((entry) => ({ ...entry, ipfsContent: null })),
  })
  await page.route("https://gateway.pinata.cloud/ipfs/spv-cid", async (route) => {
    await route.fulfill({ contentType: "text/plain", body: encryptedByUrl.get("spv-cid")! })
  })
  await page.route("https://documents.example/developer.pdf", async (route) => {
    await route.fulfill({ contentType: "text/plain", body: encryptedByUrl.get("https://documents.example/developer.pdf")! })
  })
  await page.goto("/indexed-bucket/39")

  await expect(page.getByRole("alert").filter({ hasText: "Lawyer document attachment could not be decrypted" })).toBeVisible()
  await expect(page.locator(".document-hash code")).toHaveCount(0)
})

test("keeps investor voting visible on non-review buckets without the lawyer panel", async ({ page }) => {
  const vote = message({
    id: "vote",
    messageId: "1",
    contributor: "system:voting",
    tag: "voting/proposal",
    description: null,
    contentType: "application/json",
    ipfsContent: JSON.stringify({
      kind: "proposal",
      id: "7",
      listingId: "42",
      expiresAt: "2030-01-01T00:00:00.000Z",
      status: "open",
    }),
  })
  await mockBackend(page, { category: "property", properties: null, messages: [vote] })
  await page.goto("/indexed-bucket/39")

  await expect(page.getByRole("region", { name: "Governance vote" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Lawyer document review" })).toHaveCount(0)
})

test("never falls back to devnet when mainnet Indexer configuration is absent", async ({ page }) => {
  const { indexerRequests } = await mockBackend(page, { properties: reviewProperties("mainnet") })
  await page.goto("/indexed-bucket/39")

  await expect(page.locator(".review-property")).toHaveText("Property 42 · mainnet")
  await expect(page.getByRole("alert").filter({ hasText: "Mainnet Indexer GraphQL URL is not configured" })).toBeVisible()
  expect(indexerRequests).toHaveLength(0)
})

test("wires verdict submission to the composable with busy and error states and no chat vote", async ({ page }) => {
  await installWallet(page, SPV)
  await mockBackend(page, {
    messages: [
      message({ id: "spv", messageId: "1", ipfsContent: base64(SPV_PDF) }),
      message({ id: "developer", messageId: "2", ipfsContent: base64(DEVELOPER_PDF), createdAt: "2026-10-01T12:00:02.000Z" }),
    ],
  })
  let releaseRpc!: () => void
  const rpcGate = new Promise<void>((resolve) => { releaseRpc = resolve })
  await mockRpc(page, () => rpcGate)
  await page.goto("/indexed-bucket/39")

  const reject = page.getByRole("button", { name: "Reject documents", exact: true })
  await expect(reject).toBeEnabled()
  await reject.click()
  const dialog = page.getByRole("dialog", { name: "Reject documents", exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
  await expect(reject).toBeFocused()

  await reject.click()
  await dialog.getByRole("button", { name: "Submit review", exact: true }).click()
  await expect(dialog.getByRole("button", { name: "Submitting…", exact: true })).toBeDisabled()
  releaseRpc()
  await expect(dialog.getByRole("alert").filter({ hasText: "Offline getLatestBlockhash failure" })).toBeVisible()
  await expect(dialog.getByRole("button", { name: "Submit review", exact: true })).toBeEnabled()
  await expect(page.locator(".ib-vote-notice")).toHaveCount(0)
})

test("disables lawyer actions and shows feedback when the legal deadline passes without a refresh", async ({ page }) => {
  const legalDeadline = 1_900_000_000
  await page.clock.install({ time: new Date((legalDeadline - 2) * 1000) })
  await installWallet(page, SPV)
  await mockBackend(page, {
    listing: listing({ legalDeadline }),
    messages: [
      message({ id: "spv", messageId: "1", ipfsContent: base64(SPV_PDF) }),
      message({ id: "developer", messageId: "2", ipfsContent: base64(DEVELOPER_PDF), createdAt: "2026-10-01T12:00:02.000Z" }),
    ],
  })
  await mockRpc(page)
  await page.goto("/indexed-bucket/39")

  const approve = page.getByRole("button", { name: "Approve documents", exact: true })
  await expect(approve).toBeEnabled()
  await approve.click()
  const dialog = page.getByRole("dialog", { name: "Approve documents", exact: true })
  await expect(dialog).toBeVisible()

  await page.clock.runFor(3_000)
  await expect(approve).toBeDisabled()
  await expect(dialog.getByRole("button", { name: "Submit review", exact: true })).toBeDisabled()
  await expect(dialog.getByRole("alert").filter({ hasText: "The legal review deadline has passed" })).toBeVisible()
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await approve.evaluate((button: HTMLButtonElement) => button.click())
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(page.getByRole("alert").filter({ hasText: "The legal review deadline has passed" })).toBeVisible()
  await expect(page.getByRole("alert").filter({ hasText: "Offline" })).toHaveCount(0)
})

test("keeps an already-decided lawyer disabled without a false submitted state", async ({ page }) => {
  await installWallet(page, SPV)
  await mockBackend(page, {
    listing: listing({
      spvLawyerDocStatus: "APPROVED",
      spvLawyerDocumentsHash: expectedDocumentHash(),
    }),
    messages: [
      message({ id: "spv", messageId: "1", ipfsContent: base64(SPV_PDF) }),
      message({ id: "developer", messageId: "2", ipfsContent: base64(DEVELOPER_PDF), createdAt: "2026-10-01T12:00:02.000Z" }),
    ],
  })
  await page.goto("/indexed-bucket/39")

  await expect(page.getByRole("button", { name: "Approve documents", exact: true })).toBeDisabled()
  await expect(page.getByRole("button", { name: "Reject documents", exact: true })).toBeDisabled()
  await expect(page.getByRole("button", { name: "Submitted review" })).toHaveCount(0)
})

test("lets the other pending lawyer submit after a wallet switch without reloading", async ({ page }) => {
  const currentListing = listing()
  await installWallet(page, SPV, "solana", "1".repeat(64))
  await mockBackend(page, {
    listing: currentListing,
    messages: [
      message({ id: "spv", messageId: "1", ipfsContent: base64(SPV_PDF) }),
      message({ id: "developer", messageId: "2", ipfsContent: base64(DEVELOPER_PDF), createdAt: "2026-10-01T12:00:02.000Z" }),
    ],
  })
  await mockSuccessfulRpc(page)
  await page.goto("/indexed-bucket/39")

  const approve = page.getByRole("button", { name: "Approve documents", exact: true })
  await approve.click()
  let dialog = page.getByRole("dialog", { name: "Approve documents", exact: true })
  await dialog.getByRole("button", { name: "Submit review", exact: true }).click()
  await expect(approve).toBeDisabled()
  await expect(dialog).toHaveCount(0)
  Object.assign(currentListing, {
    spvLawyerDocStatus: "APPROVED",
    spvLawyerDocumentsHash: expectedDocumentHash(),
  })
  await page.evaluate((nextAddress) => {
    const provider = (window as unknown as {
      phantom: { solana: { publicKey: { toBase58: () => string } } }
    }).phantom.solana
    provider.publicKey.toBase58 = () => nextAddress
  }, DEVELOPER)
  await page.getByRole("button", { name: "Switch", exact: true }).click()

  await expect(approve).toBeEnabled()
  await approve.click()
  dialog = page.getByRole("dialog", { name: "Approve documents", exact: true })
  await dialog.getByRole("button", { name: "Submit review", exact: true }).click()
  await expect(approve).toBeDisabled()
})

test("opens the existing attachment composer for an eligible lawyer replacement upload", async ({ page }) => {
  await installWallet(page, SPV)
  const keyMessage = await installPlaintextKey(page)
  await mockBackend(page, { messages: [keyMessage] })
  await page.goto("/indexed-bucket/39")

  const chooser = page.waitForEvent("filechooser")
  await page.getByRole("button", { name: "Upload replacement document" }).click()
  await expect(await chooser).toBeDefined()
})

test("wires execute deal to the composable and surfaces preparation errors without a chat vote", async ({ page }) => {
  await installWallet(page, OTHER)
  await mockBackend(page, {
    listing: listing({
      spvLawyerDocStatus: "APPROVED",
      spvLawyerDocumentsHash: "0xabc",
      developerLawyerDocStatus: "APPROVED",
      developerLawyerDocumentsHash: "0xabc",
      status: "LEGAL",
    }),
    settlement: {
      regionId: 7,
      developer: OTHER,
      developerLawyer: DEVELOPER,
      spvLawyer: SPV,
      xcavMint: BLOCKHASH,
      treasury: BLOCKHASH,
      acceptedPaymentMints: [],
      collectedMints: [],
    },
  })
  await mockRpc(page)
  await page.goto("/indexed-bucket/39")

  await page.getByRole("button", { name: "Finalize deal", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Finalize deal", exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByRole("button", { name: "Execute deal", exact: true }).click()
  await expect(dialog.getByRole("alert").filter({ hasText: "Offline getMultipleAccounts failure" })).toBeVisible()
  await expect(page.locator(".ib-vote-notice")).toHaveCount(0)
})

test("renders canonical Terms open and result announcements with review tallies and no investor actions", async ({ page }) => {
  const status = message({
    id: "review-status",
    contributor: "system:voting",
    tag: "voting/terms",
    description: null,
    reference: "review-status-cid",
    contentType: "application/json",
    ipfsContent: null,
  })
  const result = message({
    id: "review-result",
    messageId: "3",
    contributor: "system:voting",
    tag: "voting/result",
    description: null,
    contentType: "application/json",
    ipfsContent: JSON.stringify({ kind: "terms", listingId: "42", status: "ratified", yes: 2, no: 0 }),
    createdAt: "2026-10-01T12:00:03.000Z",
  })
  const { indexerRequests } = await mockBackend(page, {
    listing: listing({
      spvLawyerDocStatus: "APPROVED",
      spvLawyerDocumentsHash: "0xabc",
    }),
    messages: [status, result],
  })
  await page.route("https://gateway.pinata.cloud/ipfs/review-status-cid", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        kind: "terms",
        listingId: "42",
        status: "open",
        expiresAt: new Date(Date.now() + 15_000).toISOString(),
      }),
    })
  })
  await page.goto("/indexed-bucket/39")

  const cards = page.locator(".chat-vote-card")
  await expect(cards).toHaveCount(2)
  await expect(cards.first()).toContainText("Lawyer document review")
  await expect(cards.first().locator(".chat-vote-status")).toHaveText("1m left")
  await expect(cards.last().locator(".chat-vote-status")).toHaveText("Ratified")
  await expect(cards.first().locator(".chat-vote-split-yes")).toHaveText("Approve 50%")
  await expect(cards.first().locator(".chat-vote-split-no")).toHaveText("Reject 0%")
  await expect(cards.first().locator(".chat-vote-split-pending")).toHaveText("Pending 50%")
  await expect(cards.last().locator(".chat-vote-split-yes")).toHaveText("Approve 50%")
  await expect(cards.first()).not.toContainText("listingId")
  await expect(page.getByRole("region", { name: "Governance vote" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Approve terms", exact: true })).toHaveCount(0)
  expect(indexerRequests).toHaveLength(1)
})

function reviewAnnouncement(overrides: {
  id: string
  messageId: string
  tag: string
  payload: Record<string, unknown>
  createdAt?: string
}): ApiMessage {
  return message({
    id: overrides.id,
    messageId: overrides.messageId,
    contributor: "system:voting",
    tag: overrides.tag,
    description: null,
    contentType: "application/json",
    ipfsContent: JSON.stringify(overrides.payload),
    ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
  })
}

test("renders a review round opened without a deadline as a card instead of raw JSON", async ({ page }) => {
  // The API's listing mirror lags behind a verdict, so the announcement opening
  // the next round is posted without expiresAt.
  const open = reviewAnnouncement({
    id: "open-without-deadline",
    messageId: "2",
    tag: "voting/terms",
    payload: { kind: "terms", listingId: "42", round: 2, listingStatus: "LEGAL", status: "open" },
    createdAt: "2026-10-01T12:00:02.000Z",
  })
  await mockBackend(page, { messages: [open] })
  await page.goto("/indexed-bucket/39")

  const card = page.locator(".chat-vote-card")
  await expect(card).toHaveCount(1)
  await expect(card.locator(".chat-vote-status")).toHaveText("Open")
  await expect(card).not.toContainText("left")
  await expect(card).not.toContainText("expiresAt")
  await expect(page.locator(".chat-text")).toHaveCount(0)
})

test("greys a three-label review card exactly like the terms card without overflowing it", async ({ page }) => {
  const open = reviewAnnouncement({
    id: "review-open-tallies",
    messageId: "2",
    tag: "voting/terms",
    payload: { kind: "terms", listingId: "42", status: "open" },
    createdAt: "2026-10-01T12:00:02.000Z",
  })
  await mockBackend(page, { messages: [open] })
  await page.goto("/indexed-bucket/39")

  const card = page.locator(".chat-vote-card")
  await expect(card).toHaveCount(1)
  await expect(card).toHaveClass(/chat-vote-card-review/)
  await expect(card).not.toHaveClass(/chat-vote-card-terms/)
  await expect(card.locator(".chat-vote-split-yes")).toHaveText("Approve 0%")
  await expect(card.locator(".chat-vote-split-no")).toHaveText("Reject 0%")
  await expect(card.locator(".chat-vote-split-pending")).toHaveText("Pending 100%")

  const colors = await card.evaluate((element) => {
    const probe = document.createElement("span")
    probe.style.color = "var(--text-secondary)"
    probe.style.backgroundColor = "var(--border-default)"
    element.append(probe)
    const expectedGrey = getComputedStyle(probe).color
    const expectedTrack = getComputedStyle(probe).backgroundColor
    probe.remove()
    const redProbe = document.createElement("span")
    redProbe.style.color = "var(--error, #c62828)"
    element.append(redProbe)
    const expectedRed = getComputedStyle(redProbe).color
    redProbe.remove()
    const splits = element.querySelector(".chat-vote-splits")!
    return {
      expectedGrey,
      expectedTrack,
      expectedRed,
      splitsClass: splits.className,
      wrap: getComputedStyle(splits).flexWrap,
      yesColor: getComputedStyle(splits.querySelector(".chat-vote-split-yes")!).color,
      noColor: getComputedStyle(splits.querySelector(".chat-vote-split-no")!).color,
      pendingColor: getComputedStyle(splits.querySelector(".chat-vote-split-pending")!).color,
      trackColor: getComputedStyle(element.querySelector(".chat-vote-bar")!).backgroundColor,
    }
  })
  expect(colors.splitsClass).toContain("chat-vote-splits-pending")
  expect(colors.wrap).toBe("wrap")
  expect(colors.noColor).toBe(colors.expectedGrey)
  expect(colors.pendingColor).toBe(colors.expectedGrey)
  expect(colors.trackColor).toBe(colors.expectedTrack)
  // The yes column keeps its accent, and neither shared element falls back to red.
  expect(colors.yesColor).not.toBe(colors.expectedGrey)
  expect(colors.noColor).not.toBe(colors.expectedRed)
  expect(colors.trackColor).not.toBe(colors.expectedRed)

  for (const width of [1280, 760, 390]) {
    await page.setViewportSize({ width, height: 900 })
    const layout = await card.evaluate((element) => {
      const splits = element.querySelector(".chat-vote-splits")!
      const pending = splits.querySelector(".chat-vote-split-pending")!
      return {
        cardOverflow: element.scrollWidth - element.clientWidth,
        splitsOverflow: splits.scrollWidth - splits.clientWidth,
        pendingEscapes: pending.getBoundingClientRect().right - element.getBoundingClientRect().right,
      }
    })
    expect(layout.cardOverflow).toBeLessThanOrEqual(1)
    expect(layout.splitsOverflow).toBeLessThanOrEqual(1)
    expect(layout.pendingEscapes).toBeLessThanOrEqual(1)
  }
})

test("labels and colours the document-review outcomes the backend reports", async ({ page }) => {
  const announcements = [
    { id: "review-finalized", status: "finalized", createdAt: "2026-10-01T12:00:02.000Z" },
    { id: "review-cancelled", status: "cancelled", createdAt: "2026-10-01T12:00:03.000Z" },
    { id: "review-expired", status: "expired", createdAt: "2026-10-01T12:00:04.000Z" },
    { id: "review-refunded", status: "refunded", createdAt: "2026-10-01T12:00:05.000Z" },
  ].map((entry, index) => reviewAnnouncement({
    id: entry.id,
    messageId: String(index + 2),
    tag: "voting/result",
    payload: { kind: "terms", listingId: "42", round: 1, status: entry.status, listingStatus: "FINALIZED" },
    createdAt: entry.createdAt,
  }))
  await mockBackend(page, { messages: announcements })
  await page.goto("/indexed-bucket/39")

  const cards = page.locator(".chat-vote-card")
  await expect(cards).toHaveCount(4)
  await expect(cards.nth(0).locator(".chat-vote-status")).toHaveText("Finalized")
  await expect(cards.nth(1).locator(".chat-vote-status")).toHaveText("Cancelled")
  await expect(cards.nth(2).locator(".chat-vote-status")).toHaveText("Expired")
  await expect(cards.nth(3).locator(".chat-vote-status")).toHaveText("Refunded")
  await expect(page.locator(".chat-text")).toHaveCount(0)

  const chips = await cards.first().evaluate((element) => {
    const probe = document.createElement("span")
    probe.style.color = "var(--success, #2e7d32)"
    element.append(probe)
    const expectedSuccess = getComputedStyle(probe).color
    probe.remove()
    const grey = document.createElement("span")
    grey.style.color = "var(--text-secondary)"
    element.append(grey)
    const expectedGrey = getComputedStyle(grey).color
    grey.remove()
    return {
      expectedSuccess,
      expectedGrey,
      colors: Array.from(document.querySelectorAll(".chat-vote-card .chat-vote-status"), (chip) => getComputedStyle(chip).color),
    }
  })
  expect(chips.colors).toEqual([
    chips.expectedSuccess,
    chips.expectedGrey,
    chips.expectedGrey,
    chips.expectedGrey,
  ])
})

test("hydrates, decrypts, and reuses green approval bubbles for tag-only lawyer document approvals", async ({ page }) => {
  const fixture = await encryptedDocumentFixture()
  const publicJwk = { ...fixture.secretJwk }
  delete publicJwk.d
  const publicKey = await importJWK(publicJwk, "ECDH-ES+A256KW")
  const encryptedApproval = await new CompactEncrypt(new TextEncoder().encode("Approved documents"))
    .setProtectedHeader({ alg: "ECDH-ES+A256KW", enc: "A256GCM", typ: "didcomm/encrypted-message-v1" })
    .encrypt(publicKey)
  const approval = message({
    id: "review-approval",
    contributor: SPV,
    tag: "lawyer/terms-approved",
    description: null,
    reference: "approval-cid",
    contentType: "text/plain;charset=utf-8",
    ipfsContent: null,
  })
  const taggedMessages: ApiMessage[] = []
  await mockBackend(page, { messages: [fixture.messages[0]!], taggedMessages })
  await page.addInitScript((jwk) => {
    localStorage.setItem("asset-didcomm.x25519-secret-jwk", JSON.stringify(jwk))
  }, fixture.secretJwk)
  await page.route("https://gateway.pinata.cloud/ipfs/approval-cid", async (route) => {
    await route.fulfill({ contentType: "text/plain", body: encryptedApproval })
  })
  await page.goto("/indexed-bucket/39")

  const bubble = page.locator(".chat-bubble-terms-approved")
  await expect(bubble).toHaveCount(0)
  taggedMessages.push(approval)
  await page.getByRole("button", { name: "Reload", exact: true }).click()
  await expect(bubble).toContainText("Approved documents")
  await expect(bubble).not.toContainText("Unable to decrypt message")
  await expect(bubble).not.toContainText(encryptedApproval)
  const colors = await bubble.evaluate((element) => {
    const probe = document.createElement("span")
    probe.style.color = "var(--success, #2e7d32)"
    element.append(probe)
    const expected = getComputedStyle(probe).color
    probe.remove()
    return { expected, actual: getComputedStyle(element).borderLeftColor }
  })
  expect(colors.actual).toBe(colors.expected)
})

test("uses the exact latest 64-bit key-sharing era when encrypting an outgoing message", async ({ page }) => {
  const makeKey = async (kid: string) => {
    const pair = await generateKeyPair("ECDH-ES+A256KW", { crv: "X25519", extractable: true })
    const secretJwk = await exportJWK(pair.privateKey)
    secretJwk.use = "enc"
    secretJwk.kid = kid
    return secretJwk
  }
  const olderKey = await makeKey("older-64-bit-key")
  const newerKey = await makeKey("newer-64-bit-key")
  const createdAt = "2026-10-01T12:00:00.000Z"
  const keyMessage = (id: string, messageId: string, secretJwk: JWK) => message({
    id,
    messageId,
    tag: "didcomm/key-sharing-v1",
    description: null,
    contentType: "application/json",
    ipfsContent: JSON.stringify({ id: `${id}-document`, from: "Admin", to: [SPV, DEVELOPER], keys: [secretJwk] }),
    createdAt,
  })
  const outgoingMessages: string[] = []
  await installWallet(page, SPV)
  await page.addInitScript((jwk) => {
    localStorage.setItem("asset-didcomm.x25519-secret-jwk", JSON.stringify(jwk))
  }, newerKey)
  await mockBackend(page, {
    messages: [
      keyMessage("newer-key", "9007199254740993", newerKey),
      keyMessage("older-key", "9007199254740992", olderKey),
    ],
    outgoingMessages,
  })
  await page.route("https://uploads.pinata.cloud/v3/files", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: { cid: "outgoing-cid" } }) })
  })
  await page.goto("/indexed-bucket/39")

  await page.locator(".ib-composer-input").fill("exact key era")
  await page.locator(".ib-composer-send").click()
  await expect.poll(() => outgoingMessages.length).toBe(1)
  const newerSecret = await importJWK(newerKey, "ECDH-ES+A256KW")
  const { plaintext } = await compactDecrypt(outgoingMessages[0]!, newerSecret)
  expect(new TextDecoder().decode(plaintext)).toBe("exact key era")
})

test("reloads tagged Terms announcements after a successful verdict without a page reload or losing its signature", async ({ page }) => {
  const signature = "1".repeat(64)
  const currentListing = listing()
  const taggedMessages: ApiMessage[] = []
  const approval = message({
    id: "verdict-approval",
    messageId: "4",
    contributor: SPV,
    tag: "lawyer/terms-approved",
    description: null,
    contentType: "text/plain;charset=utf-8",
    ipfsContent: "Approved documents",
    createdAt: "2026-10-01T12:00:04.000Z",
  })
  const resultMessage = message({
    id: "verdict-result",
    messageId: "5",
    contributor: "system:voting",
    tag: "voting/result",
    description: null,
    contentType: "application/json",
    ipfsContent: JSON.stringify({ kind: "terms", listingId: "42", status: "ratified" }),
    createdAt: "2026-10-01T12:00:05.000Z",
  })
  await installWallet(page, SPV, "solana", signature)
  const { bucketDetailRequests, tagRequests } = await mockBackend(page, {
    listing: currentListing,
    taggedMessages,
    messages: [
      message({ id: "spv", messageId: "1", ipfsContent: base64(SPV_PDF) }),
      message({ id: "developer", messageId: "2", ipfsContent: base64(DEVELOPER_PDF), createdAt: "2026-10-01T12:00:02.000Z" }),
    ],
  })
  await mockSuccessfulRpc(page, async () => {
    Object.assign(currentListing, {
      spvLawyerDocStatus: "APPROVED",
      spvLawyerDocumentsHash: expectedDocumentHash(),
    })
    if (!taggedMessages.some((entry) => entry.id === approval.id)) taggedMessages.push(approval, resultMessage)
  })
  await page.goto("/indexed-bucket/39")
  const initialTagRequests = tagRequests.length

  await page.getByRole("button", { name: "Approve documents", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Approve documents", exact: true })
  await dialog.getByRole("button", { name: "Submit review", exact: true }).click()

  await expect(page.locator(".chat-bubble-terms-approved")).toContainText("Approved documents")
  await expect(page.locator(".chat-vote-card").last()).toContainText("Ratified")
  await expect(page.getByRole("link", { name: `View transaction ${signature}`, exact: true })).toBeVisible()
  expect(tagRequests.length).toBeGreaterThan(initialTagRequests)
  expect(bucketDetailRequests).toHaveLength(1)
})

test("reloads tagged Terms announcements after deal execution without a page reload or losing its signature", async ({ page }) => {
  const signature = "1".repeat(64)
  const currentListing = listing({
    spvLawyerDocStatus: "APPROVED",
    spvLawyerDocumentsHash: "0xabc",
    developerLawyerDocStatus: "APPROVED",
    developerLawyerDocumentsHash: "0xabc",
    status: "LEGAL",
  })
  const taggedMessages: ApiMessage[] = []
  const resultMessage = message({
    id: "deal-result",
    messageId: "8",
    contributor: "system:voting",
    tag: "voting/result",
    description: null,
    contentType: "application/json",
    ipfsContent: JSON.stringify({ kind: "terms", listingId: "42", status: "ratified" }),
    createdAt: "2026-10-01T12:00:08.000Z",
  })
  await installWallet(page, OTHER, "solana", signature)
  const { bucketDetailRequests, tagRequests } = await mockBackend(page, {
    listing: currentListing,
    taggedMessages,
    settlement: {
      regionId: 7,
      developer: OTHER,
      developerLawyer: DEVELOPER,
      spvLawyer: SPV,
      xcavMint: BLOCKHASH,
      treasury: BLOCKHASH,
      acceptedPaymentMints: [],
      collectedMints: [],
    },
  })

  const config = getLegalClusterConfig("devnet")
  const tokenProgram = new PublicKey(config.tokenProgramId)
  const rpcAccount = (data: Buffer, owner: PublicKey) => ({
    data: [data.toString("base64"), "base64"],
    executable: false,
    lamports: 1,
    owner: owner.toBase58(),
    rentEpoch: 0,
  })
  const configData = Buffer.alloc(105)
  new PublicKey(OTHER).toBuffer().copy(configData, 8)
  configData[40] = 0
  new PublicKey(BLOCKHASH).toBuffer().copy(configData, 41)
  new PublicKey(BLOCKHASH).toBuffer().copy(configData, 73)
  const listingData = Buffer.alloc(369)
  listingData.writeBigUInt64LE(42n, 8)
  new PublicKey(OTHER).toBuffer().copy(listingData, 16)
  listingData.writeBigInt64LE(1_900_000_000n, 131)
  new PublicKey(DEVELOPER).toBuffer().copy(listingData, 147)
  listingData[187] = 1
  new PublicKey(SPV).toBuffer().copy(listingData, 220)
  listingData[260] = 1
  listingData.writeUInt32LE(0, 343)
  listingData[367] = 3
  const name = Buffer.from("123 Main Street")
  const metadata = Buffer.from("ipfs://property-metadata")
  const location = Buffer.from("AB12CD")
  const propertyData = Buffer.alloc(73 + name.length + metadata.length + location.length)
  propertyData.writeBigUInt64LE(42n, 8)
  let propertyOffset = 16
  for (const value of [name, metadata]) {
    propertyData.writeUInt32LE(value.length, propertyOffset)
    value.copy(propertyData, propertyOffset + 4)
    propertyOffset += 4 + value.length
  }
  propertyOffset += 32
  propertyData.writeUInt16LE(7, propertyOffset)
  propertyData.writeUInt32LE(location.length, propertyOffset + 2)
  location.copy(propertyData, propertyOffset + 6)
  const regionData = Buffer.alloc(42)
  regionData.writeUInt16LE(7, 8)
  new PublicKey(OTHER).toBuffer().copy(regionData, 10)
  const mintData = Buffer.alloc(82)
  const developerTokenData = Buffer.alloc(165)
  new PublicKey(BLOCKHASH).toBuffer().copy(developerTokenData, 0)
  new PublicKey(OTHER).toBuffer().copy(developerTokenData, 32)
  const marketplaceProgram = new PublicKey(config.marketplaceProgramId)
  const regionsProgram = new PublicKey(config.regionsProgramId)
  await mockSuccessfulRpc(page, async () => {
    currentListing.status = "FINALIZED"
    if (!taggedMessages.some((entry) => entry.id === resultMessage.id)) taggedMessages.push(resultMessage)
  }, [
    [
      rpcAccount(configData, marketplaceProgram),
      rpcAccount(listingData, marketplaceProgram),
      rpcAccount(propertyData, marketplaceProgram),
    ],
    [rpcAccount(regionData, regionsProgram), rpcAccount(mintData, tokenProgram)],
    [rpcAccount(developerTokenData, tokenProgram)],
  ])
  await page.goto("/indexed-bucket/39")
  const initialTagRequests = tagRequests.length

  await page.getByRole("button", { name: "Finalize deal", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Finalize deal", exact: true })
  await dialog.getByRole("button", { name: "Execute deal", exact: true }).click()

  await expect(page.locator(".chat-vote-card").last()).toContainText("Ratified")
  await expect(page.getByRole("link", { name: `View transaction ${signature}`, exact: true })).toBeVisible()
  expect(tagRequests.length).toBeGreaterThan(initialTagRequests)
  expect(bucketDetailRequests).toHaveLength(1)
})

test("refreshes lawyer state when Terms approval and rejection messages arrive over the socket", async ({ page }) => {
  let publish = (_body: string) => {}
  let subscribed = false
  await page.routeWebSocket("wss://profile-api.xcavate.io/socket.io/**", (socket) => {
    publish = (body) => socket.send(body)
    socket.send("0{\"sid\":\"review-engine\",\"upgrades\":[],\"pingInterval\":25000,\"pingTimeout\":20000}")
    socket.onMessage((body) => {
      const packet = body.toString()
      if (packet === "40") {
        socket.send("40{\"sid\":\"review-socket\"}")
        return
      }
      const subscribe = /^42(\d*)\[\"subscribe\"/.exec(packet)
      if (subscribe) {
        socket.send(`43${subscribe[1]}[{\"ok\":true}]`)
        subscribed = true
      }
    })
  })
  const currentListing = listing()
  const { indexerRequests } = await mockBackend(page, { listing: currentListing })
  await page.goto("/indexed-bucket/39")
  await expect.poll(() => subscribed).toBe(true)
  await expect(page.locator(".review-status-line")).toContainText("0 of 2 approved")

  Object.assign(currentListing, {
    spvLawyerDocStatus: "APPROVED",
    spvLawyerDocumentsHash: "0xabc",
  })
  publish(`42[\"message\",${JSON.stringify(message({
    id: "socket-approval",
    messageId: "6",
    contributor: SPV,
    tag: "lawyer/terms-approved",
    description: null,
    contentType: "text/plain;charset=utf-8",
    ipfsContent: "Approved documents",
  }))}]`)
  await expect(page.locator(".chat-bubble-terms-approved")).toContainText("Approved documents")
  await expect(page.locator(".review-status-line")).toContainText("1 of 2 approved")

  Object.assign(currentListing, {
    spvLawyerDocStatus: "REJECTED",
    spvLawyerDocumentsHash: "0xabc",
  })
  publish(`42[\"message\",${JSON.stringify(message({
    id: "socket-rejection",
    messageId: "7",
    contributor: SPV,
    tag: "lawyer/terms-rejected",
    description: null,
    contentType: "text/plain;charset=utf-8",
    ipfsContent: "Rejected documents",
    createdAt: "2026-10-01T12:00:07.000Z",
  }))}]`)
  await expect(page.locator(".chat-bubble-terms-rejected")).toContainText("Rejected documents")
  await expect(page.locator(".review-status-line")).toContainText("1 rejected")
  expect(indexerRequests).toHaveLength(3)
})

test("hides execute deal for a connected Polkadot session", async ({ page }) => {
  await installWallet(page, OTHER, "polkadot")
  await mockBackend(page, {
    listing: listing({
      spvLawyerDocStatus: "APPROVED",
      spvLawyerDocumentsHash: "0xabc",
      developerLawyerDocStatus: "APPROVED",
      developerLawyerDocumentsHash: "0xabc",
      status: "LEGAL",
    }),
    settlement: {
      regionId: 7,
      developer: OTHER,
      developerLawyer: DEVELOPER,
      spvLawyer: SPV,
      xcavMint: BLOCKHASH,
      treasury: BLOCKHASH,
      acceptedPaymentMints: [],
      collectedMints: [],
    },
  })
  await page.goto("/indexed-bucket/39")

  await expect(page.locator(".review-property")).toHaveText("Property 42 · devnet")
  await expect(page.getByRole("button", { name: "Finalize deal", exact: true })).toHaveCount(0)
  await expect(page.getByText("Connect a wallet to execute the ready deal.")).toBeVisible()
})

# Profile API Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every Substrate extrinsic and SubQuery indexer query with the XcavateProfile GraphQL API at `https://profile-api.xcavate.io/graphql`, then delete the chain/indexer code.

**Architecture:** New `app/services/buckets/` layer — a `BucketsGraphqlClient` transport (plain queries, Sr25519-signed mutations reusing the golden-vectored `profileSigning.ts` helpers) and a `BucketsRepository` with an options-object constructor. Pages consume it via `useBucketsRepository()`. Old `papi`/`indexer`/`blockTime` code is deleted at the end.

**Tech Stack:** Nuxt 4 (SSR off), TypeScript strict, Vitest, `@polkadot/extension-dapp` (signRaw), `@polkadot/util-crypto` (blake2), Pinata (kept).

**Spec:** `docs/superpowers/specs/2026-07-26-profile-api-migration-design.md` (approved). GraphQL schema reference: `pyrahermesagent/XcavateProfile` repo, `docs/graphql/schema.graphql` (a local copy of the relevant parts is embedded in tasks below).

## Global Constraints

- API base URL comes from `runtimeConfig.public.profileApiUrl`, default `https://profile-api.xcavate.io`, env `NUXT_PUBLIC_PROFILE_API_URL`.
- **Filter arguments use the `Long` scalar → send JS numbers** (`where: { bucketId: { eq: 5 } }`). **Mutation arguments use the `BigInt` scalar → send strings** (`variables: { bucketId: "5" }`). Mixing these up is the most likely silent failure in this migration.
- Signed mutation payload: `POST:/graphql:{0x+UPPERCASE blake2b-128 of raw body}:{7-fractional-digit ISO timestamp}` — always via the existing helpers `toCSharpHashHex`, `formatSignatureTimestamp`, `buildSignaturePayload` from `app/services/profile/profileSigning.ts`. The exact string passed to the signer MUST be the exact string sent as the HTTP body.
- Timestamps from the API are ISO `DateTime` strings (`createdAt`, `updatedAt`, `addedAt`) — never block numbers.
- Operation status vocabulary is `"pending" | "success" | "error"` (type `OperationUpdate`). The old `submitted/broadcast/inBlock/finalized` stages must not appear in new code.
- Message content is still uploaded to Pinata first (CID = `reference`) and mirrored verbatim into the mutation's `ipfsContent` field.
- Reserved content types (unchanged values): text = `text/plain;charset=utf-8`, key-sharing = `application/didcomm-encrypted+json`, key-sharing tag = `didcomm/key-sharing-v1`.
- Run commands with npm: `npm run typecheck`, `npx vitest run tests/unit/<file> -v`, `npm run test:unit`.
- Commit after every task; end commit messages with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: GraphQL transport — `BucketsGraphqlClient`

**Files:**
- Create: `app/services/buckets/bucketsApiClient.ts`
- Test: `tests/unit/bucketsApiClient.spec.ts`

**Interfaces:**
- Consumes: nothing project-internal (pure `fetch`).
- Produces (later tasks rely on these exact signatures):
  - `class BucketsApiError extends Error { status?: number }`
  - `type GraphqlSignFn = (rawBody: string) => Promise<HeadersInit>`
  - `class BucketsGraphqlClient { constructor(apiUrl: string, fetcher?: typeof fetch); query<T>(document: string, variables?: Record<string, unknown>): Promise<T>; mutate<T>(document: string, variables: Record<string, unknown> | undefined, sign: GraphqlSignFn): Promise<T> }`

- [ ] **Step 1: Write the failing tests**

Follow the style of `tests/unit/profileClient.spec.ts` (fake fetcher captures requests, returns canned `Response`s).

```ts
// tests/unit/bucketsApiClient.spec.ts
import { describe, expect, it } from "vitest"
import { BucketsApiError, BucketsGraphqlClient } from "../../app/services/buckets/bucketsApiClient"

const API = "https://profile-api.example"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  })
}

describe("BucketsGraphqlClient.query", () => {
  it("POSTs the document to {apiUrl}/graphql and returns data", async () => {
    let captured: { url: string; init: RequestInit } | null = null
    const client = new BucketsGraphqlClient(API, async (url, init) => {
      captured = { url: String(url), init: init! }
      return jsonResponse({ data: { namespaces: { nodes: [] } } })
    })

    const data = await client.query<{ namespaces: { nodes: unknown[] } }>(
      "query { namespaces { nodes { id } } }"
    )

    expect(data.namespaces.nodes).toEqual([])
    expect(captured!.url).toBe(`${API}/graphql`)
    expect(captured!.init.method).toBe("POST")
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.query).toContain("namespaces")
    // No auth headers on queries
    const headers = captured!.init.headers as Record<string, string>
    expect(headers["X-SS58-Address"]).toBeUndefined()
  })

  it("throws BucketsApiError with joined messages on graphql errors", async () => {
    const client = new BucketsGraphqlClient(API, async () =>
      jsonResponse({ errors: [{ message: "boom" }, { message: "bang" }] })
    )
    await expect(client.query("query { x }")).rejects.toThrow("boom; bang")
  })

  it("throws BucketsApiError with status on non-ok http", async () => {
    const client = new BucketsGraphqlClient(API, async () => jsonResponse({}, 500))
    const err = await client.query("query { x }").catch((e) => e)
    expect(err).toBeInstanceOf(BucketsApiError)
    expect(err.status).toBe(500)
  })

  it("throws when data is missing", async () => {
    const client = new BucketsGraphqlClient(API, async () => jsonResponse({}))
    await expect(client.query("query { x }")).rejects.toThrow(/no data/i)
  })
})

describe("BucketsGraphqlClient.mutate", () => {
  it("signs the exact bytes it sends and attaches the returned headers", async () => {
    let sentBody = ""
    let sentHeaders: Record<string, string> = {}
    const client = new BucketsGraphqlClient(API, async (_url, init) => {
      sentBody = init!.body as string
      sentHeaders = init!.headers as Record<string, string>
      return jsonResponse({ data: { createTag: { id: "1-x" } } })
    })

    let signedBody = ""
    const data = await client.mutate<{ createTag: { id: string } }>(
      "mutation CreateTag($bucketId: BigInt!, $newTag: String!) { createTag(bucketId: $bucketId, newTag: $newTag) { id } }",
      { bucketId: "1", newTag: "x" },
      async (rawBody) => {
        signedBody = rawBody
        return { "X-SS58-Address": "5F...", "X-Signature": "0xsig", "X-Timestamp": "t" }
      }
    )

    expect(data.createTag.id).toBe("1-x")
    expect(signedBody).toBe(sentBody) // exact-bytes contract
    expect(sentHeaders["X-Signature"]).toBe("0xsig")
    expect(sentHeaders["Content-Type"]).toBe("application/json")
  })

  it("maps 401 to a signature-rejected message", async () => {
    const client = new BucketsGraphqlClient(API, async () => jsonResponse({}, 401))
    await expect(
      client.mutate("mutation { x }", undefined, async () => ({}))
    ).rejects.toThrow(/signature rejected/i)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/bucketsApiClient.spec.ts -v`
Expected: FAIL — cannot resolve `../../app/services/buckets/bucketsApiClient`.

- [ ] **Step 3: Implement the client**

```ts
// app/services/buckets/bucketsApiClient.ts
/**
 * GraphQL transport for the XcavateProfile buckets API.
 *
 * Queries are anonymous. Mutations are authenticated with the same Sr25519
 * header scheme as the profile REST API, except the body hash covers the RAW
 * request body bytes — so the string handed to `sign` must be byte-identical
 * to the string sent as the HTTP body. This class serializes once and uses
 * that single string for both.
 */

export class BucketsApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = "BucketsApiError"
  }
}

export type GraphqlSignFn = (rawBody: string) => Promise<HeadersInit>

interface GraphqlEnvelope<T> {
  data?: T
  errors?: Array<{ message?: string }>
}

export class BucketsGraphqlClient {
  constructor(
    private readonly apiUrl: string,
    private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis)
  ) {}

  private endpoint(): string {
    return `${this.apiUrl.replace(/\/$/, "")}/graphql`
  }

  private async send<T>(rawBody: string, headers: HeadersInit): Promise<T> {
    const response = await this.fetcher(this.endpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: rawBody
    })

    if (response.status === 401) {
      throw new BucketsApiError(
        "Signature rejected by the API — check the wallet account and your system clock",
        401
      )
    }
    if (!response.ok) {
      throw new BucketsApiError(`Buckets API HTTP ${response.status}`, response.status)
    }

    const envelope = (await response.json()) as GraphqlEnvelope<T>
    if (envelope.errors?.length) {
      throw new BucketsApiError(
        envelope.errors.map((e) => e.message || "Unknown API error").join("; ")
      )
    }
    if (!envelope.data) {
      throw new BucketsApiError("Buckets API returned no data")
    }
    return envelope.data
  }

  async query<T>(document: string, variables?: Record<string, unknown>): Promise<T> {
    const rawBody = JSON.stringify(variables ? { query: document, variables } : { query: document })
    return this.send<T>(rawBody, {})
  }

  async mutate<T>(
    document: string,
    variables: Record<string, unknown> | undefined,
    sign: GraphqlSignFn
  ): Promise<T> {
    const rawBody = JSON.stringify(variables ? { query: document, variables } : { query: document })
    const headers = await sign(rawBody)
    return this.send<T>(rawBody, headers)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/bucketsApiClient.spec.ts -v`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add app/services/buckets/bucketsApiClient.ts tests/unit/bucketsApiClient.spec.ts
git commit -m "feat: add GraphQL transport for XcavateProfile buckets API"
```

---

### Task 2: Wallet signing for GraphQL — `signGraphqlRequest`

**Files:**
- Modify: `app/services/wallet/extensionProvider.ts` (add one method after `signProfileRequest`, ~line 100)
- Modify: `app/composables/useWallet.ts` (add passthrough next to the existing `signProfileRequest` passthrough at line 43)

**Interfaces:**
- Consumes: `toCSharpHashHex`, `formatSignatureTimestamp`, `buildSignaturePayload` from `../profile/profileSigning` (already imported in the file).
- Produces: `WalletExtensionProvider.signGraphqlRequest(address: string, rawBody: string): Promise<HeadersInit>` and the same-named function returned from `useWallet()`.

No unit test — this mirrors the untested-by-design `signProfileRequest` (its pure helpers are golden-vector-tested in `tests/unit/profileSigning.spec.ts`; the extension interaction can't run under Vitest). Verified by typecheck now and the manual smoke test in Task 15.

- [ ] **Step 1: Add the provider method**

Insert into `WalletExtensionProvider` directly below `signProfileRequest`:

```ts
  /**
   * Sign a GraphQL mutation request. Unlike the profile REST API (which hashes
   * its own re-serialization of the body), the GraphQL SignatureValidator
   * hashes the RAW request body — so `rawBody` must be the exact string the
   * caller will send, and the caller must not re-serialize after signing.
   */
  async signGraphqlRequest(address: string, rawBody: string): Promise<HeadersInit> {
    await this.ensureEnabled()
    const { blake2AsHex, cryptoWaitReady } = await import("@polkadot/util-crypto")
    await cryptoWaitReady()

    const injector = await web3FromAddress(address)
    if (!injector.signer.signRaw) {
      throw new Error("WALLET_SIGNING_UNAVAILABLE")
    }

    const bodyHash = toCSharpHashHex(blake2AsHex(rawBody, 128))
    const timestamp = formatSignatureTimestamp(new Date())
    const payload = buildSignaturePayload("POST", "/graphql", bodyHash, timestamp)

    const payloadHash = blake2AsHex(payload, 128)
    const signed = await injector.signer.signRaw({
      address,
      data: payloadHash,
      type: "bytes"
    })

    return {
      "X-SS58-Address": address,
      "X-Signature": signed.signature,
      "X-Timestamp": timestamp
    }
  }
```

- [ ] **Step 2: Add the composable passthrough**

In `app/composables/useWallet.ts`, next to the existing `signProfileRequest` wrapper (line 43) add and export:

```ts
  async function signGraphqlRequest(address: string, rawBody: string): Promise<HeadersInit> {
    return provider.signGraphqlRequest(address, rawBody)
  }
```

and include `signGraphqlRequest` in the returned object (line ~63).

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/services/wallet/extensionProvider.ts app/composables/useWallet.ts
git commit -m "feat: add Sr25519 signing for GraphQL mutation requests"
```

---

### Task 3: Value codecs — key normalization, sha256, message classification

**Files:**
- Create: `app/services/buckets/valueCodecs.ts`
- Test: `tests/unit/valueCodecs.spec.ts`

**Interfaces:**
- Produces:
  - `normalizeFixed32ByteKey(value: string): string` — **port VERBATIM** from `app/services/papi/didCommRepository.ts` (find with `grep -n "function normalizeFixed32ByteKey" app/services/papi/didCommRepository.ts`); do not re-derive, its output format must match data already stored by the chain/indexer.
  - `sha256HexUtf8(input: string): Promise<string>` — port verbatim from the same file (`grep -n "function sha256HexUtf8"`).
  - `TEXT_CONTENT_TYPE`, `KEY_SHARING_CONTENT_TYPE`, `KEY_SHARING_MESSAGE_TAG` constants and `isFileMessage(message: { contentType: string | null; tag: string | null }): boolean` — port from `app/services/indexer/subqueryClient.ts:276-292`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/valueCodecs.spec.ts
import { describe, expect, it } from "vitest"
import {
  isFileMessage,
  KEY_SHARING_CONTENT_TYPE,
  KEY_SHARING_MESSAGE_TAG,
  normalizeFixed32ByteKey,
  sha256HexUtf8,
  TEXT_CONTENT_TYPE
} from "../../app/services/buckets/valueCodecs"

describe("normalizeFixed32ByteKey", () => {
  it("passes through 0x-prefixed 32-byte hex", () => {
    const hex = "0x" + "ab".repeat(32)
    expect(normalizeFixed32ByteKey(hex).toLowerCase()).toBe(hex)
  })

  it("decodes a 43-char base64url JWK x value to 0x hex", () => {
    // base64url of 32 bytes 0x00..0x1f
    const x = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"
    const result = normalizeFixed32ByteKey(x)
    expect(result.toLowerCase()).toBe(
      "0x000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"
    )
  })

  it("rejects values that are not 32 bytes", () => {
    expect(() => normalizeFixed32ByteKey("abc")).toThrow()
  })
})

describe("sha256HexUtf8", () => {
  it("hashes utf-8 text to 0x-prefixed sha256", async () => {
    // echo -n "hello" | sha256sum
    expect(await sha256HexUtf8("hello")).toBe(
      "0x2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    )
  })
})

describe("isFileMessage", () => {
  it("rejects key-sharing tag regardless of content type", () => {
    expect(isFileMessage({ contentType: "image/png", tag: KEY_SHARING_MESSAGE_TAG })).toBe(false)
  })
  it("rejects text and key-sharing content types", () => {
    expect(isFileMessage({ contentType: TEXT_CONTENT_TYPE, tag: null })).toBe(false)
    expect(isFileMessage({ contentType: KEY_SHARING_CONTENT_TYPE, tag: null })).toBe(false)
    expect(isFileMessage({ contentType: null, tag: null })).toBe(false)
  })
  it("accepts real file content types", () => {
    expect(isFileMessage({ contentType: "image/png", tag: null })).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/valueCodecs.spec.ts -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `valueCodecs.ts`**

Port the three pieces verbatim from their current locations (grep commands above). `isFileMessage` and the constants are at `app/services/indexer/subqueryClient.ts:276-292`; `sha256HexUtf8` is at `app/services/papi/didCommRepository.ts:2641` (shape below for reference — copy the real one):

```ts
// Reference shape (copy actual implementations from the named source locations):
export const TEXT_CONTENT_TYPE = "text/plain;charset=utf-8"
export const KEY_SHARING_CONTENT_TYPE = "application/didcomm-encrypted+json"
export const KEY_SHARING_MESSAGE_TAG = "didcomm/key-sharing-v1"

export function isFileMessage(message: { contentType: string | null; tag: string | null }): boolean {
  if (message.tag === KEY_SHARING_MESSAGE_TAG) return false
  const contentType = message.contentType?.trim()
  return Boolean(contentType && contentType !== TEXT_CONTENT_TYPE && contentType !== KEY_SHARING_CONTENT_TYPE)
}
```

If the JWK test vector fails against the verbatim port, trust the port and fix the test's expected string to the port's actual output for that input — the port defines correctness.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/valueCodecs.spec.ts -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/services/buckets/valueCodecs.ts tests/unit/valueCodecs.spec.ts
git commit -m "feat: port key/content codecs to buckets service layer"
```

---

### Task 4: Repository skeleton + namespace reads

**Files:**
- Create: `app/services/buckets/types.ts`
- Create: `app/services/buckets/bucketsRepository.ts`
- Test: `tests/unit/bucketsRepository.namespaces.spec.ts`

**Interfaces:**
- Consumes: `BucketsGraphqlClient`, `GraphqlSignFn`, `BucketsApiError` (Task 1).
- Produces (all later tasks build on these):

```ts
// types.ts — exact contents
export interface ApiNamespace {
  id: string; namespaceId: string; name: string | null; schemaUri: string | null
  properties: string | null; creator: string | null; createdAt: string
}
export interface ApiBucket {
  id: string; bucketId: string; namespaceId: string; creator: string | null
  name: string | null; category: string | null; isWritable: boolean
  encryptionKey: string | null; createdAt: string; updatedAt: string
}
export interface ApiBucketWithMembers extends ApiBucket {
  admins: string[]; contributors: string[]
}
export interface ApiMessage {
  id: string; messageId: string; bucketId: string; contributor: string
  reference: string | null; tag: string | null; description: string | null
  contentType: string | null; contentHash: string | null
  ipfsContent: string | null; createdAt: string
}
export interface BucketDetail {
  bucket: ApiBucket; admins: string[]; contributors: string[]
  viewers: string[]; messages: ApiMessage[]
}
export interface MessagePage { nodes: ApiMessage[]; hasNextPage: boolean; endCursor: string | null }
export interface OperationUpdate { stage: "pending" | "success" | "error"; message: string }
export type OperationUpdateHandler = (update: OperationUpdate) => void
export interface MutationResult { id: string; method: string }
export type BucketMemberRole = "admin" | "contributor" | "viewer"
export interface PinataConfig {
  jwt?: string; apiKey?: string; apiSecret?: string; publicGateway?: string
}
export interface BucketsRepositoryOptions {
  apiUrl: string
  pinataConfig?: PinataConfig
  /** Signs a raw GraphQL body for `address`. Wire to WalletExtensionProvider.signGraphqlRequest. */
  sign?: (address: string, rawBody: string) => Promise<HeadersInit>
  fetcher?: typeof fetch
}
```

- Repository methods this task implements:
  - `fetchNamespaces(): Promise<ApiNamespace[]>`
  - `fetchNamespaceById(namespaceId: string): Promise<ApiNamespace | null>`
  - `fetchNamespacesByCreator(address: string): Promise<ApiNamespace[]>`
  - `fetchNamespaceManagers(namespaceId: string): Promise<string[]>`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/bucketsRepository.namespaces.spec.ts
import { describe, expect, it } from "vitest"
import { BucketsRepository } from "../../app/services/buckets/bucketsRepository"

const API = "https://profile-api.example"

/** Queue of canned graphql responses; captures each request body. */
function makeRepo(responses: unknown[]) {
  const requests: Array<{ query: string; variables?: Record<string, unknown> }> = []
  const repo = new BucketsRepository({
    apiUrl: API,
    fetcher: async (_url, init) => {
      requests.push(JSON.parse(init!.body as string))
      const body = responses.shift()
      return new Response(JSON.stringify(body), { status: 200 })
    }
  })
  return { repo, requests }
}

describe("fetchNamespaces", () => {
  it("pages through the connection and maps nodes", async () => {
    const page = (ids: number[], hasNextPage: boolean, endCursor: string | null) => ({
      data: {
        namespaces: {
          nodes: ids.map((n) => ({
            id: String(n), namespaceId: String(n), name: `ns${n}`,
            schemaUri: null, properties: null, creator: "5F", createdAt: "2026-01-01T00:00:00Z"
          })),
          pageInfo: { hasNextPage, endCursor }
        }
      }
    })
    const { repo, requests } = makeRepo([page([1, 2], true, "c1"), page([3], false, null)])

    const namespaces = await repo.fetchNamespaces()

    expect(namespaces.map((n) => n.namespaceId)).toEqual(["1", "2", "3"])
    expect(requests[1]!.variables).toMatchObject({ after: "c1" })
    expect(requests[0]!.query).toContain("order: [{ createdAt: ASC }]")
  })
})

describe("fetchNamespaceById", () => {
  it("returns null for a missing namespace", async () => {
    const { repo } = makeRepo([{ data: { namespace: null } }])
    expect(await repo.fetchNamespaceById("9")).toBeNull()
  })
})

describe("fetchNamespaceManagers", () => {
  it("filters by numeric namespaceId (Long) and returns manager addresses", async () => {
    const { repo, requests } = makeRepo([
      {
        data: {
          namespaceManagers: {
            nodes: [{ manager: "5A" }, { manager: "5B" }],
            pageInfo: { hasNextPage: false, endCursor: null }
          }
        }
      }
    ])

    expect(await repo.fetchNamespaceManagers("7")).toEqual(["5A", "5B"])
    // Filters use the Long scalar -> JS number, not string
    expect(requests[0]!.variables).toMatchObject({ namespaceId: 7 })
  })
})

describe("fetchNamespacesByCreator", () => {
  it("filters by creator address", async () => {
    const { repo, requests } = makeRepo([
      { data: { namespaces: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } }
    ])
    await repo.fetchNamespacesByCreator("5CREATOR")
    expect(requests[0]!.variables).toMatchObject({ address: "5CREATOR" })
    expect(requests[0]!.query).toContain("creator: { eq: $address }")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/bucketsRepository.namespaces.spec.ts -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `types.ts` (contents above, verbatim) and `bucketsRepository.ts`**

```ts
// app/services/buckets/bucketsRepository.ts
import { BucketsGraphqlClient } from "./bucketsApiClient"
import type {
  ApiNamespace,
  BucketsRepositoryOptions,
  OperationUpdateHandler
} from "./types"

interface ConnectionPage<T> {
  nodes: T[]
  pageInfo: { hasNextPage: boolean; endCursor: string | null }
}

const NAMESPACE_FIELDS = "id namespaceId name schemaUri properties creator createdAt"

export class BucketsRepository {
  protected readonly client: BucketsGraphqlClient
  protected readonly options: BucketsRepositoryOptions

  constructor(options: BucketsRepositoryOptions) {
    this.options = options
    this.client = new BucketsGraphqlClient(options.apiUrl, options.fetcher)
  }

  /** Loop a cursor connection to exhaustion. `field` is the root field name. */
  protected async fetchAllPages<T>(
    field: string,
    document: string,
    variables: Record<string, unknown>
  ): Promise<T[]> {
    const all: T[] = []
    let after: string | null = null

    for (;;) {
      const vars: Record<string, unknown> = { ...variables }
      if (after) vars.after = after
      const data = await this.client.query<Record<string, ConnectionPage<T>>>(document, vars)
      const page = data[field]
      if (!page) throw new Error(`Buckets API response missing '${field}'`)
      all.push(...page.nodes)
      if (!page.pageInfo.hasNextPage || !page.pageInfo.endCursor) return all
      after = page.pageInfo.endCursor
    }
  }

  /** Filter values use the Long scalar — numbers on the wire. */
  protected asLong(id: string, label: string): number {
    const value = Number(id.trim())
    if (!Number.isFinite(value)) {
      throw new Error(`${label} must be numeric`)
    }
    return value
  }

  async fetchNamespaces(): Promise<ApiNamespace[]> {
    return this.fetchAllPages<ApiNamespace>(
      "namespaces",
      `query Namespaces($after: String) {
        namespaces(first: 50, after: $after, order: [{ createdAt: ASC }]) {
          nodes { ${NAMESPACE_FIELDS} }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      {}
    )
  }

  async fetchNamespaceById(namespaceId: string): Promise<ApiNamespace | null> {
    const data = await this.client.query<{ namespace: ApiNamespace | null }>(
      `query NamespaceById($id: ID!) {
        namespace(id: $id) { ${NAMESPACE_FIELDS} }
      }`,
      { id: namespaceId.trim() }
    )
    return data.namespace
  }

  async fetchNamespacesByCreator(address: string): Promise<ApiNamespace[]> {
    return this.fetchAllPages<ApiNamespace>(
      "namespaces",
      `query NamespacesByCreator($address: String!, $after: String) {
        namespaces(first: 50, after: $after, where: { creator: { eq: $address } }, order: [{ createdAt: ASC }]) {
          nodes { ${NAMESPACE_FIELDS} }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { address: address.trim() }
    )
  }

  async fetchNamespaceManagers(namespaceId: string): Promise<string[]> {
    const nodes = await this.fetchAllPages<{ manager: string }>(
      "namespaceManagers",
      `query NamespaceManagers($namespaceId: Long!, $after: String) {
        namespaceManagers(first: 50, after: $after, where: { namespaceId: { eq: $namespaceId } }, order: [{ addedAt: ASC }]) {
          nodes { manager }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { namespaceId: this.asLong(namespaceId, "Namespace id") }
    )
    return nodes.map((n) => n.manager)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/bucketsRepository.namespaces.spec.ts -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/services/buckets/types.ts app/services/buckets/bucketsRepository.ts tests/unit/bucketsRepository.namespaces.spec.ts
git commit -m "feat: buckets repository with namespace reads"
```

---

### Task 5: Bucket reads

**Files:**
- Modify: `app/services/buckets/bucketsRepository.ts`
- Test: `tests/unit/bucketsRepository.buckets.spec.ts`

**Interfaces:**
- Produces:
  - `fetchBucketsByNamespace(namespaceId: string): Promise<ApiBucketWithMembers[]>` (admins/contributors as address arrays)
  - `fetchBucket(bucketId: string): Promise<ApiBucket | null>`
  - `fetchBucketDetail(bucketId: string): Promise<BucketDetail | null>`
  - `fetchBucketAdmins(bucketId: string): Promise<string[]>`
  - `fetchBucketContributors(bucketId: string): Promise<string[]>`
  - `fetchBucketViewers(bucketId: string): Promise<string[]>`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/bucketsRepository.buckets.spec.ts
import { describe, expect, it } from "vitest"
import { BucketsRepository } from "../../app/services/buckets/bucketsRepository"

const API = "https://profile-api.example"

function makeRepo(responses: unknown[]) {
  const requests: Array<{ query: string; variables?: Record<string, unknown> }> = []
  const repo = new BucketsRepository({
    apiUrl: API,
    fetcher: async (_url, init) => {
      requests.push(JSON.parse(init!.body as string))
      return new Response(JSON.stringify(responses.shift()), { status: 200 })
    }
  })
  return { repo, requests }
}

const BUCKET_NODE = {
  id: "12", bucketId: "12", namespaceId: "3", creator: "5F", name: "chat",
  category: null, isWritable: true, encryptionKey: "0xabc",
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z"
}

describe("fetchBucketsByNamespace", () => {
  it("maps nested member lists to address arrays", async () => {
    const { repo, requests } = makeRepo([
      {
        data: {
          buckets: {
            nodes: [{
              ...BUCKET_NODE,
              admins: [{ subjectId: "5A" }],
              contributors: [{ subjectId: "5B" }, { subjectId: "5C" }]
            }],
            pageInfo: { hasNextPage: false, endCursor: null }
          }
        }
      }
    ])

    const buckets = await repo.fetchBucketsByNamespace("3")
    expect(buckets[0]!.admins).toEqual(["5A"])
    expect(buckets[0]!.contributors).toEqual(["5B", "5C"])
    expect(requests[0]!.variables).toMatchObject({ namespaceId: 3 })
  })
})

describe("fetchBucket", () => {
  it("queries by numeric bucketId and returns the single node", async () => {
    const { repo, requests } = makeRepo([
      { data: { buckets: { nodes: [BUCKET_NODE], pageInfo: { hasNextPage: false, endCursor: null } } } }
    ])
    const bucket = await repo.fetchBucket("12")
    expect(bucket?.name).toBe("chat")
    expect(requests[0]!.variables).toMatchObject({ bucketId: 12 })
  })

  it("returns null when no bucket matches", async () => {
    const { repo } = makeRepo([
      { data: { buckets: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } }
    ])
    expect(await repo.fetchBucket("999")).toBeNull()
  })
})

describe("fetchBucketDetail", () => {
  it("flattens members and messages", async () => {
    const { repo } = makeRepo([
      {
        data: {
          bucket: {
            ...BUCKET_NODE,
            admins: [{ subjectId: "5A" }],
            contributors: [],
            viewers: [{ viewerId: "0xkey" }],
            messages: [{
              id: "12-1", messageId: "1", contributor: "5B", reference: "cid",
              tag: null, description: null, contentType: "text/plain;charset=utf-8",
              contentHash: "0xh", ipfsContent: "cipher", createdAt: "2026-01-03T00:00:00Z"
            }]
          }
        }
      }
    ])

    const detail = await repo.fetchBucketDetail("12")
    expect(detail!.admins).toEqual(["5A"])
    expect(detail!.viewers).toEqual(["0xkey"])
    expect(detail!.messages[0]!.bucketId).toBe("12")
  })

  it("returns null for a missing bucket", async () => {
    const { repo } = makeRepo([{ data: { bucket: null } }])
    expect(await repo.fetchBucketDetail("999")).toBeNull()
  })
})

describe("member address lists", () => {
  it("fetchBucketAdmins uses the bucketAdmins root query", async () => {
    const { repo, requests } = makeRepo([
      {
        data: {
          bucketAdmins: {
            nodes: [{ subjectId: "5A" }],
            pageInfo: { hasNextPage: false, endCursor: null }
          }
        }
      }
    ])
    expect(await repo.fetchBucketAdmins("12")).toEqual(["5A"])
    expect(requests[0]!.query).toContain("bucketAdmins")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/bucketsRepository.buckets.spec.ts -v`
Expected: FAIL — methods do not exist.

- [ ] **Step 3: Add the methods to `BucketsRepository`**

Add a shared fields constant and the methods:

```ts
const BUCKET_FIELDS =
  "id bucketId namespaceId creator name category isWritable encryptionKey createdAt updatedAt"
const MESSAGE_FIELDS =
  "id messageId contributor reference tag description contentType contentHash ipfsContent createdAt"
```

```ts
  async fetchBucketsByNamespace(namespaceId: string): Promise<ApiBucketWithMembers[]> {
    type Node = ApiBucket & { admins: Array<{ subjectId: string }>; contributors: Array<{ subjectId: string }> }
    const nodes = await this.fetchAllPages<Node>(
      "buckets",
      `query BucketsByNamespace($namespaceId: Long!, $after: String) {
        buckets(first: 50, after: $after, where: { namespaceId: { eq: $namespaceId } }, order: [{ createdAt: ASC }]) {
          nodes { ${BUCKET_FIELDS} admins { subjectId } contributors { subjectId } }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { namespaceId: this.asLong(namespaceId, "Namespace id") }
    )
    return nodes.map((n) => ({
      ...n,
      admins: n.admins.map((a) => a.subjectId),
      contributors: n.contributors.map((c) => c.subjectId)
    }))
  }

  async fetchBucket(bucketId: string): Promise<ApiBucket | null> {
    const data = await this.client.query<{ buckets: { nodes: ApiBucket[] } }>(
      `query BucketByBucketId($bucketId: Long!) {
        buckets(first: 1, where: { bucketId: { eq: $bucketId } }) {
          nodes { ${BUCKET_FIELDS} }
        }
      }`,
      { bucketId: this.asLong(bucketId, "Bucket id") }
    )
    return data.buckets.nodes[0] ?? null
  }

  async fetchBucketDetail(bucketId: string): Promise<BucketDetail | null> {
    type Raw = ApiBucket & {
      admins: Array<{ subjectId: string }>
      contributors: Array<{ subjectId: string }>
      viewers: Array<{ viewerId: string }>
      messages: Array<Omit<ApiMessage, "bucketId">>
    }
    const data = await this.client.query<{ bucket: Raw | null }>(
      `query BucketDetail($id: ID!) {
        bucket(id: $id) {
          ${BUCKET_FIELDS}
          admins { subjectId }
          contributors { subjectId }
          viewers { viewerId }
          messages { ${MESSAGE_FIELDS} }
        }
      }`,
      { id: bucketId.trim() }
    )
    if (!data.bucket) return null
    const { admins, contributors, viewers, messages, ...bucket } = data.bucket
    return {
      bucket,
      admins: admins.map((a) => a.subjectId),
      contributors: contributors.map((c) => c.subjectId),
      viewers: viewers.map((v) => v.viewerId),
      messages: messages.map((m) => ({ ...m, bucketId: bucket.bucketId }))
    }
  }

  private async fetchMemberList(
    field: "bucketAdmins" | "bucketContributors" | "bucketViewers",
    idField: "subjectId" | "viewerId",
    bucketId: string
  ): Promise<string[]> {
    const nodes = await this.fetchAllPages<Record<string, string>>(
      field,
      `query Members($bucketId: Long!, $after: String) {
        ${field}(first: 50, after: $after, where: { bucketId: { eq: $bucketId } }, order: [{ addedAt: ASC }]) {
          nodes { ${idField} }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { bucketId: this.asLong(bucketId, "Bucket id") }
    )
    return nodes.map((n) => n[idField]!)
  }

  async fetchBucketAdmins(bucketId: string): Promise<string[]> {
    return this.fetchMemberList("bucketAdmins", "subjectId", bucketId)
  }

  async fetchBucketContributors(bucketId: string): Promise<string[]> {
    return this.fetchMemberList("bucketContributors", "subjectId", bucketId)
  }

  async fetchBucketViewers(bucketId: string): Promise<string[]> {
    return this.fetchMemberList("bucketViewers", "viewerId", bucketId)
  }
```

Extend the imports from `./types` with `ApiBucket, ApiBucketWithMembers, ApiMessage, BucketDetail`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/bucketsRepository.buckets.spec.ts -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/services/buckets/bucketsRepository.ts tests/unit/bucketsRepository.buckets.spec.ts
git commit -m "feat: bucket reads in buckets repository"
```

---

### Task 6: Message reads

**Files:**
- Modify: `app/services/buckets/bucketsRepository.ts`
- Test: `tests/unit/bucketsRepository.messages.spec.ts`

**Interfaces:**
- Consumes: `TEXT_CONTENT_TYPE`, `KEY_SHARING_CONTENT_TYPE` from `./valueCodecs` (Task 3).
- Produces:
  - `fetchMessages(bucketId: string): Promise<ApiMessage[]>` (ascending `createdAt`)
  - `fetchMessagesByTag(bucketId: string, tag: string): Promise<ApiMessage[]>`
  - `fetchFileMessagesPage(bucketId: string, opts?: { first?: number; after?: string | null }): Promise<MessagePage>` (descending `createdAt`, default `first: 20`)
  - `fetchLatestMessageTimes(bucketIds: string[]): Promise<Record<string, string>>` (bucketId → newest `createdAt`; aliased single-request batch)

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/bucketsRepository.messages.spec.ts
import { describe, expect, it } from "vitest"
import { BucketsRepository } from "../../app/services/buckets/bucketsRepository"

const API = "https://profile-api.example"

function makeRepo(responses: unknown[]) {
  const requests: Array<{ query: string; variables?: Record<string, unknown> }> = []
  const repo = new BucketsRepository({
    apiUrl: API,
    fetcher: async (_url, init) => {
      requests.push(JSON.parse(init!.body as string))
      return new Response(JSON.stringify(responses.shift()), { status: 200 })
    }
  })
  return { repo, requests }
}

const MSG = (n: number) => ({
  id: `12-${n}`, messageId: String(n), contributor: "5B", reference: "cid",
  tag: null, description: null, contentType: "text/plain;charset=utf-8",
  contentHash: "0xh", ipfsContent: "cipher", createdAt: `2026-01-0${n}T00:00:00Z`,
  bucket: { bucketId: "12" }
})

describe("fetchMessages", () => {
  it("filters via the nested bucket relation and flattens bucketId", async () => {
    const { repo, requests } = makeRepo([
      {
        data: {
          messages: {
            nodes: [MSG(1), MSG(2)],
            pageInfo: { hasNextPage: false, endCursor: null }
          }
        }
      }
    ])

    const messages = await repo.fetchMessages("12")
    expect(messages).toHaveLength(2)
    expect(messages[0]!.bucketId).toBe("12")
    expect(requests[0]!.query).toContain("bucket: { bucketId: { eq: $bucketId } }")
    expect(requests[0]!.query).toContain("order: [{ createdAt: ASC }]")
    expect(requests[0]!.variables).toMatchObject({ bucketId: 12 })
  })
})

describe("fetchMessagesByTag", () => {
  it("adds the tag filter", async () => {
    const { repo, requests } = makeRepo([
      { data: { messages: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } }
    ])
    await repo.fetchMessagesByTag("12", "didcomm/key-sharing-v1")
    expect(requests[0]!.query).toContain("tag: { eq: $tag }")
    expect(requests[0]!.variables).toMatchObject({ tag: "didcomm/key-sharing-v1" })
  })
})

describe("fetchFileMessagesPage", () => {
  it("excludes text and key-sharing content types, newest first, one page", async () => {
    const { repo, requests } = makeRepo([
      {
        data: {
          messages: {
            nodes: [{ ...MSG(2), contentType: "image/png" }],
            pageInfo: { hasNextPage: true, endCursor: "c9" }
          }
        }
      }
    ])

    const page = await repo.fetchFileMessagesPage("12", { first: 10 })
    expect(page.hasNextPage).toBe(true)
    expect(page.endCursor).toBe("c9")
    expect(requests[0]!.query).toContain("neq: null")
    expect(requests[0]!.query).toContain("order: [{ createdAt: DESC }]")
    expect(requests[0]!.variables).toMatchObject({ first: 10 })
  })
})

describe("fetchLatestMessageTimes", () => {
  it("batches per-bucket newest-message queries into one aliased document", async () => {
    const { repo, requests } = makeRepo([
      {
        data: {
          b0: { nodes: [{ createdAt: "2026-02-01T00:00:00Z" }] },
          b1: { nodes: [] }
        }
      }
    ])

    const times = await repo.fetchLatestMessageTimes(["5", "9"])
    expect(times).toEqual({ "5": "2026-02-01T00:00:00Z" })
    expect(requests).toHaveLength(1)
    expect(requests[0]!.query).toContain("b0:")
    expect(requests[0]!.query).toContain("b1:")
  })

  it("returns empty for no ids without calling the API", async () => {
    const { repo, requests } = makeRepo([])
    expect(await repo.fetchLatestMessageTimes([])).toEqual({})
    expect(requests).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/bucketsRepository.messages.spec.ts -v`
Expected: FAIL — methods do not exist.

- [ ] **Step 3: Add the methods**

```ts
  private mapMessageNode(node: Omit<ApiMessage, "bucketId"> & { bucket: { bucketId: string } }): ApiMessage {
    const { bucket, ...rest } = node
    return { ...rest, bucketId: bucket.bucketId }
  }

  async fetchMessages(bucketId: string): Promise<ApiMessage[]> {
    type Node = Omit<ApiMessage, "bucketId"> & { bucket: { bucketId: string } }
    const nodes = await this.fetchAllPages<Node>(
      "messages",
      `query BucketMessages($bucketId: Long!, $after: String) {
        messages(first: 50, after: $after, where: { bucket: { bucketId: { eq: $bucketId } } }, order: [{ createdAt: ASC }]) {
          nodes { ${MESSAGE_FIELDS} bucket { bucketId } }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { bucketId: this.asLong(bucketId, "Bucket id") }
    )
    return nodes.map((n) => this.mapMessageNode(n))
  }

  async fetchMessagesByTag(bucketId: string, tag: string): Promise<ApiMessage[]> {
    type Node = Omit<ApiMessage, "bucketId"> & { bucket: { bucketId: string } }
    const nodes = await this.fetchAllPages<Node>(
      "messages",
      `query BucketMessagesByTag($bucketId: Long!, $tag: String!, $after: String) {
        messages(first: 50, after: $after, where: { bucket: { bucketId: { eq: $bucketId } }, tag: { eq: $tag } }, order: [{ createdAt: ASC }]) {
          nodes { ${MESSAGE_FIELDS} bucket { bucketId } }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { bucketId: this.asLong(bucketId, "Bucket id"), tag }
    )
    return nodes.map((n) => this.mapMessageNode(n))
  }

  async fetchFileMessagesPage(
    bucketId: string,
    opts?: { first?: number; after?: string | null }
  ): Promise<MessagePage> {
    type Node = Omit<ApiMessage, "bucketId"> & { bucket: { bucketId: string } }
    const vars: Record<string, unknown> = {
      bucketId: this.asLong(bucketId, "Bucket id"),
      first: opts?.first ?? 20
    }
    if (opts?.after) vars.after = opts.after

    const data = await this.client.query<{ messages: ConnectionPage<Node> }>(
      `query FileMessagesPage($bucketId: Long!, $first: Int!, $after: String) {
        messages(
          first: $first
          after: $after
          where: {
            bucket: { bucketId: { eq: $bucketId } }
            contentType: { neq: null, nin: ["${TEXT_CONTENT_TYPE}", "${KEY_SHARING_CONTENT_TYPE}"] }
          }
          order: [{ createdAt: DESC }]
        ) {
          nodes { ${MESSAGE_FIELDS} bucket { bucketId } }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      vars
    )
    return {
      nodes: data.messages.nodes.map((n) => this.mapMessageNode(n)),
      hasNextPage: data.messages.pageInfo.hasNextPage,
      endCursor: data.messages.pageInfo.endCursor
    }
  }

  async fetchLatestMessageTimes(bucketIds: string[]): Promise<Record<string, string>> {
    const numeric = bucketIds.map((id) => this.asLong(id, "Bucket id"))
    if (!numeric.length) return {}

    const fields = numeric
      .map(
        (id, i) =>
          `b${i}: messages(first: 1, where: { bucket: { bucketId: { eq: ${id} } } }, order: [{ createdAt: DESC }]) { nodes { createdAt } }`
      )
      .join("\n")
    const data = await this.client.query<Record<string, { nodes: Array<{ createdAt: string }> }>>(
      `query LatestMessageTimes {\n${fields}\n}`
    )

    const result: Record<string, string> = {}
    numeric.forEach((id, i) => {
      const createdAt = data[`b${i}`]?.nodes[0]?.createdAt
      if (createdAt) result[String(id)] = createdAt
    })
    return result
  }
```

Add imports: `TEXT_CONTENT_TYPE, KEY_SHARING_CONTENT_TYPE` from `./valueCodecs`; `MessagePage` from `./types`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/bucketsRepository.messages.spec.ts -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/services/buckets/bucketsRepository.ts tests/unit/bucketsRepository.messages.spec.ts
git commit -m "feat: message reads in buckets repository"
```

---

### Task 7: My-buckets membership query

**Files:**
- Modify: `app/services/buckets/bucketsRepository.ts`
- Test: `tests/unit/bucketsRepository.myBuckets.spec.ts`

**Interfaces:**
- Produces:

```ts
export interface MyBucketSummary {
  id: string; bucketId: string; namespaceId: string; name: string | null
  isAdmin: boolean; isContributor: boolean; isViewer: boolean
}
// in types.ts
```
  - `fetchMyBuckets(address: string, viewerKeyHex: string, opts?: { first?: number; after?: string | null }): Promise<{ nodes: MyBucketSummary[]; totalCount: number; hasNextPage: boolean; endCursor: string | null }>`

Replaces the inline SubQuery `MyBuckets` query in `app/pages/messages/my-buckets.vue:218-262`. Ordering: `[{ updatedAt: DESC }, { bucketId: ASC }]` (nearest equivalent of `MESSAGES_MAX_CREATED_BLOCK_DESC`); last-activity display comes from `fetchLatestMessageTimes` (Task 6). Cursor pagination replaces offset pagination.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/bucketsRepository.myBuckets.spec.ts
import { describe, expect, it } from "vitest"
import { BucketsRepository } from "../../app/services/buckets/bucketsRepository"

function makeRepo(responses: unknown[]) {
  const requests: Array<{ query: string; variables?: Record<string, unknown> }> = []
  const repo = new BucketsRepository({
    apiUrl: "https://profile-api.example",
    fetcher: async (_url, init) => {
      requests.push(JSON.parse(init!.body as string))
      return new Response(JSON.stringify(responses.shift()), { status: 200 })
    }
  })
  return { repo, requests }
}

describe("fetchMyBuckets", () => {
  it("returns one page with client-side role flags and totalCount", async () => {
    const { repo, requests } = makeRepo([
      {
        data: {
          buckets: {
            totalCount: 41,
            nodes: [{
              id: "12", bucketId: "12", namespaceId: "3", name: "chat",
              admins: [{ subjectId: "5ME" }],
              contributors: [{ subjectId: "5OTHER" }],
              viewers: [{ viewerId: "0xmykey" }]
            }],
            pageInfo: { hasNextPage: true, endCursor: "c2" }
          }
        }
      }
    ])

    const page = await repo.fetchMyBuckets("5ME", "0xmykey", { first: 20 })

    expect(page.totalCount).toBe(41)
    expect(page.hasNextPage).toBe(true)
    expect(page.endCursor).toBe("c2")
    expect(page.nodes[0]).toMatchObject({
      bucketId: "12", isAdmin: true, isContributor: false, isViewer: true
    })
    expect(requests[0]!.query).toContain("or: [")
    expect(requests[0]!.variables).toMatchObject({ address: "5ME", viewerKey: "0xmykey", first: 20 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/bucketsRepository.myBuckets.spec.ts -v`
Expected: FAIL.

- [ ] **Step 3: Add `MyBucketSummary` to `types.ts` (exact shape above) and the method**

```ts
  async fetchMyBuckets(
    address: string,
    viewerKeyHex: string,
    opts?: { first?: number; after?: string | null }
  ): Promise<{ nodes: MyBucketSummary[]; totalCount: number; hasNextPage: boolean; endCursor: string | null }> {
    type Node = {
      id: string; bucketId: string; namespaceId: string; name: string | null
      admins: Array<{ subjectId: string }>
      contributors: Array<{ subjectId: string }>
      viewers: Array<{ viewerId: string }>
    }
    const vars: Record<string, unknown> = {
      address,
      viewerKey: viewerKeyHex || " none",
      first: opts?.first ?? 20
    }
    if (opts?.after) vars.after = opts.after

    const data = await this.client.query<{ buckets: ConnectionPage<Node> & { totalCount: number } }>(
      `query MyBuckets($address: String!, $viewerKey: String!, $first: Int!, $after: String) {
        buckets(
          first: $first
          after: $after
          order: [{ updatedAt: DESC }, { bucketId: ASC }]
          where: {
            or: [
              { admins: { some: { subjectId: { eq: $address } } } }
              { contributors: { some: { subjectId: { eq: $address } } } }
              { viewers: { some: { viewerId: { eq: $viewerKey } } } }
            ]
          }
        ) {
          totalCount
          nodes {
            id bucketId namespaceId name
            admins { subjectId }
            contributors { subjectId }
            viewers { viewerId }
          }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      vars
    )

    return {
      totalCount: data.buckets.totalCount,
      hasNextPage: data.buckets.pageInfo.hasNextPage,
      endCursor: data.buckets.pageInfo.endCursor,
      nodes: data.buckets.nodes.map((n) => ({
        id: n.id,
        bucketId: n.bucketId,
        namespaceId: n.namespaceId,
        name: n.name,
        isAdmin: n.admins.some((a) => a.subjectId === address),
        isContributor: n.contributors.some((c) => c.subjectId === address),
        isViewer: Boolean(viewerKeyHex) && n.viewers.some((v) => v.viewerId === viewerKeyHex)
      }))
    }
  }
```

(`" none"` guards the empty-viewer-key case: `eq: ""` could accidentally match empty-string rows; a sentinel that can never be a stored key matches nothing, mirroring the old behavior where an empty key produced no viewer matches.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/bucketsRepository.myBuckets.spec.ts -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/services/buckets/types.ts app/services/buckets/bucketsRepository.ts tests/unit/bucketsRepository.myBuckets.spec.ts
git commit -m "feat: my-buckets membership query in buckets repository"
```

---

### Task 8: Simple mutations

**Files:**
- Modify: `app/services/buckets/bucketsRepository.ts`
- Test: `tests/unit/bucketsRepository.mutations.spec.ts`

**Interfaces:**
- Consumes: `options.sign` (`(address, rawBody) => Promise<HeadersInit>`), `normalizeFixed32ByteKey` (Task 3).
- Produces (signatures match the old `DidCommRepository` so page churn stays minimal — `ownerAddress` required, `onUpdate` optional):
  - `createNamespace(name: string, ownerAddress: string, onUpdate?: OperationUpdateHandler): Promise<MutationResult>`
  - `createBucket(namespaceId: string, name: string, ownerAddress: string, onUpdate?: OperationUpdateHandler, category?: string): Promise<MutationResult>`
  - `createTag(bucketId: string, tag: string, ownerAddress: string, onUpdate?: OperationUpdateHandler): Promise<MutationResult>`
  - `addNamespaceManager(namespaceId: string, memberAddress: string, ownerAddress: string, onUpdate?: OperationUpdateHandler): Promise<MutationResult>`
  - `removeNamespaceManager(...)` same shape
  - `removeBucketAdmin(namespaceId, bucketId, memberAddress, ownerAddress, onUpdate?)`, `removeBucketContributor(...)`, `removeBucketViewer(...)` — same shape
  - `setBucketPublicKey(namespaceId: string, bucketId: string, newEncryptionKey: string, ownerAddress: string, onUpdate?: OperationUpdateHandler): Promise<MutationResult>`
- **Mutation variables use the BigInt scalar → ids sent as strings.**

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/bucketsRepository.mutations.spec.ts
import { describe, expect, it } from "vitest"
import { BucketsRepository } from "../../app/services/buckets/bucketsRepository"
import type { OperationUpdate } from "../../app/services/buckets/types"

function makeRepo(responses: unknown[]) {
  const requests: Array<{ query: string; variables?: Record<string, unknown> }> = []
  const signed: Array<{ address: string; rawBody: string }> = []
  const repo = new BucketsRepository({
    apiUrl: "https://profile-api.example",
    sign: async (address, rawBody) => {
      signed.push({ address, rawBody })
      return { "X-SS58-Address": address, "X-Signature": "0xsig", "X-Timestamp": "t" }
    },
    fetcher: async (_url, init) => {
      requests.push(JSON.parse(init!.body as string))
      return new Response(JSON.stringify(responses.shift()), { status: 200 })
    }
  })
  return { repo, requests, signed }
}

describe("createNamespace", () => {
  it("signs as owner and sends metadata", async () => {
    const { repo, requests, signed } = makeRepo([
      { data: { createNamespace: { id: "4", namespaceId: "4" } } }
    ])
    const updates: OperationUpdate[] = []

    const result = await repo.createNamespace("my ns", "5OWNER", (u) => updates.push(u))

    expect(result).toEqual({ id: "4", method: "createNamespace" })
    expect(signed[0]!.address).toBe("5OWNER")
    expect(requests[0]!.variables).toMatchObject({
      metadata: { name: "my ns", schemaUri: null, properties: [] }
    })
    expect(updates.map((u) => u.stage)).toEqual(["pending", "success"])
  })

  it("emits error and rethrows on failure", async () => {
    const { repo } = makeRepo([{ errors: [{ message: "denied" }] }])
    const updates: OperationUpdate[] = []
    await expect(repo.createNamespace("x", "5OWNER", (u) => updates.push(u))).rejects.toThrow("denied")
    expect(updates.map((u) => u.stage)).toEqual(["pending", "error"])
  })

  it("rejects without an owner address", async () => {
    const { repo } = makeRepo([])
    await expect(repo.createNamespace("x", "")).rejects.toThrow(/wallet/i)
  })
})

describe("createBucket", () => {
  it("sends namespaceId as a BigInt string and defaults category to empty string", async () => {
    const { repo, requests } = makeRepo([{ data: { createBucket: { id: "9", bucketId: "9" } } }])
    const result = await repo.createBucket("3", "chat", "5OWNER")
    expect(result).toEqual({ id: "9", method: "createBucket" })
    expect(requests[0]!.variables).toMatchObject({
      namespaceId: "3",
      metadata: { name: "chat", category: "", properties: [] }
    })
  })
})

describe("member and manager mutations", () => {
  it("removeBucketAdmin sends string ids and the member address", async () => {
    const { repo, requests } = makeRepo([{ data: { removeAdmin: true } }])
    await repo.removeBucketAdmin("3", "9", "5X", "5OWNER")
    expect(requests[0]!.query).toContain("removeAdmin")
    expect(requests[0]!.variables).toMatchObject({ namespaceId: "3", bucketId: "9", admin: "5X" })
  })

  it("addNamespaceManager maps to addManager", async () => {
    const { repo, requests } = makeRepo([{ data: { addManager: { id: "3-5X" } } }])
    const result = await repo.addNamespaceManager("3", "5X", "5OWNER")
    expect(result.method).toBe("addManager")
    expect(requests[0]!.variables).toMatchObject({ namespaceId: "3", newManager: "5X" })
  })
})

describe("setBucketPublicKey", () => {
  it("maps to resumeWriting with a normalized 32-byte key", async () => {
    const { repo, requests } = makeRepo([{ data: { resumeWriting: { id: "9" } } }])
    const hex = "0x" + "ab".repeat(32)
    await repo.setBucketPublicKey("3", "9", hex, "5OWNER")
    expect(requests[0]!.query).toContain("resumeWriting")
    expect(requests[0]!.variables).toMatchObject({ newEncryptionKey: hex })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/bucketsRepository.mutations.spec.ts -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add to `BucketsRepository` (imports: `normalizeFixed32ByteKey` from `./valueCodecs`; `MutationResult`, `OperationUpdateHandler` from `./types`):

```ts
  private requireSign(ownerAddress: string): (rawBody: string) => Promise<HeadersInit> {
    const sign = this.options.sign
    if (!sign) throw new Error("Repository was constructed without a signer")
    const address = ownerAddress.trim()
    if (!address) throw new Error("Wallet must be connected to submit this operation")
    return (rawBody) => sign(address, rawBody)
  }

  /** Run one signed mutation with pending/success/error updates. */
  private async runMutation<T>(
    method: string,
    ownerAddress: string,
    onUpdate: OperationUpdateHandler | undefined,
    document: string,
    variables: Record<string, unknown>,
    extractId: (data: T) => string
  ): Promise<MutationResult> {
    const sign = this.requireSign(ownerAddress)
    onUpdate?.({ stage: "pending", message: `Submitting ${method}…` })
    try {
      const data = await this.client.mutate<T>(document, variables, sign)
      onUpdate?.({ stage: "success", message: `${method} confirmed` })
      return { id: extractId(data), method }
    } catch (error) {
      const message = error instanceof Error ? error.message : `${method} failed`
      onUpdate?.({ stage: "error", message })
      throw error
    }
  }

  async createNamespace(
    name: string,
    ownerAddress: string,
    onUpdate?: OperationUpdateHandler
  ): Promise<MutationResult> {
    const trimmed = name.trim()
    if (!trimmed) throw new Error("Namespace name is required")
    return this.runMutation<{ createNamespace: { id: string } }>(
      "createNamespace",
      ownerAddress,
      onUpdate,
      `mutation CreateNamespace($metadata: NamespaceMetadataInput!) {
        createNamespace(metadata: $metadata) { id namespaceId }
      }`,
      { metadata: { name: trimmed, schemaUri: null, properties: [] } },
      (d) => d.createNamespace.id
    )
  }

  async createBucket(
    namespaceId: string,
    name: string,
    ownerAddress: string,
    onUpdate?: OperationUpdateHandler,
    category?: string
  ): Promise<MutationResult> {
    const trimmedName = name.trim()
    if (!trimmedName) throw new Error("Bucket name is required")
    return this.runMutation<{ createBucket: { id: string } }>(
      "createBucket",
      ownerAddress,
      onUpdate,
      `mutation CreateBucket($namespaceId: BigInt!, $metadata: BucketMetadataInput!) {
        createBucket(namespaceId: $namespaceId, metadata: $metadata) { id bucketId }
      }`,
      {
        namespaceId: namespaceId.trim(),
        metadata: { name: trimmedName, category: category?.trim() ?? "", properties: [] }
      },
      (d) => d.createBucket.id
    )
  }

  async createTag(
    bucketId: string,
    tag: string,
    ownerAddress: string,
    onUpdate?: OperationUpdateHandler
  ): Promise<MutationResult> {
    const trimmedTag = tag.trim()
    if (!trimmedTag) throw new Error("Tag is required")
    return this.runMutation<{ createTag: { id: string } }>(
      "createTag",
      ownerAddress,
      onUpdate,
      `mutation CreateTag($bucketId: BigInt!, $newTag: String!) {
        createTag(bucketId: $bucketId, newTag: $newTag) { id }
      }`,
      { bucketId: bucketId.trim(), newTag: trimmedTag },
      (d) => d.createTag.id
    )
  }

  async addNamespaceManager(
    namespaceId: string,
    memberAddress: string,
    ownerAddress: string,
    onUpdate?: OperationUpdateHandler
  ): Promise<MutationResult> {
    return this.runMutation<{ addManager: { id: string } }>(
      "addManager",
      ownerAddress,
      onUpdate,
      `mutation AddManager($namespaceId: BigInt!, $newManager: String!) {
        addManager(namespaceId: $namespaceId, newManager: $newManager) { id }
      }`,
      { namespaceId: namespaceId.trim(), newManager: memberAddress.trim() },
      (d) => d.addManager.id
    )
  }

  async removeNamespaceManager(
    namespaceId: string,
    memberAddress: string,
    ownerAddress: string,
    onUpdate?: OperationUpdateHandler
  ): Promise<MutationResult> {
    return this.runMutation<{ removeManager: boolean }>(
      "removeManager",
      ownerAddress,
      onUpdate,
      `mutation RemoveManager($namespaceId: BigInt!, $oldManager: String!) {
        removeManager(namespaceId: $namespaceId, oldManager: $oldManager)
      }`,
      { namespaceId: namespaceId.trim(), oldManager: memberAddress.trim() },
      () => memberAddress.trim()
    )
  }

  private async removeMember(
    field: "removeAdmin" | "removeContributor" | "removeViewer",
    argName: "admin" | "contributor" | "viewer",
    namespaceId: string,
    bucketId: string,
    member: string,
    ownerAddress: string,
    onUpdate?: OperationUpdateHandler
  ): Promise<MutationResult> {
    return this.runMutation<Record<string, boolean>>(
      field,
      ownerAddress,
      onUpdate,
      `mutation RemoveMember($namespaceId: BigInt!, $bucketId: BigInt!, $${argName}: String!) {
        ${field}(namespaceId: $namespaceId, bucketId: $bucketId, ${argName}: $${argName})
      }`,
      { namespaceId: namespaceId.trim(), bucketId: bucketId.trim(), [argName]: member.trim() },
      () => member.trim()
    )
  }

  async removeBucketAdmin(namespaceId: string, bucketId: string, memberAddress: string, ownerAddress: string, onUpdate?: OperationUpdateHandler): Promise<MutationResult> {
    return this.removeMember("removeAdmin", "admin", namespaceId, bucketId, memberAddress, ownerAddress, onUpdate)
  }

  async removeBucketContributor(namespaceId: string, bucketId: string, memberAddress: string, ownerAddress: string, onUpdate?: OperationUpdateHandler): Promise<MutationResult> {
    return this.removeMember("removeContributor", "contributor", namespaceId, bucketId, memberAddress, ownerAddress, onUpdate)
  }

  async removeBucketViewer(namespaceId: string, bucketId: string, viewerKey: string, ownerAddress: string, onUpdate?: OperationUpdateHandler): Promise<MutationResult> {
    return this.removeMember("removeViewer", "viewer", namespaceId, bucketId, normalizeFixed32ByteKey(viewerKey), ownerAddress, onUpdate)
  }

  async setBucketPublicKey(
    namespaceId: string,
    bucketId: string,
    newEncryptionKey: string,
    ownerAddress: string,
    onUpdate?: OperationUpdateHandler
  ): Promise<MutationResult> {
    const key = normalizeFixed32ByteKey(newEncryptionKey.trim())
    return this.runMutation<{ resumeWriting: { id: string } }>(
      "resumeWriting",
      ownerAddress,
      onUpdate,
      `mutation ResumeWriting($namespaceId: BigInt!, $bucketId: BigInt!, $newEncryptionKey: String!) {
        resumeWriting(namespaceId: $namespaceId, bucketId: $bucketId, newEncryptionKey: $newEncryptionKey) { id }
      }`,
      { namespaceId: namespaceId.trim(), bucketId: bucketId.trim(), newEncryptionKey: key },
      (d) => d.resumeWriting.id
    )
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/bucketsRepository.mutations.spec.ts -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/services/buckets/bucketsRepository.ts tests/unit/bucketsRepository.mutations.spec.ts
git commit -m "feat: simple signed mutations in buckets repository"
```

---

### Task 9: Combined-document mutations and the write path

**Files:**
- Modify: `app/services/buckets/bucketsRepository.ts`
- Test: `tests/unit/bucketsRepository.writes.spec.ts`

**Interfaces:**
- Consumes: `PinataStorageAdapter` from `../storage/pinataStorageAdapter` (`new PinataStorageAdapter(options).upload(data: Uint8Array | string): Promise<string>` returns a CID), `sha256HexUtf8`, `TEXT_CONTENT_TYPE`, `KEY_SHARING_CONTENT_TYPE`, `KEY_SHARING_MESSAGE_TAG`, `normalizeFixed32ByteKey` (Task 3).
- Produces (old `DidCommRepository` signatures preserved except `ownerAddress` is required):
  - `createMessage(bucketId: string, message: string, ownerAddress: string, onUpdate?: OperationUpdateHandler, tag?: string, contentType?: string): Promise<MutationResult>`
  - `createFileMessage(bucketId: string, fileJwe: string, fileContentType: string, ownerAddress: string, onUpdate?: OperationUpdateHandler): Promise<MutationResult>`
  - `rotateBucketKeyAndShare(namespaceId: string, bucketId: string, newEncryptionKey: string, tag: string, message: string, ownerAddress: string, onUpdate?: OperationUpdateHandler): Promise<MutationResult>`
  - `addBucketMemberWithRole(role: BucketMemberRole, namespaceId: string, bucketId: string, ss58Address: string, x25519Key: string, ownerAddress: string, onUpdate?: OperationUpdateHandler): Promise<MutationResult>`
  - `removeBucketMemberRoles(namespaceId: string, bucketId: string, memberAddress: string, roles: BucketMemberRole[], viewerKey: string | undefined, ownerAddress: string, onUpdate?: OperationUpdateHandler): Promise<MutationResult>`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/bucketsRepository.writes.spec.ts
import { describe, expect, it, vi } from "vitest"
import { BucketsRepository } from "../../app/services/buckets/bucketsRepository"

vi.mock("../../app/services/storage/pinataStorageAdapter", () => ({
  PinataStorageAdapter: class {
    async upload(): Promise<string> {
      return "bafyCID"
    }
  }
}))

function makeRepo(responses: unknown[]) {
  const requests: Array<{ query: string; variables?: Record<string, unknown> }> = []
  const repo = new BucketsRepository({
    apiUrl: "https://profile-api.example",
    pinataConfig: { jwt: "test" },
    sign: async (address) => ({ "X-SS58-Address": address }),
    fetcher: async (_url, init) => {
      requests.push(JSON.parse(init!.body as string))
      return new Response(JSON.stringify(responses.shift()), { status: 200 })
    }
  })
  return { repo, requests }
}

const BUCKET_RESPONSE = {
  data: {
    buckets: {
      nodes: [{
        id: "9", bucketId: "9", namespaceId: "3", creator: "5F", name: "chat",
        category: null, isWritable: true, encryptionKey: "0xabc",
        createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z"
      }],
      pageInfo: { hasNextPage: false, endCursor: null }
    }
  }
}

describe("createMessage", () => {
  it("uploads to Pinata, resolves namespaceId, and mirrors content into ipfsContent", async () => {
    const { repo, requests } = makeRepo([
      BUCKET_RESPONSE,
      { data: { write: { id: "9-5", messageId: "5" } } }
    ])

    const result = await repo.createMessage("9", "cipher-text", "5OWNER")

    expect(result).toEqual({ id: "9-5", method: "write" })
    const writeReq = requests[1]!
    expect(writeReq.variables).toMatchObject({
      namespaceId: "3",
      bucketId: "9",
      message: {
        reference: "bafyCID",
        tag: null,
        ipfsContent: "cipher-text",
        metadata: {
          description: "",
          contentType: "text/plain;charset=utf-8",
          properties: []
        }
      }
    })
    const metadata = (writeReq.variables!.message as { metadata: { contentHash: string } }).metadata
    expect(metadata.contentHash).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it("caches namespaceId per bucket across sends", async () => {
    const { repo, requests } = makeRepo([
      BUCKET_RESPONSE,
      { data: { write: { id: "9-5" } } },
      { data: { write: { id: "9-6" } } }
    ])
    await repo.createMessage("9", "a", "5OWNER")
    await repo.createMessage("9", "b", "5OWNER")
    expect(requests).toHaveLength(3) // bucket lookup only once
  })

  it("uses the key-sharing content type for the key-sharing tag", async () => {
    const { repo, requests } = makeRepo([
      BUCKET_RESPONSE,
      { data: { write: { id: "9-7" } } }
    ])
    await repo.createMessage("9", "jwe", "5OWNER", undefined, "didcomm/key-sharing-v1")
    const message = requests[1]!.variables!.message as { metadata: { contentType: string }; tag: string }
    expect(message.tag).toBe("didcomm/key-sharing-v1")
    expect(message.metadata.contentType).toBe("application/didcomm-encrypted+json")
  })
})

describe("rotateBucketKeyAndShare", () => {
  it("sends rotateKey and write in ONE signed document", async () => {
    const { repo, requests } = makeRepo([
      { data: { rotateKey: { id: "9" }, write: { id: "9-8", messageId: "8" } } }
    ])

    const result = await repo.rotateBucketKeyAndShare(
      "3", "9", "0x" + "ab".repeat(32), "didcomm/key-sharing-v1", "jwe", "5OWNER"
    )

    expect(result.method).toBe("rotateKey+write")
    expect(requests).toHaveLength(1)
    expect(requests[0]!.query).toContain("rotateKey")
    expect(requests[0]!.query).toContain("write")
  })
})

describe("addBucketMemberWithRole", () => {
  it("admin role sends addAdmin and addViewer in one document", async () => {
    const { repo, requests } = makeRepo([
      { data: { addAdmin: { id: "x" }, addViewer: { id: "y" } } }
    ])
    const jwkX = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"

    await repo.addBucketMemberWithRole("admin", "3", "9", "5NEW", jwkX, "5OWNER")

    expect(requests).toHaveLength(1)
    expect(requests[0]!.query).toContain("addAdmin")
    expect(requests[0]!.query).toContain("addViewer")
    const vars = requests[0]!.variables!
    expect(vars.subject).toBe("5NEW")
    expect(String(vars.viewerKey)).toMatch(/^0x[0-9a-f]{64}$/i)
  })

  it("viewer role sends only addViewer", async () => {
    const { repo, requests } = makeRepo([{ data: { addViewer: { id: "y" } } }])
    const jwkX = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"
    await repo.addBucketMemberWithRole("viewer", "3", "9", "5NEW", jwkX, "5OWNER")
    expect(requests[0]!.query).toContain("addViewer")
    expect(requests[0]!.query).not.toContain("addAdmin")
  })
})

describe("removeBucketMemberRoles", () => {
  it("builds a document with only the requested roles", async () => {
    const { repo, requests } = makeRepo([
      { data: { removeContributor: true, removeViewer: true } }
    ])
    await repo.removeBucketMemberRoles(
      "3", "9", "5X", ["contributor", "viewer"], "0x" + "cd".repeat(32), "5OWNER"
    )
    expect(requests[0]!.query).toContain("removeContributor")
    expect(requests[0]!.query).toContain("removeViewer")
    expect(requests[0]!.query).not.toContain("removeAdmin")
  })

  it("requires a viewer key when removing the viewer role", async () => {
    const { repo } = makeRepo([])
    await expect(
      repo.removeBucketMemberRoles("3", "9", "5X", ["viewer"], undefined, "5OWNER")
    ).rejects.toThrow(/viewer key/i)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/bucketsRepository.writes.spec.ts -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add to `BucketsRepository` (new imports: `PinataStorageAdapter` from `../storage/pinataStorageAdapter`; `sha256HexUtf8`, `KEY_SHARING_MESSAGE_TAG` etc. from `./valueCodecs`; `BucketMemberRole` from `./types`):

```ts
  private namespaceIdByBucket = new Map<string, string>()

  /** Resolve (and cache) the namespace that owns `bucketId` — `write` needs both ids. */
  private async resolveNamespaceId(bucketId: string): Promise<string> {
    const cached = this.namespaceIdByBucket.get(bucketId)
    if (cached) return cached
    const bucket = await this.fetchBucket(bucketId)
    if (!bucket) throw new Error(`Bucket ${bucketId} was not found`)
    this.namespaceIdByBucket.set(bucketId, bucket.namespaceId)
    return bucket.namespaceId
  }

  private async buildMessageInput(
    content: string,
    tag: string | undefined,
    contentTypeOverride: string | undefined
  ): Promise<Record<string, unknown>> {
    const normalizedTag = tag?.trim() || undefined
    const contentType =
      contentTypeOverride?.trim() ||
      (normalizedTag === KEY_SHARING_MESSAGE_TAG ? KEY_SHARING_CONTENT_TYPE : TEXT_CONTENT_TYPE)

    const pinata = new PinataStorageAdapter(this.options.pinataConfig)
    const cid = await pinata.upload(content)

    return {
      reference: cid,
      tag: normalizedTag ?? null,
      ipfsContent: content,
      metadata: {
        description: "",
        contentType,
        contentHash: await sha256HexUtf8(content),
        properties: []
      }
    }
  }

  async createMessage(
    bucketId: string,
    message: string,
    ownerAddress: string,
    onUpdate?: OperationUpdateHandler,
    tag?: string,
    contentType?: string
  ): Promise<MutationResult> {
    const trimmedBucketId = bucketId.trim()
    const trimmedMessage = message.trim()
    if (!trimmedBucketId) throw new Error("Bucket id is required")
    if (!trimmedMessage) throw new Error("Message is required")

    const namespaceId = await this.resolveNamespaceId(trimmedBucketId)
    const messageInput = await this.buildMessageInput(trimmedMessage, tag, contentType)

    return this.runMutation<{ write: { id: string } }>(
      "write",
      ownerAddress,
      onUpdate,
      `mutation WriteMessage($namespaceId: BigInt!, $bucketId: BigInt!, $message: MessageInput!) {
        write(namespaceId: $namespaceId, bucketId: $bucketId, message: $message) { id messageId }
      }`,
      { namespaceId, bucketId: trimmedBucketId, message: messageInput },
      (d) => d.write.id
    )
  }

  async createFileMessage(
    bucketId: string,
    fileJwe: string,
    fileContentType: string,
    ownerAddress: string,
    onUpdate?: OperationUpdateHandler
  ): Promise<MutationResult> {
    const trimmedJwe = fileJwe.trim()
    if (!trimmedJwe) throw new Error("File payload is required")
    const contentType = fileContentType.trim() || "application/octet-stream"
    return this.createMessage(bucketId, trimmedJwe, ownerAddress, onUpdate, undefined, contentType)
  }

  async rotateBucketKeyAndShare(
    namespaceId: string,
    bucketId: string,
    newEncryptionKey: string,
    tag: string,
    message: string,
    ownerAddress: string,
    onUpdate?: OperationUpdateHandler
  ): Promise<MutationResult> {
    const key = normalizeFixed32ByteKey(newEncryptionKey.trim())
    const messageInput = await this.buildMessageInput(message.trim(), tag, undefined)

    return this.runMutation<{ write: { id: string } }>(
      "rotateKey+write",
      ownerAddress,
      onUpdate,
      `mutation RotateKeyAndShare($namespaceId: BigInt!, $bucketId: BigInt!, $newEncryptionKey: String!, $message: MessageInput!) {
        rotateKey(namespaceId: $namespaceId, bucketId: $bucketId, newEncryptionKey: $newEncryptionKey) { id }
        write(namespaceId: $namespaceId, bucketId: $bucketId, message: $message) { id messageId }
      }`,
      {
        namespaceId: namespaceId.trim(),
        bucketId: bucketId.trim(),
        newEncryptionKey: key,
        message: messageInput
      },
      (d) => d.write.id
    )
  }

  async addBucketMemberWithRole(
    role: BucketMemberRole,
    namespaceId: string,
    bucketId: string,
    ss58Address: string,
    x25519Key: string,
    ownerAddress: string,
    onUpdate?: OperationUpdateHandler
  ): Promise<MutationResult> {
    const viewerKey = normalizeFixed32ByteKey(x25519Key.trim())
    const vars: Record<string, unknown> = {
      namespaceId: namespaceId.trim(),
      bucketId: bucketId.trim(),
      viewerKey
    }

    if (role === "viewer") {
      return this.runMutation<{ addViewer: { id: string } }>(
        "addViewer",
        ownerAddress,
        onUpdate,
        `mutation AddViewer($namespaceId: BigInt!, $bucketId: BigInt!, $viewerKey: String!) {
          addViewer(namespaceId: $namespaceId, bucketId: $bucketId, viewer: $viewerKey) { id }
        }`,
        vars,
        (d) => d.addViewer.id
      )
    }

    const roleField = role === "admin" ? "addAdmin" : "addContributor"
    const roleArg = role === "admin" ? "admin" : "contributor"
    vars.subject = ss58Address.trim()

    return this.runMutation<Record<string, { id: string }>>(
      `${roleField}+addViewer`,
      ownerAddress,
      onUpdate,
      `mutation AddMemberWithViewer($namespaceId: BigInt!, $bucketId: BigInt!, $subject: String!, $viewerKey: String!) {
        ${roleField}(namespaceId: $namespaceId, bucketId: $bucketId, ${roleArg}: $subject) { id }
        addViewer(namespaceId: $namespaceId, bucketId: $bucketId, viewer: $viewerKey) { id }
      }`,
      vars,
      (d) => d[roleField]!.id
    )
  }

  async removeBucketMemberRoles(
    namespaceId: string,
    bucketId: string,
    memberAddress: string,
    roles: BucketMemberRole[],
    viewerKey: string | undefined,
    ownerAddress: string,
    onUpdate?: OperationUpdateHandler
  ): Promise<MutationResult> {
    const orderedRoles: BucketMemberRole[] = (["admin", "contributor", "viewer"] as const).filter(
      (role) => roles.includes(role)
    )
    if (!orderedRoles.length) throw new Error("At least one role is required to remove a member")
    if (orderedRoles.includes("viewer") && !viewerKey?.trim()) {
      throw new Error("Viewer key is required to remove a viewer")
    }

    const fields: string[] = []
    const varDefs: string[] = ["$namespaceId: BigInt!", "$bucketId: BigInt!"]
    const vars: Record<string, unknown> = {
      namespaceId: namespaceId.trim(),
      bucketId: bucketId.trim()
    }
    if (orderedRoles.includes("admin") || orderedRoles.includes("contributor")) {
      varDefs.push("$subject: String!")
      vars.subject = memberAddress.trim()
    }
    if (orderedRoles.includes("admin")) {
      fields.push("removeAdmin(namespaceId: $namespaceId, bucketId: $bucketId, admin: $subject)")
    }
    if (orderedRoles.includes("contributor")) {
      fields.push("removeContributor(namespaceId: $namespaceId, bucketId: $bucketId, contributor: $subject)")
    }
    if (orderedRoles.includes("viewer")) {
      varDefs.push("$viewerKey: String!")
      vars.viewerKey = normalizeFixed32ByteKey(viewerKey!.trim())
      fields.push("removeViewer(namespaceId: $namespaceId, bucketId: $bucketId, viewer: $viewerKey)")
    }

    return this.runMutation<Record<string, boolean>>(
      orderedRoles.map((r) => `remove-${r}`).join("+"),
      ownerAddress,
      onUpdate,
      `mutation RemoveMemberRoles(${varDefs.join(", ")}) {\n${fields.join("\n")}\n}`,
      vars,
      () => memberAddress.trim()
    )
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/bucketsRepository.writes.spec.ts -v`
Expected: PASS. Also run the full suite: `npm run test:unit` — expected PASS.

- [ ] **Step 5: Commit**

```bash
git add app/services/buckets/bucketsRepository.ts tests/unit/bucketsRepository.writes.spec.ts
git commit -m "feat: write path and combined mutations in buckets repository"
```

---

### Task 10: `useBucketsRepository()` composable and config

**Files:**
- Create: `app/composables/useBucketsRepository.ts`
- Modify: `nuxt.config.ts:37-51` (add `profileApiUrl` to `runtimeConfig.public`; do NOT remove the old keys yet — the papi plugin still reads them until Task 15)
- Modify: `new ProfileClient()` call sites to pass the configured URL: `app/pages/profile/index.vue:11`, `app/pages/profile/edit.vue:14`, `app/pages/messages/bucket/add-member/[id].vue:35`, `app/pages/messages/bucket/[id]/info.vue:59`, `app/pages/indexed-bucket/[id]/index.vue:76`

**Interfaces:**
- Consumes: `BucketsRepository` (+ options), `WalletExtensionProvider.signGraphqlRequest` (Task 2).
- Produces: `useBucketsRepository(): BucketsRepository` — the only way pages should construct the repository.

- [ ] **Step 1: Add config key**

In `nuxt.config.ts` `runtimeConfig.public`, add:

```ts
      profileApiUrl: process.env.NUXT_PUBLIC_PROFILE_API_URL || "https://profile-api.xcavate.io",
```

- [ ] **Step 2: Create the composable**

```ts
// app/composables/useBucketsRepository.ts
import { useRuntimeConfig } from "nuxt/app"
import { BucketsRepository } from "../services/buckets/bucketsRepository"
import { WalletExtensionProvider } from "../services/wallet/extensionProvider"

/**
 * Build the buckets repository from runtime config. Pages must use this
 * instead of constructing BucketsRepository (or wiring config) by hand.
 */
export function useBucketsRepository(): BucketsRepository {
  const config = useRuntimeConfig()
  const provider = new WalletExtensionProvider()

  return new BucketsRepository({
    apiUrl: String(config.public.profileApiUrl),
    pinataConfig: {
      jwt: String(config.public.pinataJwt || ""),
      apiKey: String(config.public.pinataApiKey || ""),
      apiSecret: String(config.public.pinataApiSecret || ""),
      publicGateway: String(config.public.pinataGateway || "")
    },
    sign: (address, rawBody) => provider.signGraphqlRequest(address, rawBody)
  })
}
```

- [ ] **Step 3: Point ProfileClient at the config URL**

In each of the five listed files, the construction site becomes (each file already calls `useRuntimeConfig()` or can add it next to its existing composable calls):

```ts
const runtimeConfig = useRuntimeConfig()
const profileClient = new ProfileClient(String(runtimeConfig.public.profileApiUrl))
```

(If the file already has a `runtimeConfig`/`config` variable, reuse it instead of adding a second one.)

- [ ] **Step 4: Typecheck and test**

Run: `npm run typecheck && npm run test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/composables/useBucketsRepository.ts nuxt.config.ts app/pages/profile/index.vue app/pages/profile/edit.vue "app/pages/messages/bucket/add-member/[id].vue" "app/pages/messages/bucket/[id]/info.vue" "app/pages/indexed-bucket/[id]/index.vue"
git commit -m "feat: useBucketsRepository composable and configurable profile API URL"
```

---

### Task 11: Migrate the namespace pages

**Files:**
- Modify: `app/pages/messages/index.vue` (direct `fetchIndexedNamespaces` at lines 2, 41)
- Modify: `app/pages/messages/namespaces/new.vue` (repo at 17, `createNamespace` at 80, `ExtrinsicUpdate` import/logger at 2, 50)
- Modify: `app/pages/messages/namespace/[namespaceId].vue` (repo at 23; `fetchIndexedBucketsByNamespace` 73, `fetchIndexedNamespaceById` 85, `fetchIndexedNamespaceManagers` 97, `removeNamespaceManager` 115)
- Modify: `app/pages/messages/namespace/managers/[namespaceId].vue` (repo at 19, `addNamespaceManager` 98)

**Interfaces:**
- Consumes: `useBucketsRepository()` (Task 10) and repository methods from Tasks 4–8. Field renames: `createdBlock` → `createdAt` (ISO string), `IndexedNamespace` → `ApiNamespace`, `IndexedBucketWithCounts` → `ApiBucketWithMembers` (counts = `admins.length` / `contributors.length`).

**Per-page swap recipe (applies to every page task):**
1. Delete imports of `DidCommRepository`, `ExtrinsicUpdate`, anything from `services/indexer/subqueryClient`, `services/chain/blockTime`, and `useRuntimeConfig`-derived `subqueryIndexerUrl`/`indexerUrl` plumbing.
2. Add `const bucketsRepository = useBucketsRepository()` (auto-imported composable) and type imports from `../../services/buckets/types` as needed.
3. Replace each call per the mapping table below.
4. Replace `ExtrinsicUpdate` handlers: the local logger becomes

```ts
import type { OperationUpdate } from "../../../services/buckets/types"

function logOperationUpdate(update: OperationUpdate): void {
  console.log(`[buckets] ${update.stage}: ${update.message}`)
}
```

and any UI keyed on `submitted/broadcast/inBlock/finalized` collapses to `pending`/`success`/`error`.

**Call mapping for this task:**

| Old | New |
|---|---|
| `fetchIndexedNamespaces(indexerUrl)` | `bucketsRepository.fetchNamespaces()` |
| `new DidCommRepository(...).createNamespace(name, owner, onUpdate)` | `bucketsRepository.createNamespace(name, owner, onUpdate)` (returns `MutationResult` — `result.method` exists; `result.txHash` does not, show `result.id` or drop) |
| `fetchIndexedNamespaceById(indexerUrl, id)` | `bucketsRepository.fetchNamespaceById(id)` |
| `fetchIndexedBucketsByNamespace(indexerUrl, id)` | `bucketsRepository.fetchBucketsByNamespace(id)`; `bucket.adminCount` → `bucket.admins.length`, `bucket.contributorCount` → `bucket.contributors.length`, `bucket.createdBlock` → `bucket.createdAt` |
| `fetchIndexedNamespaceManagers(indexerUrl, id)` (returns `{manager}` objects) | `bucketsRepository.fetchNamespaceManagers(id)` (returns `string[]` — adjust `.map((m) => m.manager)` call sites) |
| `repo.removeNamespaceManager(nsId, member, owner, onUpdate)` | same name/args on `bucketsRepository` |
| `repo.addNamespaceManager(nsId, member, owner, onUpdate)` | same name/args on `bucketsRepository` |

- [ ] **Step 1: Migrate `messages/index.vue`** per the recipe.
- [ ] **Step 2: Migrate `namespaces/new.vue`** per the recipe (drop the tx-hash display if present; show success notification from the `MutationResult`).
- [ ] **Step 3: Migrate `namespace/[namespaceId].vue`** per the recipe.
- [ ] **Step 4: Migrate `namespace/managers/[namespaceId].vue`** per the recipe.
- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS (these four files clean; other pages untouched and still on old imports — still compiling because nothing old was deleted yet).

- [ ] **Step 6: Smoke-test in dev**

Run: `npm run dev` — open `/messages`, confirm the namespace list loads from `profile-api.xcavate.io` (network tab shows `POST /graphql`, no indexer calls from this page).

- [ ] **Step 7: Commit**

```bash
git add app/pages/messages/index.vue app/pages/messages/namespaces/new.vue "app/pages/messages/namespace/[namespaceId].vue" "app/pages/messages/namespace/managers/[namespaceId].vue"
git commit -m "feat: namespace pages read/write via profile API"
```

---

### Task 12: Migrate bucket create, add-member, and info pages

**Files:**
- Modify: `app/pages/messages/bucket/create/[namespaceId].vue` (repo at 22; `fetchNamespaceManagers` 85, `createBucket` 128)
- Modify: `app/pages/messages/bucket/add-member/[id].vue` (repo at 36; `fetchBucket` 132, `addBucketMemberWithRole` 292)
- Modify: `app/pages/messages/bucket/[id]/info.vue` (repo at 31; `fetchMessages` 199, `fetchBucket` 436, `fetchBucketAdmins/Contributors/Viewers` 474-476, `removeBucketMemberRoles` 644, `rotateBucketKeyAndShare` 813, `createMessage` 1374)

**Interfaces:** same consumption as Task 11. Additional mappings:

| Old | New |
|---|---|
| `repo.fetchBucket(bucketId)` → `BucketRecord {id, name, namespaceId?, raw}` | `bucketsRepository.fetchBucket(bucketId)` → `ApiBucket \| null` — `record.raw.encryptionKey` becomes `bucket.encryptionKey`, `record.raw.isWritable` becomes `bucket.isWritable`; `name` may be null (`bucket.name ?? \`Bucket ${bucket.bucketId}\``) |
| `repo.fetchMessages(bucketId)` → `BucketMessage {id, bucketId?, summary, raw}` | `bucketsRepository.fetchMessages(bucketId)` → `ApiMessage[]` — `message.raw.ipfsContent` becomes `message.ipfsContent`, `raw.createdBlock` ordering becomes `createdAt` (already ascending) |
| `repo.fetchBucketAdmins/Contributors/Viewers(bucketId)` | same names on `bucketsRepository`, same `Promise<string[]>` |
| `repo.createBucket(nsId, name, owner, onUpdate, category)` | same signature |
| `repo.addBucketMemberWithRole(role, nsId, bucketId, ss58, x25519Key, owner, onUpdate)` | same signature |
| `repo.removeBucketMemberRoles(nsId, bucketId, member, roles, viewerKey, owner, onUpdate)` | same signature |
| `repo.rotateBucketKeyAndShare(nsId, bucketId, newKey, tag, message, owner, onUpdate)` | same signature |
| `repo.createMessage(bucketId, message, owner, onUpdate, tag, contentType)` | same signature |

- [ ] **Step 1: Migrate `bucket/create/[namespaceId].vue`** per the Task 11 recipe.
- [ ] **Step 2: Migrate `bucket/add-member/[id].vue`** per the recipe.
- [ ] **Step 3: Migrate `bucket/[id]/info.vue`** per the recipe (largest file — work call-site by call-site; the `raw` unwrapping disappears since `ApiBucket`/`ApiMessage` carry typed fields).
- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/pages/messages/bucket/create/[namespaceId].vue" "app/pages/messages/bucket/add-member/[id].vue" "app/pages/messages/bucket/[id]/info.vue"
git commit -m "feat: bucket admin pages via profile API"
```

---

### Task 13: Migrate the chat and files pages

**Files:**
- Modify: `app/pages/messages/bucket/[id]/index.vue` (repo at 28; `fetchMessages` 208, `fetchBucket` 489, `fetchBucketAdmins/Contributors` 510-511, `removeBucketAdmin` 698, `removeBucketContributor` 734, `rotateBucketKeyAndShare` 906, `createFileMessage` 1512, `createMessage` 1521)
- Modify: `app/pages/messages/bucket/[id]/files.vue` (`fetchIndexedMessagesByTag` 149, `fetchFileMessagesPage` 200)

**Interfaces:** mappings from Tasks 11–12 plus:

| Old | New |
|---|---|
| `fetchIndexedMessagesByTag(indexerUrl, bucketId, tag)` | `bucketsRepository.fetchMessagesByTag(bucketId, tag)` |
| `fetchFileMessagesPage(indexerUrl, bucketId, {first, after})` → `MessagePage` of `IndexedMessage` | `bucketsRepository.fetchFileMessagesPage(bucketId, {first, after})` → `MessagePage` of `ApiMessage` (same `{nodes, hasNextPage, endCursor}` shape; nodes now carry `createdAt` instead of `createdBlock`) |
| `isFileMessage` from `services/indexer/subqueryClient` | `isFileMessage` from `services/buckets/valueCodecs` (same behavior) |
| `repo.removeBucketAdmin/removeBucketContributor(nsId, bucketId, member, owner, onUpdate)` | same signatures |
| `repo.createFileMessage(bucketId, fileJwe, contentType, owner, onUpdate)` | same signature |

- [ ] **Step 1: Migrate `bucket/[id]/index.vue`** per the recipe. Message ordering/timestamps: wherever the page sorts or displays by `createdBlock`, use `Date.parse(message.createdAt)`.
- [ ] **Step 2: Migrate `bucket/[id]/files.vue`** per the recipe.
- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Smoke-test in dev**

Run: `npm run dev` — open a bucket chat, send a text message (wallet signs ONE GraphQL request), confirm it appears after reload; open Files tab, confirm paging works.

- [ ] **Step 5: Commit**

```bash
git add "app/pages/messages/bucket/[id]/index.vue" "app/pages/messages/bucket/[id]/files.vue"
git commit -m "feat: chat and files pages via profile API"
```

---

### Task 14: Migrate my-buckets and indexed-bucket pages

**Files:**
- Modify: `app/pages/messages/my-buckets.vue`
- Modify: `app/pages/indexed-bucket/[id]/index.vue` (NOTE: this file has uncommitted local modifications — rebase the migration onto its current working-tree state, do not revert them)

**Interfaces:** consumes `fetchMyBuckets`, `fetchLatestMessageTimes` (Tasks 6–7), plus prior mappings.

- [ ] **Step 1: Rewrite `my-buckets.vue` data loading**

Remove: the inline `MyBuckets` SubQuery query (lines 218–262), all `$papiClient` RPC timestamp code (`timestampStorageKey`, `parseU64FromHex`, `fetchTimestampForBlock`, `loadBlockTimestamps`, `blockTimestampByNumber`, lines 36–107), `resolveIndexerUrl` (109–116), and the `@polkadot/util`/`util-crypto` imports that only served them (`hexToU8a`, `u8aToHex`, `xxhashAsHex` — keep `decodeAddress`/`encodeAddress` for `resolveIndexerAddress`, and keep `base64url` for `resolveViewerKeyHex`).

Replace `loadBuckets` with cursor pagination:

```ts
const bucketsRepository = useBucketsRepository()
const endCursor = ref<string | null>(null)
const hasNextPage = ref(false)
const lastMessageAtByBucket = ref<Record<string, string>>({})

async function loadBuckets(reset = false): Promise<void> {
  error.value = ""
  if (!isWalletConnected.value || !session.accountAddress) {
    buckets.value = []
    totalCount.value = 0
    endCursor.value = null
    hasNextPage.value = false
    return
  }

  if (reset) {
    endCursor.value = null
    loading.value = true
  } else {
    loadingMore.value = true
  }

  try {
    const page = await bucketsRepository.fetchMyBuckets(
      resolveIndexerAddress(session.accountAddress),
      resolveViewerKeyHex(),
      { first: pageSize, after: reset ? null : endCursor.value }
    )

    totalCount.value = page.totalCount
    hasNextPage.value = page.hasNextPage
    endCursor.value = page.endCursor
    buckets.value = reset ? page.nodes : [...buckets.value, ...page.nodes]

    const times = await bucketsRepository.fetchLatestMessageTimes(page.nodes.map((b) => b.bucketId))
    lastMessageAtByBucket.value = { ...lastMessageAtByBucket.value, ...times }
  } catch (fetchError) {
    error.value = fetchError instanceof Error ? fetchError.message : "Unable to load buckets"
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}
```

`hasMoreData` becomes `computed(() => hasNextPage.value)`; the intersection observer and watchers call `loadBuckets(false)` / `loadBuckets(true)` accordingly. `formatLastMessage(bucket)` reads `lastMessageAtByBucket.value[bucket.bucketId]` (ISO string → `timeAgo(Date.parse(iso))`, "No messages yet" when absent). The local `BucketConnectionNode` interface is replaced by `MyBucketSummary` from `../../services/buckets/types`.

- [ ] **Step 2: Migrate `indexed-bucket/[id]/index.vue`**

Per the Task 11 recipe plus:
- `fetchIndexedBucketDetail(indexerUrl, id)` → `bucketsRepository.fetchBucketDetail(id)` (admins/contributors/viewers are now `string[]`, not `{subjectId}` objects — adjust `.map((a) => a.subjectId)` call sites; messages carry `createdAt`).
- `fetchIndexedMessages` / `fetchIndexedMessagesByTag` / `fetchIndexedNamespaceManagers` → same-named repository methods per earlier mappings.
- All `blockTime` usages (lines 12, 129, 219, 253, 258, 299): the block→time estimation is replaced by `message.createdAt` directly.
- `onExtrinsicUpdate` (lines 756–761): replace with

```ts
const onOperationUpdate = (update: OperationUpdate): void => {
  logOperationUpdate(update)
  if (update.stage === "error") updatePendingStatus(pending.id, "failed")
}
```

and after the awaited `createMessage`/`createFileMessage` resolves, advance the pending item straight to its delivered/indexed state (the API is synchronous — on success the message is already readable).

- [ ] **Step 3: Typecheck + full unit tests**

Run: `npm run typecheck && npm run test:unit`
Expected: PASS.

- [ ] **Step 4: Smoke-test in dev**

`/messages/my-buckets` lists buckets with relative times; an indexed-bucket chat loads, sends, and shows real timestamps.

- [ ] **Step 5: Commit**

```bash
git add app/pages/messages/my-buckets.vue "app/pages/indexed-bucket/[id]/index.vue"
git commit -m "feat: my-buckets and indexed-bucket pages via profile API"
```

---

### Task 15: Delete the chain/indexer layer and finish

**Files:**
- Delete: `app/services/papi/didCommRepository.ts`, `app/services/papi/client.ts`, `app/services/indexer/subqueryClient.ts`, `app/services/chain/blockTime.ts`, `app/plugins/papi.client.ts`
- Delete tests: `tests/unit/subqueryClient.spec.ts`, `tests/unit/blockTime.spec.ts`, `tests/integration/didCommRepository.spec.ts`
- Modify: `nuxt.config.ts` (remove `xcavateWsEndpoint` and `subqueryIndexerUrl` from `runtimeConfig.public`)
- Modify: `package.json` (remove `@polkadot/api`, `@polkadot-api/client`; keep `@polkadot/extension-dapp`, `@polkadot/util-crypto`, `@polkadot/util`)

- [ ] **Step 1: Verify nothing still imports the doomed modules**

```bash
grep -rn --include="*.ts" --include="*.vue" -E "papi/didCommRepository|papi/client|indexer/subqueryClient|chain/blockTime|\\\$papiClient|xcavateWsEndpoint|subqueryIndexerUrl" app/ tests/
```

Expected: matches only inside the files being deleted in this task. If a page still matches, finish its migration first (per the recipes in Tasks 11–14).

- [ ] **Step 2: Check `@polkadot/keyring` and remaining `@polkadot/api` usage before removal**

```bash
grep -rn --include="*.ts" --include="*.vue" -E "@polkadot/(api|keyring)|@polkadot-api" app/ tests/
```

Remove from `package.json` only the packages with zero remaining references (expected: `@polkadot/api`, `@polkadot-api/client`; remove `@polkadot/keyring` too if unreferenced).

- [ ] **Step 3: Delete the files and config keys, uninstall**

```bash
git rm app/services/papi/didCommRepository.ts app/services/papi/client.ts app/services/indexer/subqueryClient.ts app/services/chain/blockTime.ts app/plugins/papi.client.ts tests/unit/subqueryClient.spec.ts tests/unit/blockTime.spec.ts tests/integration/didCommRepository.spec.ts
npm uninstall @polkadot/api @polkadot-api/client
```

Edit `nuxt.config.ts` to drop `xcavateWsEndpoint` and `subqueryIndexerUrl`. Also delete the `types/nuxt.d.ts` `$papiClient` declaration if present (check `app/types/nuxt.d.ts`).

- [ ] **Step 4: Full verification**

```bash
npm run typecheck
npm run test
npm run generate
```

Expected: all PASS; the generated bundle contains no `@polkadot/api` chunks.

- [ ] **Step 5: Manual end-to-end smoke against the live API**

With a funded/known wallet account in dev (`npm run dev`):
1. Create a namespace → appears in `/messages`.
2. Create a bucket in it → appears in the namespace view.
3. Send a text message → one wallet signature popup; message visible after reload; Pinata upload observable in the network tab; `ipfsContent` populated (check the message via the API).
4. Add a member with a role (uses a combined document, single popup).
5. Rotate the bucket key (combined `rotateKey` + `write`, single popup).
If step 3+ fails with 401: verify the failing request's `X-Timestamp` has 7 fractional digits and the body hash is `0x`+UPPERCASE — the golden-vector suite (`npx vitest run tests/unit/profileSigning.spec.ts`) must still pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat!: remove Substrate chain and SubQuery indexer layers

The XcavateProfile GraphQL API is now the only backend for namespaces,
buckets, messages, and membership."
```

---

## Plan Self-Review (completed)

- **Spec coverage:** architecture/module layout → Tasks 1–4, 10; signing → Task 2; read mapping → Tasks 4–7; write mapping incl. combined documents → Tasks 8–9; status lifecycle → types in Task 4, page handlers in Tasks 11–14; config → Tasks 10, 15; deletions → Task 15; page migration list → Tasks 11–14 cover all 11 files from the spec; testing (unit + smoke) → per-task tests, Task 15 step 5. The env-gated live integration test from the spec is intentionally satisfied by Task 15's manual smoke checklist instead of an automated test — automating a signed mutation needs a private key in CI, which the spec ruled out of scope.
- **Placeholder scan:** the only "port verbatim" steps (Task 3) point at exact grep-able source locations with reference shapes and tests — no TBDs.
- **Type consistency:** `MutationResult {id, method}`, `OperationUpdate {stage, message}`, `ApiMessage.bucketId` flattening, `Long`-as-number vs `BigInt`-as-string are used consistently across Tasks 4–14.

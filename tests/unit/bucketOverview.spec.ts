// tests/unit/bucketOverview.spec.ts
import { describe, expect, it } from "vitest"
import { buildBucketOverviewFacts, type BucketFact } from "../../app/services/buckets/bucketOverview"
import type { ApiBucket } from "../../app/services/buckets/types"

const bucket = (overrides: Partial<ApiBucket> = {}): ApiBucket => ({
  id: "1",
  bucketId: "6",
  namespaceId: "2",
  creator: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
  name: "Design team",
  category: "work",
  isWritable: true,
  encryptionKey: "0xabc123",
  createdAt: "2026-08-12T09:14:00.000Z",
  updatedAt: "2026-08-20T09:14:00.000Z",
  ...overrides
})

// Deterministic stand-ins for the locale-dependent defaults, so the assertions
// below test the mapping rather than the host's Intl output.
const formatters = {
  formatAbsolute: (iso: string) => `ABS(${iso})`,
  formatRelative: (timestamp: number, now: number) => `REL(${now - timestamp})`
}

function factFor(facts: BucketFact[], key: BucketFact["key"]): BucketFact {
  const match = facts.find((fact) => fact.key === key)
  if (!match) {
    throw new Error(`No "${key}" fact in [${facts.map((fact) => fact.key).join(", ")}]`)
  }

  return match
}

describe("buildBucketOverviewFacts", () => {
  it("returns nothing when the bucket has not loaded", () => {
    expect(buildBucketOverviewFacts(null)).toEqual([])
  })

  it("emits the six friendly facts in a stable order", () => {
    const facts = buildBucketOverviewFacts(bucket(), formatters)
    expect(facts.map((fact) => fact.key)).toEqual([
      "creator", "category", "access", "encryption", "created", "updated"
    ])
  })

  it("never surfaces the raw record fields the technical block owns", () => {
    const values = buildBucketOverviewFacts(bucket(), formatters).map((fact) => fact.value)
    expect(values).not.toContain("0xabc123")
    // The bucket name is already the page title, so it is not repeated as a fact.
    expect(values).not.toContain("Design team")
  })

  describe("created by", () => {
    it("shows the supplied display name", () => {
      const fact = factFor(buildBucketOverviewFacts(bucket(), { ...formatters, creatorName: "Alice" }), "creator")
      expect(fact).toMatchObject({ label: "Created by", value: "Alice", tone: "default" })
    })

    it("falls back to Unknown when no name resolves", () => {
      const fact = factFor(buildBucketOverviewFacts(bucket(), formatters), "creator")
      expect(fact).toMatchObject({ value: "Unknown", tone: "muted" })
    })

    it("treats a blank name and a creatorless bucket alike", () => {
      const blank = factFor(buildBucketOverviewFacts(bucket(), { ...formatters, creatorName: "   " }), "creator")
      const missing = factFor(buildBucketOverviewFacts(bucket({ creator: null }), formatters), "creator")
      expect(blank.value).toBe("Unknown")
      expect(missing.value).toBe("Unknown")
    })
  })

  describe("category", () => {
    it("shows the trimmed category", () => {
      const fact = factFor(buildBucketOverviewFacts(bucket({ category: "  work  " }), formatters), "category")
      expect(fact).toMatchObject({ label: "Category", value: "work", tone: "default" })
    })

    it.each(["", "   ", "0x", null])("reads %o as None", (category) => {
      const fact = factFor(buildBucketOverviewFacts(bucket({ category }), formatters), "category")
      expect(fact).toMatchObject({ value: "None", tone: "muted" })
    })
  })

  describe("access", () => {
    it("says the bucket accepts messages when writable", () => {
      const fact = factFor(buildBucketOverviewFacts(bucket({ isWritable: true }), formatters), "access")
      expect(fact).toMatchObject({ label: "Access", value: "Accepting messages", tone: "default" })
    })

    it("says the bucket is closed when not writable", () => {
      const fact = factFor(buildBucketOverviewFacts(bucket({ isWritable: false }), formatters), "access")
      expect(fact).toMatchObject({ value: "Closed to new messages", tone: "muted" })
    })
  })

  describe("encryption", () => {
    it("reports end-to-end encryption once a key is set", () => {
      const fact = factFor(buildBucketOverviewFacts(bucket(), formatters), "encryption")
      expect(fact).toMatchObject({ label: "Encryption", value: "End-to-end encrypted", tone: "default" })
    })

    it.each(["", "   ", "0x", null])("reads %o as no key shared yet", (encryptionKey) => {
      const fact = factFor(buildBucketOverviewFacts(bucket({ encryptionKey }), formatters), "encryption")
      expect(fact).toMatchObject({ value: "No key shared yet", tone: "muted" })
    })
  })

  describe("timestamps", () => {
    it("formats the creation date absolutely", () => {
      const fact = factFor(buildBucketOverviewFacts(bucket(), formatters), "created")
      expect(fact).toMatchObject({ label: "Created", value: "ABS(2026-08-12T09:14:00.000Z)", tone: "default" })
    })

    it("formats the update date relative to the supplied clock", () => {
      const now = Date.parse("2026-08-20T09:14:05.000Z")
      const fact = factFor(buildBucketOverviewFacts(bucket(), { ...formatters, now }), "updated")
      expect(fact).toMatchObject({ label: "Last updated", value: "REL(5000)", tone: "default" })
    })

    it("echoes an unparseable timestamp rather than showing Invalid Date", () => {
      const facts = buildBucketOverviewFacts(bucket({ createdAt: "not-a-date", updatedAt: "also-bad" }), formatters)
      expect(factFor(facts, "created").value).toBe("not-a-date")
      expect(factFor(facts, "updated").value).toBe("also-bad")
    })

    it("falls back to Unknown when a timestamp is absent", () => {
      const facts = buildBucketOverviewFacts(bucket({ createdAt: "", updatedAt: "  " }), formatters)
      expect(factFor(facts, "created")).toMatchObject({ value: "Unknown", tone: "muted" })
      expect(factFor(facts, "updated")).toMatchObject({ value: "Unknown", tone: "muted" })
    })
  })
})

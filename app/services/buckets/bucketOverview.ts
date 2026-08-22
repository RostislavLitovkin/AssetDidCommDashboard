import { timeAgo } from "../format/relativeTime"
import type { ApiBucket } from "./types"

/** Which of the six rows a fact is — doubles as the icon key and the v-for key. */
export type BucketFactKey = "creator" | "category" | "access" | "encryption" | "created" | "updated"

/** `muted` marks an absent or negative value ("None", "Read-only"), so the row
 *  reads as a gap rather than as a setting someone chose. */
export type BucketFactTone = "default" | "muted"

export interface BucketFact {
  key: BucketFactKey
  label: string
  value: string
  tone: BucketFactTone
}

export interface BucketOverviewOptions {
  /** Display name for the creator — a profile nickname, else a formatted address. */
  creatorName?: string
  /** Reference point for the relative "Last updated" value. */
  now?: number
  /** Seams for the locale-dependent defaults, so the mapping stays testable. */
  formatAbsolute?: (iso: string) => string
  formatRelative?: (timestamp: number, now: number) => string
}

/** Chain-encoded empty bytes arrive as the bare `0x` prefix, which is not a value. */
function presentText(value: string | null | undefined): string | undefined {
  const trimmed = (value ?? "").trim()
  return trimmed && trimmed !== "0x" ? trimmed : undefined
}

export function formatBucketTimestamp(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit"
  })
}

/** A timestamp row: the formatted date, the raw string when it will not parse
 *  (better than showing "Invalid Date"), or a muted gap when there is none. */
function timestampFact(
  key: BucketFactKey,
  label: string,
  iso: string | null | undefined,
  format: (timestamp: number, raw: string) => string
): BucketFact {
  const raw = (iso ?? "").trim()
  if (!raw) {
    return { key, label, value: "Unknown", tone: "muted" }
  }

  const parsed = Date.parse(raw)
  if (Number.isNaN(parsed)) {
    return { key, label, value: raw, tone: "default" }
  }

  return { key, label, value: format(parsed, raw), tone: "default" }
}

/** Turns the raw bucket record into the plain-language rows the About card shows.
 *  Everything technical (ids, the encryption key itself, raw ISO timestamps) is
 *  deliberately left out — the debug-only block renders those straight from the
 *  record instead. The bucket name is omitted too: it is already the page title. */
export function buildBucketOverviewFacts(
  bucket: ApiBucket | null,
  options: BucketOverviewOptions = {}
): BucketFact[] {
  if (!bucket) {
    return []
  }

  const {
    creatorName,
    now = Date.now(),
    formatAbsolute = formatBucketTimestamp,
    formatRelative = timeAgo
  } = options

  const creator = presentText(creatorName)
  const category = presentText(bucket.category)
  const encrypted = Boolean(presentText(bucket.encryptionKey))

  return [
    {
      key: "creator",
      label: "Created by",
      value: creator ?? "Unknown",
      tone: creator ? "default" : "muted"
    },
    {
      key: "category",
      label: "Category",
      value: category ?? "None",
      tone: category ? "default" : "muted"
    },
    {
      key: "access",
      label: "Access",
      value: bucket.isWritable ? "Accepting messages" : "Closed to new messages",
      tone: bucket.isWritable ? "default" : "muted"
    },
    {
      key: "encryption",
      label: "Encryption",
      value: encrypted ? "End-to-end encrypted" : "No key shared yet",
      tone: encrypted ? "default" : "muted"
    },
    timestampFact("created", "Created", bucket.createdAt, (_, raw) => formatAbsolute(raw)),
    timestampFact("updated", "Last updated", bucket.updatedAt, (parsed) => formatRelative(parsed, now))
  ]
}

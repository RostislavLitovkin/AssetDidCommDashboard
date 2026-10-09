import type { ApiMessage } from "./types";

/** Message tags used by the property-governance voting layer. */
export const VOTING_TERMS_TAG = "voting/terms";
export const VOTING_ELECTION_TAG = "voting/election";
export const VOTING_PROPOSAL_TAG = "voting/proposal";
export const VOTING_CHALLENGE_TAG = "voting/challenge";
export const VOTING_RESULT_TAG = "voting/result";

/** All tags that carry governance-voting state for a bucket. */
export const VOTING_TAGS: readonly string[] = [
  VOTING_TERMS_TAG,
  VOTING_ELECTION_TAG,
  VOTING_PROPOSAL_TAG,
  VOTING_CHALLENGE_TAG,
  VOTING_RESULT_TAG,
];

/** Tags that open (or update) a vote — the result tag closes one. */
export const VOTING_OPEN_TAGS: readonly string[] = [
  VOTING_TERMS_TAG,
  VOTING_ELECTION_TAG,
  VOTING_PROPOSAL_TAG,
  VOTING_CHALLENGE_TAG,
];

const votingTagSet: ReadonlySet<string> = new Set(VOTING_TAGS);

/** Type-safe check for any governance-voting tag. */
export function isVotingTag(tag: string | null | undefined): boolean {
  return tag !== null && tag !== undefined && votingTagSet.has(tag);
}

/** The governance lanes a vote can live on. */
export type VotingKind = "terms" | "election" | "proposal" | "challenge";

const VOTING_KINDS: readonly string[] = ["terms", "election", "proposal", "challenge"];

/** Terminal outcomes a result message can carry, shared across kinds. */
export type VotingResultStatus = "ratified" | "rejected" | "passed" | "failed";

const VOTING_RESULT_STATUSES: readonly string[] = ["ratified", "rejected", "passed", "failed"];

/** An open (or refreshed) vote announcement posted by the API system identity. */
export interface VotingOpenPayload {
  kind: VotingKind;
  /** Marketplace listing id this vote belongs to (== the property's asset id). */
  listingId: string;
  /** Proposal / challenge id, when the kind has one. */
  id?: string;
  /** Terms round or election round (1-based). */
  round?: number;
  /** Terms vote: hash of the documents under ratification. */
  documentsHash?: string;
  /** ISO-8601 voting deadline. */
  expiresAt: string;
  quorumBps?: number;
  thresholdBps?: number;
  status: "open";
}

/** A finalized vote outcome for one lane. */
export interface VotingResultPayload {
  kind: VotingKind;
  listingId: string;
  id?: string;
  round?: number;
  status: VotingResultStatus;
  yes?: number;
  no?: number;
  abstain?: number;
}

export type VotingPayload = VotingOpenPayload | VotingResultPayload;

/** Encodes a voting payload as the message body (JWE-encrypted upstream, or plaintext). */
export function buildVotingPayload(payload: VotingPayload): string {
  return JSON.stringify(payload);
}

function asIdString(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "string" && value.trim() !== "") {
    return value.trim();
  }
  return undefined;
}

function asRound(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function asBps(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 10_000
    ? value
    : undefined;
}

function asPower(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function parseCommon(candidate: Record<string, unknown>): { kind: VotingKind; listingId: string } | undefined {
  const kind = candidate.kind;
  if (typeof kind !== "string" || !VOTING_KINDS.includes(kind)) {
    return undefined;
  }
  const listingId = asIdString(candidate.listingId);
  if (!listingId) {
    return undefined;
  }
  return { kind: kind as VotingKind, listingId };
}

function parseOptionals(candidate: Record<string, unknown>): Pick<VotingOpenPayload, "id" | "round" | "documentsHash" | "quorumBps" | "thresholdBps"> {
  const out: Pick<VotingOpenPayload, "id" | "round" | "documentsHash" | "quorumBps" | "thresholdBps"> = {};
  const id = asIdString(candidate.id);
  if (id !== undefined) out.id = id;
  const round = asRound(candidate.round);
  if (round !== undefined) out.round = round;
  const documentsHash = asNonEmptyString(candidate.documentsHash);
  if (documentsHash !== undefined) out.documentsHash = documentsHash;
  const quorumBps = asBps(candidate.quorumBps);
  if (quorumBps !== undefined) out.quorumBps = quorumBps;
  const thresholdBps = asBps(candidate.thresholdBps);
  if (thresholdBps !== undefined) out.thresholdBps = thresholdBps;
  return out;
}

/** Decodes and strictly validates a voting payload; returns undefined when unreadable. */
export function parseVotingPayload(body: string | null | undefined): VotingPayload | undefined {
  if (typeof body !== "string" || body.trim() === "") {
    return undefined;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return undefined;
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }

  const candidate = raw as Record<string, unknown>;
  const common = parseCommon(candidate);
  if (!common) {
    return undefined;
  }

  if (candidate.status === "open") {
    // An open vote without a usable deadline can never display meaningfully.
    const expiresAt = candidate.expiresAt;
    if (typeof expiresAt !== "string" || expiresAt.trim() === "" || Number.isNaN(Date.parse(expiresAt))) {
      return undefined;
    }
    return { ...common, ...parseOptionals(candidate), expiresAt: expiresAt.trim(), status: "open" };
  }

  if (typeof candidate.status === "string" && VOTING_RESULT_STATUSES.includes(candidate.status)) {
    const result: VotingResultPayload = {
      ...common,
      status: candidate.status as VotingResultStatus,
    };
    const id = asIdString(candidate.id);
    if (id !== undefined) result.id = id;
    const round = asRound(candidate.round);
    if (round !== undefined) result.round = round;
    const yes = asPower(candidate.yes);
    if (yes !== undefined) result.yes = yes;
    const no = asPower(candidate.no);
    if (no !== undefined) result.no = no;
    const abstain = asPower(candidate.abstain);
    if (abstain !== undefined) result.abstain = abstain;
    return result;
  }

  return undefined;
}

/** A decoded voting message paired with the ApiMessage it belongs to. */
export interface VotingMessageEntry {
  message: ApiMessage;
  payload: VotingPayload;
}

/** One lane's currently open vote: the message plus its validated payload. */
export interface ActiveVote {
  message: ApiMessage;
  payload: VotingOpenPayload;
}

/**
 * Identity of a vote instance within a lane: proposals and challenges key on
 * their id, terms votes and elections on their round. Open and result
 * messages for the same instance produce the same key.
 */
export function voteKey(payload: VotingPayload): string {
  return `${payload.kind}:${payload.id ?? ""}:${payload.round ?? ""}`;
}

function votingSortValue(message: ApiMessage): [number, number] {
  const time = Date.parse(message.createdAt);
  const id = Number(message.messageId);
  return [Number.isNaN(time) ? 0 : time, Number.isFinite(id) ? id : 0];
}

function votingSortComparator(a: ApiMessage, b: ApiMessage): number {
  const keyA = votingSortValue(a);
  const keyB = votingSortValue(b);
  return keyA[0] - keyB[0] || keyA[1] - keyB[1];
}

/**
 * Reduces the decoded voting messages to each lane's active vote. The newest
 * open message per kind wins; a result whose key matches the active open
 * message closes it. A result for an unknown or already-closed instance is a
 * no-op, and unreadable payloads never reach the reducer.
 */
export function deriveActiveVote(entries: readonly VotingMessageEntry[]): Partial<Record<VotingKind, ActiveVote>> {
  const active: Partial<Record<VotingKind, ActiveVote>> = {};

  const sorted = [...entries].sort((a, b) => votingSortComparator(a.message, b.message));
  for (const { message, payload } of sorted) {
    if (payload.status === "open") {
      active[payload.kind] = { message, payload };
      continue;
    }
    const current = active[payload.kind];
    if (current && voteKey(current.payload) === voteKey(payload)) {
      delete active[payload.kind];
    }
  }

  return active;
}

/** The last tallies a result message reported for one vote instance. */
export interface VoteTally {
  yes?: number;
  no?: number;
  abstain?: number;
}

/**
 * Collects the newest result tallies per vote instance, keyed by voteKey.
 * Open votes carry no tallies — those come from the indexer instead.
 */
export function deriveVoteTallies(entries: readonly VotingMessageEntry[]): Map<string, VoteTally> {
  const tallies = new Map<string, VoteTally>();

  const sorted = [...entries].sort((a, b) => votingSortComparator(a.message, b.message));
  for (const { payload } of sorted) {
    if (payload.status === "open") {
      continue;
    }
    const tally: VoteTally = {};
    if (payload.yes !== undefined) tally.yes = payload.yes;
    if (payload.no !== undefined) tally.no = payload.no;
    if (payload.abstain !== undefined) tally.abstain = payload.abstain;
    tallies.set(voteKey(payload), tally);
  }

  return tallies;
}

/** Human title for a voting lane, used on chat cards and the action bar. */
export function votingKindLabel(kind: VotingKind): string {
  switch (kind) {
    case "terms":
      return "SPV lawyer election";
    case "election":
      return "Letting-agent election";
    case "proposal":
      return "Agent spending proposal";
    case "challenge":
      return "Agent challenge";
  }
}

/** Human label for a vote status (open or any terminal outcome). */
export function votingStatusLabel(status: "open" | VotingResultStatus): string {
  switch (status) {
    case "open":
      return "Open";
    case "ratified":
      return "Ratified";
    case "rejected":
      return "Rejected";
    case "passed":
      return "Passed";
    case "failed":
      return "Failed";
  }
}

/**
 * Yes/no split of a tally as whole percentages of the non-abstain votes.
 * Undefined while either side is unknown or nobody voted.
 */
export function votingPercentages(yes: number | undefined, no: number | undefined): { yesPct: number; noPct: number } | undefined {
  if (yes === undefined || no === undefined) {
    return undefined;
  }
  const total = yes + no;
  if (total <= 0) {
    return undefined;
  }
  const yesPct = Math.round((yes / total) * 100);
  return { yesPct, noPct: 100 - yesPct };
}

/** The bar labels per lane: elections show turnout, the rest yes/no. */
export function votingSideLabels(kind: VotingKind): { yes: string; no: string } {
  return kind === "terms" ? { yes: "Approve", no: "Not voted" } : { yes: "Yes", no: "No" };
}

/**
 * Extracts the marketplace listing id a namespace was annotated with. The API
 * stores namespace properties as a JSON string; a realXmarket property
 * namespace carries `propertyId` (== listing id == asset id).
 */
export function parseNamespacePropertyId(properties: string | null | undefined): string | undefined {
  if (typeof properties !== "string" || properties.trim() === "") {
    return undefined;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(properties);
  } catch {
    return undefined;
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }

  return asIdString((raw as Record<string, unknown>).propertyId);
}

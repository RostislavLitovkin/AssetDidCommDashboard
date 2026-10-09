import { describe, expect, it } from "vitest";
import type { ApiMessage } from "../../app/services/buckets/types";
import {
  VOTING_CHALLENGE_TAG,
  VOTING_ELECTION_TAG,
  VOTING_PROPOSAL_TAG,
  VOTING_RESULT_TAG,
  VOTING_TAGS,
  VOTING_TERMS_TAG,
  buildVotingPayload,
  deriveActiveVote,
  deriveVoteTallies,
  isVotingTag,
  parseNamespacePropertyId,
  parseVotingPayload,
  voteKey,
  votingKindLabel,
  votingPercentages,
  votingSideLabels,
  votingStatusLabel,
  type VotingMessageEntry,
  type VotingOpenPayload,
  type VotingResultPayload,
} from "../../app/services/buckets/voting";

let messageSeq = 0;

function makeMessage(overrides: Partial<ApiMessage> = {}): ApiMessage {
  messageSeq += 1;
  return {
    id: `msg-${messageSeq}`,
    messageId: String(messageSeq),
    bucketId: "bucket-1",
    contributor: "system",
    reference: null,
    tag: null,
    description: null,
    contentType: "application/json",
    contentHash: null,
    ipfsContent: null,
    createdAt: new Date(Date.UTC(2026, 8, 1, 12, 0, messageSeq)).toISOString(),
    ...overrides,
  };
}

const termsOpen: VotingOpenPayload = {
  kind: "terms",
  listingId: "42",
  round: 1,
  documentsHash: "ab".repeat(32),
  expiresAt: "2026-10-10T12:00:00.000Z",
  quorumBps: 2000,
  status: "open",
};

const proposalOpen: VotingOpenPayload = {
  kind: "proposal",
  listingId: "42",
  id: "7",
  expiresAt: "2026-10-12T12:00:00.000Z",
  quorumBps: 1500,
  thresholdBps: 5000,
  status: "open",
};

describe("voting tag constants", () => {
  it("exposes the five voting tags", () => {
    expect(VOTING_TERMS_TAG).toBe("voting/terms");
    expect(VOTING_ELECTION_TAG).toBe("voting/election");
    expect(VOTING_PROPOSAL_TAG).toBe("voting/proposal");
    expect(VOTING_CHALLENGE_TAG).toBe("voting/challenge");
    expect(VOTING_RESULT_TAG).toBe("voting/result");
    expect(VOTING_TAGS).toHaveLength(5);
  });
});

describe("isVotingTag", () => {
  it("recognises every voting tag", () => {
    for (const tag of VOTING_TAGS) {
      expect(isVotingTag(tag)).toBe(true);
    }
  });

  it("rejects other tags and empty values", () => {
    expect(isVotingTag("realXhub/offer")).toBe(false);
    expect(isVotingTag("voting/unknown")).toBe(false);
    expect(isVotingTag("")).toBe(false);
    expect(isVotingTag(null)).toBe(false);
    expect(isVotingTag(undefined)).toBe(false);
  });
});

describe("voting payload codec", () => {
  it("round-trips a terms open payload", () => {
    expect(parseVotingPayload(buildVotingPayload(termsOpen))).toEqual(termsOpen);
  });

  it("round-trips a proposal open payload with threshold", () => {
    expect(parseVotingPayload(buildVotingPayload(proposalOpen))).toEqual(proposalOpen);
  });

  it("round-trips a result payload with tallies", () => {
    const result: VotingResultPayload = {
      kind: "terms",
      listingId: "42",
      round: 1,
      status: "ratified",
      yes: 800,
      no: 200,
    };
    expect(parseVotingPayload(buildVotingPayload(result))).toEqual(result);
  });

  it("round-trips a challenge result with an abstain count", () => {
    const result: VotingResultPayload = {
      kind: "challenge",
      listingId: "42",
      id: "3",
      status: "failed",
      yes: 10,
      no: 90,
      abstain: 5,
    };
    expect(parseVotingPayload(buildVotingPayload(result))).toEqual(result);
  });

  it("accepts numeric listingId and id, normalizing them to strings", () => {
    expect(parseVotingPayload(JSON.stringify({ ...termsOpen, listingId: 42 }))).toEqual(termsOpen);
    const parsed = parseVotingPayload(JSON.stringify({ ...proposalOpen, id: 7 }));
    expect(parsed).toEqual(proposalOpen);
  });

  it("drops malformed optional fields instead of rejecting the payload", () => {
    const parsed = parseVotingPayload(JSON.stringify({ ...termsOpen, round: 1.5, quorumBps: 20_000 }));
    expect(parsed).toEqual({ ...termsOpen, round: undefined, quorumBps: undefined });
  });

  it("rejects malformed JSON and non-object bodies", () => {
    expect(parseVotingPayload("{ not json")).toBeUndefined();
    expect(parseVotingPayload("")).toBeUndefined();
    expect(parseVotingPayload(undefined)).toBeUndefined();
    expect(parseVotingPayload(JSON.stringify(["terms"]))).toBeUndefined();
    expect(parseVotingPayload(JSON.stringify("terms"))).toBeUndefined();
  });

  it("rejects unknown kinds and statuses", () => {
    expect(parseVotingPayload(JSON.stringify({ ...termsOpen, kind: "payment" }))).toBeUndefined();
    expect(parseVotingPayload(JSON.stringify({ kind: "terms", listingId: "42", status: "closed" }))).toBeUndefined();
  });

  it("rejects payloads without a listing id", () => {
    expect(parseVotingPayload(JSON.stringify({ kind: "terms", status: "open", expiresAt: termsOpen.expiresAt }))).toBeUndefined();
    expect(parseVotingPayload(JSON.stringify({ ...termsOpen, listingId: "  " }))).toBeUndefined();
  });

  it("rejects open payloads with a missing or unparseable expiry", () => {
    expect(parseVotingPayload(JSON.stringify({ kind: "terms", listingId: "42", status: "open" }))).toBeUndefined();
    expect(parseVotingPayload(JSON.stringify({ ...termsOpen, expiresAt: "soon" }))).toBeUndefined();
    expect(parseVotingPayload(JSON.stringify({ ...termsOpen, expiresAt: 123 }))).toBeUndefined();
  });

  it("rejects negative tallies on results", () => {
    const parsed = parseVotingPayload(
      JSON.stringify({ kind: "terms", listingId: "42", status: "ratified", yes: -1, no: 5 }),
    );
    expect(parsed).toEqual({ kind: "terms", listingId: "42", status: "ratified", no: 5 });
  });
});

describe("voteKey", () => {
  it("keys proposals by kind and id", () => {
    expect(voteKey(proposalOpen)).toBe("proposal:7:");
  });

  it("keys terms votes by kind and round", () => {
    expect(voteKey(termsOpen)).toBe("terms::1");
  });

  it("gives different rounds different keys", () => {
    expect(voteKey(termsOpen)).not.toBe(voteKey({ ...termsOpen, round: 2 }));
  });
});

describe("active vote state machine", () => {
  function entry(tag: string, payload: VotingOpenPayload | VotingResultPayload, id: string, createdAt?: string): VotingMessageEntry {
    return { message: makeMessage({ tag, messageId: id, ...(createdAt ? { createdAt } : {}) }), payload };
  }

  it("keeps an open terms vote active on its own", () => {
    const active = deriveActiveVote([entry(VOTING_TERMS_TAG, termsOpen, "1")]);
    expect(active.terms?.payload.round).toBe(1);
    expect(active.proposal).toBeUndefined();
  });

  it("tracks lanes independently", () => {
    const active = deriveActiveVote([
      entry(VOTING_TERMS_TAG, termsOpen, "1"),
      entry(VOTING_PROPOSAL_TAG, proposalOpen, "2"),
    ]);
    expect(active.terms?.payload.round).toBe(1);
    expect(active.proposal?.payload.id).toBe("7");
  });

  it("closes the terms vote when its matching result lands", () => {
    const result: VotingResultPayload = { kind: "terms", listingId: "42", round: 1, status: "ratified", yes: 9, no: 1 };
    const active = deriveActiveVote([
      entry(VOTING_TERMS_TAG, termsOpen, "1"),
      entry(VOTING_RESULT_TAG, result, "2"),
    ]);
    expect(active.terms).toBeUndefined();
  });

  it("ignores a result for a different round", () => {
    const stale: VotingResultPayload = { kind: "terms", listingId: "42", round: 9, status: "rejected" };
    const active = deriveActiveVote([
      entry(VOTING_TERMS_TAG, termsOpen, "1"),
      entry(VOTING_RESULT_TAG, stale, "2"),
    ]);
    expect(active.terms?.payload.round).toBe(1);
  });

  it("reopens on a newer round after a result", () => {
    const round1Result: VotingResultPayload = { kind: "terms", listingId: "42", round: 1, status: "rejected" };
    const round2: VotingOpenPayload = { ...termsOpen, round: 2 };
    const active = deriveActiveVote([
      entry(VOTING_TERMS_TAG, termsOpen, "1"),
      entry(VOTING_RESULT_TAG, round1Result, "2"),
      entry(VOTING_TERMS_TAG, round2, "3"),
    ]);
    expect(active.terms?.payload.round).toBe(2);
  });

  it("lets the newest open message supersede an older one in the same lane", () => {
    const newer: VotingOpenPayload = { ...proposalOpen, id: "8", expiresAt: "2026-10-20T12:00:00.000Z" };
    const active = deriveActiveVote([
      entry(VOTING_PROPOSAL_TAG, proposalOpen, "1"),
      entry(VOTING_PROPOSAL_TAG, newer, "2"),
    ]);
    expect(active.proposal?.payload.id).toBe("8");
  });

  it("closes a proposal only for the matching id", () => {
    const other: VotingResultPayload = { kind: "proposal", listingId: "42", id: "99", status: "passed" };
    const active = deriveActiveVote([
      entry(VOTING_PROPOSAL_TAG, proposalOpen, "1"),
      entry(VOTING_RESULT_TAG, other, "2"),
    ]);
    expect(active.proposal?.payload.id).toBe("7");
  });

  it("breaks ties on the same timestamp by numeric messageId", () => {
    const sharedTime = "2026-09-01T12:00:00.000Z";
    const round2: VotingOpenPayload = { ...termsOpen, round: 2 };
    const active = deriveActiveVote([
      entry(VOTING_TERMS_TAG, round2, "11", sharedTime),
      entry(VOTING_TERMS_TAG, termsOpen, "10", sharedTime),
    ]);
    expect(active.terms?.payload.round).toBe(2);
  });
});

describe("vote tallies", () => {
  it("collects the newest result tally per vote key", () => {
    const first: VotingResultPayload = { kind: "proposal", listingId: "42", id: "7", status: "passed", yes: 5, no: 1 };
    const second: VotingResultPayload = { kind: "terms", listingId: "42", round: 1, status: "ratified", yes: 8, no: 2, abstain: 1 };
    const tallies = deriveVoteTallies([
      { message: makeMessage({ tag: VOTING_RESULT_TAG, messageId: "1" }), payload: first },
      { message: makeMessage({ tag: VOTING_RESULT_TAG, messageId: "2" }), payload: second },
    ]);
    expect(tallies.get("proposal:7:")).toEqual({ yes: 5, no: 1 });
    expect(tallies.get("terms::1")).toEqual({ yes: 8, no: 2, abstain: 1 });
  });

  it("skips open payloads", () => {
    const tallies = deriveVoteTallies([
      { message: makeMessage({ tag: VOTING_TERMS_TAG }), payload: termsOpen },
    ]);
    expect(tallies.size).toBe(0);
  });
});

describe("labels and percentages", () => {
  it("labels the voting kinds", () => {
    expect(votingKindLabel("terms")).toBe("SPV lawyer election");
    expect(votingKindLabel("election")).toBe("Letting-agent election");
    expect(votingKindLabel("proposal")).toBe("Agent spending proposal");
    expect(votingKindLabel("challenge")).toBe("Agent challenge");
  });

  it("labels statuses", () => {
    expect(votingStatusLabel("open")).toBe("Open");
    expect(votingStatusLabel("ratified")).toBe("Ratified");
    expect(votingStatusLabel("rejected")).toBe("Rejected");
    expect(votingStatusLabel("passed")).toBe("Passed");
    expect(votingStatusLabel("failed")).toBe("Failed");
  });

  it("uses approve/reject wording for terms and yes/no elsewhere", () => {
    expect(votingSideLabels("terms")).toEqual({ yes: "Approve", no: "Not voted" });
    expect(votingSideLabels("proposal")).toEqual({ yes: "Yes", no: "No" });
    expect(votingSideLabels("challenge")).toEqual({ yes: "Yes", no: "No" });
  });

  it("splits percentages over the non-abstain votes", () => {
    expect(votingPercentages(75, 25)).toEqual({ yesPct: 75, noPct: 25 });
    expect(votingPercentages(1, 2)).toEqual({ yesPct: 33, noPct: 67 });
    expect(votingPercentages(0, 0)).toBeUndefined();
    expect(votingPercentages(undefined, 5)).toBeUndefined();
  });
});

describe("parseNamespacePropertyId", () => {
  it("reads a string or numeric propertyId", () => {
    expect(parseNamespacePropertyId(JSON.stringify({ propertyId: "42" }))).toBe("42");
    expect(parseNamespacePropertyId(JSON.stringify({ propertyId: 42 }))).toBe("42");
  });

  it("returns undefined for missing or malformed input", () => {
    expect(parseNamespacePropertyId(null)).toBeUndefined();
    expect(parseNamespacePropertyId("not json")).toBeUndefined();
    expect(parseNamespacePropertyId(JSON.stringify(["42"]))).toBeUndefined();
    expect(parseNamespacePropertyId(JSON.stringify({ other: "42" }))).toBeUndefined();
    expect(parseNamespacePropertyId(JSON.stringify({ propertyId: "" }))).toBeUndefined();
  });
});

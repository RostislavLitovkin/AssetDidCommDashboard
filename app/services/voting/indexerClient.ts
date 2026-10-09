/**
 * Read-back client for the realXmarket devnet indexer's GraphQL API. The chain
 * is the source of truth for vote tallies; bucket messages only announce that
 * a vote exists, so cards merge these results over the message payloads.
 *
 * All I64 fields cross the GraphQL boundary as strings (juniper serializes
 * 64-bit ints as strings), hence the flexible number parsing below.
 */

export const INDEXER_GRAPHQL_URL = "https://indexer-devnet.xcavate.io/graphql";

export interface IndexerClientOptions {
  endpoint?: string;
  fetcher?: typeof fetch;
}

/** SPV-lawyer election state as exposed by `listings` + `lawyerCandidacies`. */
export interface IndexerSpvElection {
  listingId: string;
  round: number;
  /** Unix seconds. */
  expiry?: number;
  candidateCount?: number;
  soldShareAmount?: number;
  /** Summed vote power across the round's active candidacies. */
  totalVotePower?: number;
  /** The strongest candidacy (the one the "Approve" action votes for). */
  leadingCandidacy?: { lawyer: string; votePower?: number; costs?: number };
}

export interface IndexerProposal {
  proposalId: string;
  expiry?: number;
  tallyYes?: number;
  tallyNo?: number;
  tallyAbstain?: number;
  quorumBps?: number;
  thresholdBps?: number;
}

export interface IndexerChallenge {
  challengeId: string;
  expiry?: number;
  tallyYes?: number;
  tallyNo?: number;
  tallyAbstain?: number;
  quorumBps?: number;
}

export interface IndexerElection {
  round: number;
  /** Unix seconds; zero while no round is running. */
  expiry?: number;
  candidateCount?: number;
  quorumBps?: number;
}

export interface IndexerShareHolding {
  amount: number;
  lockLawyerElection: number;
  lockAgentElection: number;
  lockProposal: number;
  lockChallenge: number;
  listed: number;
}

class IndexerClientError extends Error {}

async function graphql<T>(query: string, variables: Record<string, unknown>, options?: IndexerClientOptions): Promise<T> {
  const endpoint = options?.endpoint ?? INDEXER_GRAPHQL_URL;
  const fetcher = options?.fetcher ?? fetch;
  const res = await fetcher(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new IndexerClientError(`Indexer HTTP ${res.status}`);
  }
  const body = (await res.json()) as { data?: T; errors?: { message?: string }[] };
  if (body.errors?.length) {
    throw new IndexerClientError(body.errors.map((e) => e.message ?? "GraphQL error").join("; "));
  }
  if (!body.data) {
    throw new IndexerClientError("Indexer returned no data");
  }
  return body.data;
}

function asNum(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

function asStr(value: unknown): string | undefined {
  if (typeof value === "string" && value !== "") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Unwraps a field that may be a single object, an array, or a `{ nodes }` connection. */
function asNodeList(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const record = asRecord(item);
      return record ? [record] : [];
    });
  }
  const record = asRecord(value);
  if (!record) {
    return [];
  }
  if (Array.isArray(record.nodes)) {
    return asNodeList(record.nodes);
  }
  return [record];
}

/** The listing's live SPV-lawyer election round, or null when none is running. */
export async function fetchSpvElection(listingId: string, options?: IndexerClientOptions): Promise<IndexerSpvElection | null> {
  const data = await graphql<{ listings: unknown; lawyerCandidacies: unknown }>(
    `query SpvElection($listingId: I64!) {
      listings(listingId: $listingId, first: 1, offset: 0) {
        nodes { spvElectionExpiry spvElectionRound spvElectionCandidateCount soldShareAmount }
      }
      lawyerCandidacies(listingId: $listingId, active: true, first: 5, offset: 0) {
        nodes { round lawyer costs votePower }
      }
    }`,
    { listingId },
    options,
  );

  const listing = asNodeList(data.listings)[0];
  if (!listing) {
    return null;
  }
  const round = asNum(listing.spvElectionRound);
  if (round === undefined) {
    return null;
  }

  const election: IndexerSpvElection = { listingId, round };
  const expiry = asNum(listing.spvElectionExpiry);
  if (expiry !== undefined) election.expiry = expiry;
  const candidateCount = asNum(listing.spvElectionCandidateCount);
  if (candidateCount !== undefined) election.candidateCount = candidateCount;
  const soldShareAmount = asNum(listing.soldShareAmount);
  if (soldShareAmount !== undefined) election.soldShareAmount = soldShareAmount;

  let total = 0;
  let anyPower = false;
  let leading: IndexerSpvElection["leadingCandidacy"];
  for (const node of asNodeList(data.lawyerCandidacies)) {
    if (asNum(node.round) !== round) {
      continue;
    }
    const lawyer = asStr(node.lawyer);
    if (!lawyer) {
      continue;
    }
    const votePower = asNum(node.votePower);
    const costs = asNum(node.costs);
    if (votePower !== undefined) {
      total += votePower;
      anyPower = true;
    }
    if (!leading || (votePower ?? 0) > (leading.votePower ?? 0)) {
      leading = { lawyer };
      if (votePower !== undefined) leading.votePower = votePower;
      if (costs !== undefined) leading.costs = costs;
    }
  }
  if (anyPower) election.totalVotePower = total;
  if (leading) election.leadingCandidacy = leading;
  return election;
}

/** The property seat's live spending proposal (at most one is ever active). */
export async function fetchActiveProposal(assetId: string, options?: IndexerClientOptions): Promise<IndexerProposal | null> {
  const data = await graphql<{ proposals: unknown }>(
    `query Proposals($assetId: I64!) {
      proposals(assetId: $assetId, active: true, first: 5) {
        nodes { proposalId expiry tallyYes tallyNo tallyAbstain quorumBps thresholdBps }
      }
    }`,
    { assetId },
    options,
  );

  let best: (IndexerProposal & { idNum: number }) | null = null;
  for (const node of asNodeList(data.proposals)) {
    const proposalId = asStr(node.proposalId);
    if (proposalId === undefined) {
      continue;
    }
    const idNum = Number(proposalId);
    if (best && Number.isFinite(idNum) && idNum < best.idNum) {
      continue;
    }
    const proposal: IndexerProposal & { idNum: number } = { proposalId, idNum: Number.isFinite(idNum) ? idNum : 0 };
    const expiry = asNum(node.expiry);
    if (expiry !== undefined) proposal.expiry = expiry;
    const tallyYes = asNum(node.tallyYes);
    if (tallyYes !== undefined) proposal.tallyYes = tallyYes;
    const tallyNo = asNum(node.tallyNo);
    if (tallyNo !== undefined) proposal.tallyNo = tallyNo;
    const tallyAbstain = asNum(node.tallyAbstain);
    if (tallyAbstain !== undefined) proposal.tallyAbstain = tallyAbstain;
    const quorumBps = asNum(node.quorumBps);
    if (quorumBps !== undefined) proposal.quorumBps = quorumBps;
    const thresholdBps = asNum(node.thresholdBps);
    if (thresholdBps !== undefined) proposal.thresholdBps = thresholdBps;
    best = proposal;
  }
  if (!best) {
    return null;
  }
  const { idNum: _ignored, ...proposal } = best;
  return proposal;
}

/** The property seat's live challenge against the sitting agent. */
export async function fetchActiveChallenge(assetId: string, options?: IndexerClientOptions): Promise<IndexerChallenge | null> {
  const data = await graphql<{ challenges: unknown }>(
    `query Challenges($assetId: I64!) {
      challenges(assetId: $assetId, active: true, first: 5) {
        nodes { challengeId expiry tallyYes tallyNo tallyAbstain quorumBps }
      }
    }`,
    { assetId },
    options,
  );

  let best: (IndexerChallenge & { idNum: number }) | null = null;
  for (const node of asNodeList(data.challenges)) {
    const challengeId = asStr(node.challengeId);
    if (challengeId === undefined) {
      continue;
    }
    const idNum = Number(challengeId);
    if (best && Number.isFinite(idNum) && idNum < best.idNum) {
      continue;
    }
    const challenge: IndexerChallenge & { idNum: number } = { challengeId, idNum: Number.isFinite(idNum) ? idNum : 0 };
    const expiry = asNum(node.expiry);
    if (expiry !== undefined) challenge.expiry = expiry;
    const tallyYes = asNum(node.tallyYes);
    if (tallyYes !== undefined) challenge.tallyYes = tallyYes;
    const tallyNo = asNum(node.tallyNo);
    if (tallyNo !== undefined) challenge.tallyNo = tallyNo;
    const tallyAbstain = asNum(node.tallyAbstain);
    if (tallyAbstain !== undefined) challenge.tallyAbstain = tallyAbstain;
    const quorumBps = asNum(node.quorumBps);
    if (quorumBps !== undefined) challenge.quorumBps = quorumBps;
    best = challenge;
  }
  if (!best) {
    return null;
  }
  const { idNum: _ignored, ...challenge } = best;
  return challenge;
}

/** The letting seat's current election round (expiry 0 means none running). */
export async function fetchElection(assetId: string, options?: IndexerClientOptions): Promise<IndexerElection | null> {
  const data = await graphql<{ propertyLettings: unknown }>(
    `query Lettings($assetId: I64!) {
      propertyLettings(assetId: $assetId, first: 1) {
        nodes { electionRound electionExpiry electionCandidateCount electionQuorumBps }
      }
    }`,
    { assetId },
    options,
  );

  const node = asNodeList(data.propertyLettings)[0];
  if (!node) {
    return null;
  }
  const round = asNum(node.electionRound);
  if (round === undefined) {
    return null;
  }
  const election: IndexerElection = { round };
  const expiry = asNum(node.electionExpiry);
  if (expiry !== undefined) election.expiry = expiry;
  const candidateCount = asNum(node.electionCandidateCount);
  if (candidateCount !== undefined) election.candidateCount = candidateCount;
  const quorumBps = asNum(node.electionQuorumBps);
  if (quorumBps !== undefined) election.quorumBps = quorumBps;
  return election;
}

/** One owner's share ledger for a listing — used to prefill the vote amount. */
export async function fetchShareHolding(assetId: string, owner: string, options?: IndexerClientOptions): Promise<IndexerShareHolding | null> {
  const data = await graphql<{ shareHoldings: unknown }>(
    `query ShareHoldings($assetId: I64!, $owner: String!) {
      shareHoldings(assetId: $assetId, owner: $owner, active: true, first: 1) {
        nodes { amount lockLawyerElection lockAgentElection lockProposal lockChallenge listed }
      }
    }`,
    { assetId, owner },
    options,
  );

  const node = asNodeList(data.shareHoldings)[0];
  if (!node) {
    return null;
  }
  const amount = asNum(node.amount);
  if (amount === undefined) {
    return null;
  }
  return {
    amount,
    lockLawyerElection: asNum(node.lockLawyerElection) ?? 0,
    lockAgentElection: asNum(node.lockAgentElection) ?? 0,
    lockProposal: asNum(node.lockProposal) ?? 0,
    lockChallenge: asNum(node.lockChallenge) ?? 0,
    listed: asNum(node.listed) ?? 0,
  };
}

/** Shares not yet tied up in a listing or any governance lock. */
export function availableVotingShares(holding: IndexerShareHolding): number {
  const locked =
    holding.lockLawyerElection + holding.lockAgentElection + holding.lockProposal + holding.lockChallenge + holding.listed;
  return Math.max(0, holding.amount - locked);
}

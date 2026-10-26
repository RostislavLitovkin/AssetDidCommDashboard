import { describe, expect, it } from "vitest";
import {
  INDEXER_GRAPHQL_URL,
  availableVotingShares,
  fetchActiveChallenge,
  fetchActiveProposal,
  fetchAgentVote,
  fetchElection,
  fetchShareHolding,
  fetchSpvElection,
} from "../../app/services/voting/indexerClient";

function stubFetcher(payload: unknown, status = 200): typeof fetch {
  return (async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  })) as unknown as typeof fetch;
}

describe("fetchSpvElection", () => {
  const listing = {
    spvElectionExpiry: "1760227200",
    spvElectionRound: "2",
    spvElectionCandidateCount: "3",
    soldShareAmount: "1000",
  };
  const candidacies = [
    { round: "2", lawyer: "LawyerA", costs: "500", votePower: "700" },
    { round: "2", lawyer: "LawyerB", costs: "300", votePower: "100" },
  ];

  it("parses the election counters, sums vote power and picks the leading candidacy", async () => {
    const result = await fetchSpvElection("42", {
      fetcher: stubFetcher({
        data: {
          listings: { nodes: [listing] },
          lawyerCandidacies: { nodes: candidacies },
        },
      }),
    });
    expect(result).toEqual({
      listingId: "42",
      round: 2,
      expiry: 1760227200,
      candidateCount: 3,
      soldShareAmount: 1000,
      totalVotePower: 800,
      leadingCandidacy: { lawyer: "LawyerA", costs: 500, votePower: 700 },
    });
  });

  it("ignores candidacies from other rounds and tolerates missing tallies", async () => {
    const result = await fetchSpvElection("42", {
      fetcher: stubFetcher({
        data: {
          listings: { nodes: [listing] },
          lawyerCandidacies: { nodes: [{ round: "1", lawyer: "Old", votePower: "900" }] },
        },
      }),
    });
    expect(result?.totalVotePower).toBeUndefined();
    expect(result?.leadingCandidacy).toBeUndefined();
  });

  it("returns null when the listing is absent", async () => {
    expect(
      await fetchSpvElection("42", { fetcher: stubFetcher({ data: { listings: null, lawyerCandidacies: null } }) }),
    ).toBeNull();
    expect(
      await fetchSpvElection("42", {
        fetcher: stubFetcher({ data: { listings: { nodes: [] }, lawyerCandidacies: { nodes: [] } } }),
      }),
    ).toBeNull();
  });

  it("throws on GraphQL errors and non-2xx responses", async () => {
    await expect(
      fetchSpvElection("42", { fetcher: stubFetcher({ errors: [{ message: "boom" }] }) }),
    ).rejects.toThrow("boom");
    await expect(fetchSpvElection("42", { fetcher: stubFetcher({}, 502) })).rejects.toThrow("HTTP 502");
  });

  it("posts to the devnet indexer endpoint by default", async () => {
    let calledUrl = "";
    const fetcher = (async (url: unknown) => {
      calledUrl = String(url);
      return { ok: true, status: 200, json: async () => ({ data: { listings: null } }) };
    }) as unknown as typeof fetch;
    await fetchSpvElection("42", { fetcher });
    expect(calledUrl).toBe(INDEXER_GRAPHQL_URL);
  });
});

describe("fetchActiveProposal", () => {
  it("parses tally fields from the proposals connection", async () => {
    const node = {
      proposalId: "7",
      expiry: "1760313600",
      tallyYes: "500",
      tallyNo: "100",
      tallyAbstain: "25",
      quorumBps: 1500,
      thresholdBps: 5000,
    };
    const result = await fetchActiveProposal("42", {
      fetcher: stubFetcher({ data: { proposals: { nodes: [node] } } }),
    });
    expect(result).toEqual({
      proposalId: "7",
      expiry: 1760313600,
      tallyYes: 500,
      tallyNo: 100,
      tallyAbstain: 25,
      quorumBps: 1500,
      thresholdBps: 5000,
    });
  });

  it("returns null without active proposals", async () => {
    const result = await fetchActiveProposal("42", { fetcher: stubFetcher({ data: { proposals: { nodes: [] } } }) });
    expect(result).toBeNull();
  });
});

describe("fetchActiveChallenge", () => {
  it("parses the live challenge", async () => {
    const node = { challengeId: "3", expiry: "1760313600", tallyYes: "10", tallyNo: "90", tallyAbstain: "0", quorumBps: 1000 };
    const result = await fetchActiveChallenge("42", {
      fetcher: stubFetcher({ data: { challenges: { nodes: [node] } } }),
    });
    expect(result).toEqual({ challengeId: "3", expiry: 1760313600, tallyYes: 10, tallyNo: 90, tallyAbstain: 0, quorumBps: 1000 });
  });
});

describe("fetchElection", () => {
  it("reads the letting seat's election columns", async () => {
    const node = { electionRound: "2", electionExpiry: "1760313600", electionCandidateCount: "3", electionQuorumBps: 1200 };
    const result = await fetchElection("42", {
      fetcher: stubFetcher({ data: { propertyLettings: { nodes: [node] } } }),
    });
    expect(result).toEqual({ round: 2, expiry: 1760313600, candidateCount: 3, quorumBps: 1200 });
  });

  it("returns null when the property has no letting seat", async () => {
    const result = await fetchElection("42", { fetcher: stubFetcher({ data: { propertyLettings: { nodes: [] } } }) });
    expect(result).toBeNull();
  });
});

describe("fetchAgentVote", () => {
  it("parses the voter's active agent-election vote", async () => {
    const node = { round: "2", choice: "AgentA", power: "10" };
    const result = await fetchAgentVote("42", "voter", {
      fetcher: stubFetcher({ data: { agentVotes: { nodes: [node] } } }),
    });
    expect(result).toEqual({ round: 2, choice: "AgentA", power: 10 });
  });

  it("picks the latest round when several active votes come back", async () => {
    const nodes = [
      { round: "1", choice: "OldAgent", power: "5" },
      { round: "2", choice: "NewAgent", power: "10" },
    ];
    const result = await fetchAgentVote("42", "voter", {
      fetcher: stubFetcher({ data: { agentVotes: { nodes } } }),
    });
    expect(result).toEqual({ round: 2, choice: "NewAgent", power: 10 });
  });

  it("returns null when the voter has no active agent vote", async () => {
    const result = await fetchAgentVote("42", "voter", {
      fetcher: stubFetcher({ data: { agentVotes: { nodes: [] } } }),
    });
    expect(result).toBeNull();
  });

  it("skips nodes without a usable round or choice", async () => {
    const nodes = [{ round: "2" }, { choice: "AgentA" }, { round: "1", choice: "AgentB", power: "3" }];
    const result = await fetchAgentVote("42", "voter", {
      fetcher: stubFetcher({ data: { agentVotes: { nodes } } }),
    });
    expect(result).toEqual({ round: 1, choice: "AgentB", power: 3 });
  });
});

describe("fetchShareHolding / availableVotingShares", () => {
  it("parses the holding and computes the unlocked share count", async () => {
    const node = {
      amount: "1000",
      lockLawyerElection: "0",
      lockAgentElection: "50",
      lockProposal: "100",
      lockChallenge: "0",
      listed: "25",
    };
    const holding = await fetchShareHolding("42", "owner", {
      fetcher: stubFetcher({ data: { shareHoldings: { nodes: [node] } } }),
    });
    expect(holding).toEqual({
      amount: 1000,
      lockLawyerElection: 0,
      lockAgentElection: 50,
      lockProposal: 100,
      lockChallenge: 0,
      listed: 25,
    });
    expect(availableVotingShares(holding!)).toBe(825);
  });

  it("clamps negative availability to zero", () => {
    expect(
      availableVotingShares({ amount: 10, lockLawyerElection: 0, lockAgentElection: 0, lockProposal: 20, lockChallenge: 0, listed: 0 }),
    ).toBe(0);
  });

  it("returns null for an owner without a holding", async () => {
    const holding = await fetchShareHolding("42", "owner", {
      fetcher: stubFetcher({ data: { shareHoldings: { nodes: [] } } }),
    });
    expect(holding).toBeNull();
  });
});

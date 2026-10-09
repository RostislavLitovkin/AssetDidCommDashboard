import { describe, expect, it } from "vitest";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  MARKETPLACE_PROGRAM_ID,
  PROPERTY_PROGRAM_ID,
  XCAVATE_WHITELIST_PROGRAM_ID,
  agentCandidacyPda,
  agentVotePda,
  buildVoteOnAgentTransaction,
  buildVoteOnChallengeTransaction,
  buildVoteOnProposalTransaction,
  buildVoteOnSpvLawyerTransaction,
  challengePda,
  challengeVotePda,
  cpiAuthPda,
  lawyerCandidacyPda,
  lawyerVoteRecordPda,
  lettingPda,
  listingPda,
  proposalPda,
  proposalVotePda,
  shareHoldingPda,
  voterRolePda,
} from "../../app/services/voting/solanaVote";

const VOTER = "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM";
const AGENT = "Stake11111111111111111111111111111111111111";

async function sha256(text: string): Promise<number[]> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest));
}

describe("instruction discriminators", () => {
  it("match sha256('global:<ix_name>')[0..8] from the deployed IDLs", async () => {
    // Pinned in the IDL account meta and recomputed here to catch a typo.
    expect((await sha256("global:vote_on_spv_lawyer")).slice(0, 8)).toEqual([245, 181, 143, 227, 83, 159, 141, 147]);
    expect((await sha256("global:vote_on_proposal")).slice(0, 8)).toEqual([188, 239, 13, 88, 119, 199, 251, 119]);
    expect((await sha256("global:vote_on_challenge")).slice(0, 8)).toEqual([19, 36, 128, 75, 123, 135, 79, 64]);
    expect((await sha256("global:vote_on_agent")).slice(0, 8)).toEqual([203, 127, 40, 102, 254, 243, 11, 244]);
  });
});

describe("PDA derivation", () => {
  // Ground truth computed independently of @solana/web3.js (pure-Python
  // sha256 + ed25519 curve check over the documented seed layouts).
  it("derives the marketplace listing and SPV election PDAs", () => {
    const voter = new PublicKey(VOTER);
    const lawyer = new PublicKey(AGENT);
    expect(listingPda(42).toBase58()).toBe("Da9GJLvR88quSajqF6uuRWwakEFyUxvjxZu35UYRGqCS");
    expect(lawyerVoteRecordPda(42, 1, voter).toBase58()).toBe("QSg6aHXsiSiBeTB4i6huUgNxQk8g1wqQXdA9Soa28SK");
    expect(lawyerCandidacyPda(42, 1, lawyer).toBase58()).toBe("2MPceHQnaZBFwhaP94cfHmHXYMJueEhMMyu7WWkMNz9B");
  });

  it("derives the share holding PDA", () => {
    const voter = new PublicKey(VOTER);
    expect(shareHoldingPda(42, voter).toBase58()).toBe("4R55F6bzJvHV8pPAyYhBNAaRLBumTRwVMD3aJ68EBqxR");
  });

  it("derives the whitelist investor role PDA", () => {
    expect(voterRolePda(new PublicKey(VOTER)).toBase58()).toBe("84PpSYsNmwY5HXSzHgEv7PccJMwjeHSrTjPdFkEbHHdS");
  });

  it("derives the property governance PDAs", () => {
    const voter = new PublicKey(VOTER);
    expect(lettingPda(42).toBase58()).toBe("AtG72xATHxcw4PR1LJkPXq946E453TzGi2z1GuNNPysw");
    expect(proposalPda(42, 7).toBase58()).toBe("61v6J3qGFtYJNHek1YrvtRD4CKCaeas4u9ENaUQsb6zi");
    expect(proposalVotePda(42, 7, voter).toBase58()).toBe("3YbCLNmrSfbmnZm4qQAYetXZZcLiAuaH8vCqsUPkEbq4");
    expect(challengePda(42, 3).toBase58()).toBe("8um23r2NX54Yhfw2i1GhBAs6QWku4ozxzZSuYRreLRhf");
    expect(challengeVotePda(42, 3, voter).toBase58()).toBe("6V6CouNZLdTVN7kNbhDDvxbJShNB4LmRtHenH6ms8Lsu");
    expect(cpiAuthPda().toBase58()).toBe("7rPZbW6okohPjK6zSQrFfkep3FeQd3nU9JnahrGSFeGj");
  });

  it("derives the agent election PDAs", () => {
    const voter = new PublicKey(VOTER);
    const agent = new PublicKey(AGENT);
    expect(agentCandidacyPda(42, 2, agent).toBase58()).toBe("EqywmT3C5ne9G487i8wbVAA37YUor5xbKwrngpnBuWeo");
    expect(agentVotePda(42, 2, voter).toBase58()).toBe("5eeuGZFBBMfEFgVH1EqLHRMCZT1NmfUXdomCExu95Rdb");
  });
});

function u64le(value: number): number[] {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(value), true);
  return Array.from(out);
}

function u32le(value: number): number[] {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return Array.from(out);
}

describe("vote_on_spv_lawyer transaction", () => {
  const tx = buildVoteOnSpvLawyerTransaction({ listingId: 42, round: 1, lawyer: AGENT, amount: 100, voter: VOTER });
  const ix = tx.instructions[0]!;

  it("targets the marketplace program", () => {
    expect(ix.programId.toBase58()).toBe(MARKETPLACE_PROGRAM_ID);
  });

  it("lays out the accounts in IDL order with correct flags", () => {
    const expected: [string, boolean, boolean][] = [
      [VOTER, true, false], // voter
      [VOTER, true, true], // payer
      ["84PpSYsNmwY5HXSzHgEv7PccJMwjeHSrTjPdFkEbHHdS", false, false], // voter_role
      ["Da9GJLvR88quSajqF6uuRWwakEFyUxvjxZu35UYRGqCS", false, false], // listing
      ["4R55F6bzJvHV8pPAyYhBNAaRLBumTRwVMD3aJ68EBqxR", false, true], // holding
      ["QSg6aHXsiSiBeTB4i6huUgNxQk8g1wqQXdA9Soa28SK", false, true], // vote_record
      ["2MPceHQnaZBFwhaP94cfHmHXYMJueEhMMyu7WWkMNz9B", false, true], // candidacy
      [MARKETPLACE_PROGRAM_ID, false, false], // previous_candidacy sentinel (None)
      [SystemProgram.programId.toBase58(), false, false], // system_program
    ];
    expect(ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable])).toEqual(expected);
  });

  it("encodes discriminator + borsh args (listing_id, amount — no choice field)", () => {
    expect(Array.from(ix.data)).toEqual([
      ...[245, 181, 143, 227, 83, 159, 141, 147],
      ...u64le(42),
      ...u32le(100),
    ]);
  });

  it("keys the vote record by the requested round", () => {
    const round2 = buildVoteOnSpvLawyerTransaction({ listingId: 42, round: 2, lawyer: AGENT, amount: 1, voter: VOTER });
    expect(round2.instructions[0]!.keys[5]!.pubkey.toBase58()).toBe(
      "317ANy2HaG1Xp9JjcTQH4RZQomRWLYa1iCa2tTfwy3aN",
    );
  });
});

describe("vote_on_proposal transaction", () => {
  const tx = buildVoteOnProposalTransaction({ assetId: 42, proposalId: 7, choice: "yes", amount: 100, voter: VOTER });
  const ix = tx.instructions[0]!;

  it("targets the property program", () => {
    expect(ix.programId.toBase58()).toBe(PROPERTY_PROGRAM_ID);
  });

  it("lays out the accounts in IDL order", () => {
    const expected: [string, boolean, boolean][] = [
      [VOTER, true, false],
      [VOTER, true, true],
      ["84PpSYsNmwY5HXSzHgEv7PccJMwjeHSrTjPdFkEbHHdS", false, false],
      ["AtG72xATHxcw4PR1LJkPXq946E453TzGi2z1GuNNPysw", false, false],
      ["61v6J3qGFtYJNHek1YrvtRD4CKCaeas4u9ENaUQsb6zi", false, true],
      ["4R55F6bzJvHV8pPAyYhBNAaRLBumTRwVMD3aJ68EBqxR", false, true],
      ["3YbCLNmrSfbmnZm4qQAYetXZZcLiAuaH8vCqsUPkEbq4", false, true],
      ["7rPZbW6okohPjK6zSQrFfkep3FeQd3nU9JnahrGSFeGj", false, false],
      [MARKETPLACE_PROGRAM_ID, false, false],
      [SystemProgram.programId.toBase58(), false, false],
    ];
    expect(ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable])).toEqual(expected);
  });

  it("encodes the VoteChoice enum index", () => {
    const base = [188, 239, 13, 88, 119, 199, 251, 119, ...u64le(42)];
    expect(Array.from(ix.data)).toEqual([...base, 0, ...u32le(100)]);
    const no = buildVoteOnProposalTransaction({ assetId: 42, proposalId: 7, choice: "no", amount: 100, voter: VOTER });
    expect(Array.from(no.instructions[0]!.data)[16]).toBe(1);
    const abstain = buildVoteOnProposalTransaction({ assetId: 42, proposalId: 7, choice: "abstain", amount: 100, voter: VOTER });
    expect(Array.from(abstain.instructions[0]!.data)[16]).toBe(2);
  });
});

describe("vote_on_challenge transaction", () => {
  const tx = buildVoteOnChallengeTransaction({ assetId: 42, challengeId: 3, choice: "no", amount: 50, voter: VOTER });
  const ix = tx.instructions[0]!;

  it("targets the property program with challenge accounts", () => {
    expect(ix.programId.toBase58()).toBe(PROPERTY_PROGRAM_ID);
    expect(ix.keys[4]!.pubkey.toBase58()).toBe("8um23r2NX54Yhfw2i1GhBAs6QWku4ozxzZSuYRreLRhf");
    expect(ix.keys[6]!.pubkey.toBase58()).toBe("6V6CouNZLdTVN7kNbhDDvxbJShNB4LmRtHenH6ms8Lsu");
  });

  it("encodes discriminator + args", () => {
    expect(Array.from(ix.data)).toEqual([
      ...[19, 36, 128, 75, 123, 135, 79, 64],
      ...u64le(42),
      1, // no
      ...u32le(50),
    ]);
  });
});

describe("vote_on_agent transaction", () => {
  const tx = buildVoteOnAgentTransaction({ assetId: 42, round: 2, agent: AGENT, amount: 10, voter: VOTER });
  const ix = tx.instructions[0]!;

  it("targets the property program with candidacy accounts", () => {
    expect(ix.programId.toBase58()).toBe(PROPERTY_PROGRAM_ID);
    expect(ix.keys[5]!.pubkey.toBase58()).toBe("5eeuGZFBBMfEFgVH1EqLHRMCZT1NmfUXdomCExu95Rdb");
    expect(ix.keys[6]!.pubkey.toBase58()).toBe("EqywmT3C5ne9G487i8wbVAA37YUor5xbKwrngpnBuWeo");
  });

  it("passes the program id as the None sentinel for previous_candidacy", () => {
    expect(ix.keys[7]!.pubkey.toBase58()).toBe(PROPERTY_PROGRAM_ID);
    expect(ix.keys[7]!.isWritable).toBe(false);
  });

  it("encodes discriminator + args", () => {
    expect(Array.from(ix.data)).toEqual([
      ...[203, 127, 40, 102, 254, 243, 11, 244],
      ...u64le(42),
      ...u32le(10),
    ]);
  });
});

describe("program ids", () => {
  it("match the deployed devnet IDL addresses", () => {
    expect(MARKETPLACE_PROGRAM_ID).toBe("dj9Q3CpHvDHwexCbkgJ5APDx4JsTxPssNebkvP15g1T");
    expect(PROPERTY_PROGRAM_ID).toBe("deCp9srk9C6P4BXJaFpjR5H6Jsm6DCq8AL2kk338dVq");
    expect(XCAVATE_WHITELIST_PROGRAM_ID).toBe("7TrzjKpdrEhnfhxuw8tWdH1sjxadazscsG5HXCDPLmaY");
  });
});

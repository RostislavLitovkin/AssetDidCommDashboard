/**
 * On-chain governance voting: hand-built Anchor instructions for the
 * marketplace terms vote and the property program's proposal / challenge /
 * agent elections, submitted through whichever wallet can sign and send.
 *
 * The MAUI host injects a Wallet Standard wallet whose
 * `solana:signAndSendTransaction` feature relays to the app; standalone web
 * sessions usually have message-signing only, which the UI turns into a
 * "vote in the realXmarket app" disabled state.
 */
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type AccountMeta,
} from "@solana/web3.js";
import { registeredSolanaWallets, type StandardWallet } from "../wallet/solanaWalletRegistry";

/** Program ids, taken from the deployed devnet IDLs' `address` fields. */
export const MARKETPLACE_PROGRAM_ID = "dj9Q3CpHvDHwexCbkgJ5APDx4JsTxPssNebkvP15g1T";
export const PROPERTY_PROGRAM_ID = "deCp9srk9C6P4BXJaFpjR5H6Jsm6DCq8AL2kk338dVq";
export const XCAVATE_WHITELIST_PROGRAM_ID = "7TrzjKpdrEhnfhxuw8tWdH1sjxadazscsG5HXCDPLmaY";

/** Wallet Standard chain parameter the bridge expects for devnet sends. */
export const SOLANA_VOTE_CHAIN = "solana:devnet";

/** Public devnet RPC; only the recent blockhash and confirmation ride on it. */
export const SOLANA_RPC_URL = "https://api.devnet.solana.com";

// Anchor instruction discriminators — sha256("global:<ix_name>")[0..8], as
// pinned in the deployed IDLs (tests recompute the hash to prove parity).
const DISC_VOTE_ON_SPV_LAWYER = Uint8Array.from([245, 181, 143, 227, 83, 159, 141, 147]);
const DISC_VOTE_ON_PROPOSAL = Uint8Array.from([188, 239, 13, 88, 119, 199, 251, 119]);
const DISC_VOTE_ON_CHALLENGE = Uint8Array.from([19, 36, 128, 75, 123, 135, 79, 64]);
const DISC_VOTE_ON_AGENT = Uint8Array.from([203, 127, 40, 102, 254, 243, 11, 244]);

// PDA seeds, mirroring the on-chain constants.
const SEED_LISTING = "listing";
const SEED_LAWYER_VOTE = "lawyer-vote";
const SEED_LAWYER_CANDIDATE = "lawyer-candidate";
const SEED_SHARE = "share";
const SEED_ROLE = "role";
const SEED_LETTING = "letting";
const SEED_PROPOSAL = "gov-proposal";
const SEED_PROPOSAL_VOTE = "gov-proposal-vote";
const SEED_CHALLENGE = "gov-challenge";
const SEED_CHALLENGE_VOTE = "gov-challenge-vote";
const SEED_AGENT_VOTE = "agent-vote";
const SEED_AGENT_CANDIDATE = "agent-candidate";
const SEED_CPI_AUTH = "cpi-auth";

/** xcavate-whitelist Role::RealEstateInvestor seed byte. */
const ROLE_REAL_ESTATE_INVESTOR = 1;

const marketplaceProgram = new PublicKey(MARKETPLACE_PROGRAM_ID);
const propertyProgram = new PublicKey(PROPERTY_PROGRAM_ID);
const whitelistProgram = new PublicKey(XCAVATE_WHITELIST_PROGRAM_ID);

function textSeed(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function u64le(value: bigint | number | string): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(value), true);
  return out;
}

function u32le(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

function pda(seeds: Uint8Array[], program: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, program)[0];
}

export function listingPda(listingId: string | number | bigint): PublicKey {
  return pda([textSeed(SEED_LISTING), u64le(listingId)], marketplaceProgram);
}

export function shareHoldingPda(assetId: string | number | bigint, voter: PublicKey): PublicKey {
  return pda([textSeed(SEED_SHARE), u64le(assetId), voter.toBytes()], marketplaceProgram);
}

/** One voter's SPV-election vote: [b"lawyer-vote", listing_id LE, round LE, voter]. */
export function lawyerVoteRecordPda(listingId: string | number | bigint, round: number | bigint, voter: PublicKey): PublicKey {
  return pda([textSeed(SEED_LAWYER_VOTE), u64le(listingId), u64le(round), voter.toBytes()], marketplaceProgram);
}

/** One lawyer's SPV candidacy: [b"lawyer-candidate", listing_id LE, round LE, lawyer]. */
export function lawyerCandidacyPda(listingId: string | number | bigint, round: number | bigint, lawyer: PublicKey): PublicKey {
  return pda([textSeed(SEED_LAWYER_CANDIDATE), u64le(listingId), u64le(round), lawyer.toBytes()], marketplaceProgram);
}

export function voterRolePda(voter: PublicKey): PublicKey {
  return pda([textSeed(SEED_ROLE), voter.toBytes(), Uint8Array.of(ROLE_REAL_ESTATE_INVESTOR)], whitelistProgram);
}

export function lettingPda(assetId: string | number | bigint): PublicKey {
  return pda([textSeed(SEED_LETTING), u64le(assetId)], propertyProgram);
}

export function proposalPda(assetId: string | number | bigint, proposalId: string | number | bigint): PublicKey {
  return pda([textSeed(SEED_PROPOSAL), u64le(assetId), u64le(proposalId)], propertyProgram);
}

export function proposalVotePda(assetId: string | number | bigint, proposalId: string | number | bigint, voter: PublicKey): PublicKey {
  return pda([textSeed(SEED_PROPOSAL_VOTE), u64le(assetId), u64le(proposalId), voter.toBytes()], propertyProgram);
}

export function challengePda(assetId: string | number | bigint, challengeId: string | number | bigint): PublicKey {
  return pda([textSeed(SEED_CHALLENGE), u64le(assetId), u64le(challengeId)], propertyProgram);
}

export function challengeVotePda(assetId: string | number | bigint, challengeId: string | number | bigint, voter: PublicKey): PublicKey {
  return pda([textSeed(SEED_CHALLENGE_VOTE), u64le(assetId), u64le(challengeId), voter.toBytes()], propertyProgram);
}

export function agentCandidacyPda(assetId: string | number | bigint, round: number | bigint, agent: PublicKey): PublicKey {
  return pda([textSeed(SEED_AGENT_CANDIDATE), u64le(assetId), u64le(round), agent.toBytes()], propertyProgram);
}

export function agentVotePda(assetId: string | number | bigint, round: number | bigint, voter: PublicKey): PublicKey {
  return pda([textSeed(SEED_AGENT_VOTE), u64le(assetId), u64le(round), voter.toBytes()], propertyProgram);
}

export function cpiAuthPda(): PublicKey {
  return pda([textSeed(SEED_CPI_AUTH)], propertyProgram);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** The property program's VoteChoice enum: Yes / No / Abstain variant indexes. */
export type GovernanceVoteChoice = "yes" | "no" | "abstain";

const VOTE_CHOICE_INDEX: Record<GovernanceVoteChoice, number> = { yes: 0, no: 1, abstain: 2 };

function signer(pubkey: PublicKey, writable = false): AccountMeta {
  return { pubkey, isSigner: true, isWritable: writable };
}

function writable(pubkey: PublicKey): AccountMeta {
  return { pubkey, isSigner: false, isWritable: true };
}

function readonly(pubkey: PublicKey): AccountMeta {
  return { pubkey, isSigner: false, isWritable: false };
}

function instruction(programId: PublicKey, keys: AccountMeta[], data: Uint8Array): Transaction {
  return new Transaction().add(new TransactionInstruction({ programId, keys, data: data as unknown as Buffer }));
}

export interface SpvLawyerVoteRequest {
  listingId: string | number | bigint;
  /** Current election round (u64 on chain), from the indexer's listing row. */
  round: number | bigint;
  /** The candidacy's lawyer wallet, base58 — the lawyer the vote backs. */
  lawyer: string;
  /** Shares to lock behind the vote. */
  amount: number;
  /** Voter wallet, base58. Also fronts the vote record's rent. */
  voter: string;
}

/** marketplace::vote_on_spv_lawyer — back one SPV candidacy with `amount` shares. */
export function buildVoteOnSpvLawyerTransaction(request: SpvLawyerVoteRequest): Transaction {
  const voter = new PublicKey(request.voter);
  const lawyer = new PublicKey(request.lawyer);
  const listing = listingPda(request.listingId);
  const keys: AccountMeta[] = [
    signer(voter),
    signer(voter, true), // payer == voter on the self-service path
    readonly(voterRolePda(voter)),
    readonly(listing),
    writable(shareHoldingPda(request.listingId, voter)),
    writable(lawyerVoteRecordPda(request.listingId, request.round, voter)),
    writable(lawyerCandidacyPda(request.listingId, request.round, lawyer)),
    // previous_candidacy is optional; Anchor's sentinel for None is the
    // program's own id.
    readonly(marketplaceProgram),
    readonly(SystemProgram.programId),
  ];
  const data = concat(
    DISC_VOTE_ON_SPV_LAWYER,
    u64le(request.listingId),
    u32le(request.amount),
  );
  return instruction(marketplaceProgram, keys, data);
}

export interface ProposalVoteRequest {
  assetId: string | number | bigint;
  proposalId: string | number | bigint;
  choice: GovernanceVoteChoice;
  amount: number;
  voter: string;
}

/** property::vote_on_proposal — yes/no/abstain on the seat's live proposal. */
export function buildVoteOnProposalTransaction(request: ProposalVoteRequest): Transaction {
  const voter = new PublicKey(request.voter);
  const keys: AccountMeta[] = [
    signer(voter),
    signer(voter, true),
    readonly(voterRolePda(voter)),
    readonly(lettingPda(request.assetId)),
    writable(proposalPda(request.assetId, request.proposalId)),
    writable(shareHoldingPda(request.assetId, voter)),
    writable(proposalVotePda(request.assetId, request.proposalId, voter)),
    readonly(cpiAuthPda()),
    readonly(marketplaceProgram),
    readonly(SystemProgram.programId),
  ];
  const data = concat(
    DISC_VOTE_ON_PROPOSAL,
    u64le(request.assetId),
    Uint8Array.of(VOTE_CHOICE_INDEX[request.choice]),
    u32le(request.amount),
  );
  return instruction(propertyProgram, keys, data);
}

export interface ChallengeVoteRequest {
  assetId: string | number | bigint;
  challengeId: string | number | bigint;
  choice: GovernanceVoteChoice;
  amount: number;
  voter: string;
}

/** property::vote_on_challenge — yes/no/abstain on the live agent strike. */
export function buildVoteOnChallengeTransaction(request: ChallengeVoteRequest): Transaction {
  const voter = new PublicKey(request.voter);
  const keys: AccountMeta[] = [
    signer(voter),
    signer(voter, true),
    readonly(voterRolePda(voter)),
    readonly(lettingPda(request.assetId)),
    writable(challengePda(request.assetId, request.challengeId)),
    writable(shareHoldingPda(request.assetId, voter)),
    writable(challengeVotePda(request.assetId, request.challengeId, voter)),
    readonly(cpiAuthPda()),
    readonly(marketplaceProgram),
    readonly(SystemProgram.programId),
  ];
  const data = concat(
    DISC_VOTE_ON_CHALLENGE,
    u64le(request.assetId),
    Uint8Array.of(VOTE_CHOICE_INDEX[request.choice]),
    u32le(request.amount),
  );
  return instruction(propertyProgram, keys, data);
}

export interface AgentVoteRequest {
  assetId: string | number | bigint;
  /** Current election round (u64 on chain). */
  round: number | bigint;
  /** Candidate's wallet, base58 — identifies the candidacy account. */
  agent: string;
  amount: number;
  voter: string;
}

/**
 * property::vote_on_agent — back one candidate in the live election. Only the
 * first-vote path is wired: changing an existing vote to a different
 * candidate additionally needs the previous candidacy account, which the
 * chat UI never produces (first votes only).
 */
export function buildVoteOnAgentTransaction(request: AgentVoteRequest): Transaction {
  const voter = new PublicKey(request.voter);
  const agent = new PublicKey(request.agent);
  const keys: AccountMeta[] = [
    signer(voter),
    signer(voter, true),
    readonly(voterRolePda(voter)),
    readonly(lettingPda(request.assetId)),
    writable(shareHoldingPda(request.assetId, voter)),
    writable(agentVotePda(request.assetId, request.round, voter)),
    writable(agentCandidacyPda(request.assetId, request.round, agent)),
    // previous_candidacy is optional; Anchor's sentinel for None is the
    // program's own id.
    readonly(propertyProgram),
    readonly(cpiAuthPda()),
    readonly(marketplaceProgram),
    readonly(SystemProgram.programId),
  ];
  const data = concat(DISC_VOTE_ON_AGENT, u64le(request.assetId), u32le(request.amount));
  return instruction(propertyProgram, keys, data);
}

interface StandardSignAndSendFeature {
  signAndSendTransaction(input: {
    account: { address: string };
    transaction: Uint8Array;
    chain: string;
  }): Promise<readonly { signature: Uint8Array }[]>;
}

interface LegacySignAndSendProvider {
  signAndSendTransaction(transaction: Transaction): Promise<{ signature: string | Uint8Array } | string>;
}

/** A wallet that can sign AND submit a vote transaction. */
export interface VoteTransactionBridge {
  /** Display name of the backing wallet. */
  name: string;
  /** Signs and submits; resolves to the raw 64-byte (or base58) signature. */
  signAndSend(transaction: Transaction, chain: string, voter: PublicKey): Promise<Uint8Array | string>;
}

function standardBridge(wallet: StandardWallet, feature: StandardSignAndSendFeature): VoteTransactionBridge {
  return {
    name: wallet.name,
    async signAndSend(transaction, chain, voter) {
      const serialized = transaction.serialize({ requireAllSignatures: false, verifySignatures: false });
      const [result] = await feature.signAndSendTransaction({
        account: { address: voter.toBase58() },
        transaction: serialized,
        chain,
      });
      if (!result?.signature) {
        throw new Error("The wallet returned no transaction signature");
      }
      return result.signature;
    },
  };
}

function legacyBridge(name: string, provider: LegacySignAndSendProvider): VoteTransactionBridge {
  return {
    name,
    async signAndSend(transaction) {
      const result = await provider.signAndSendTransaction(transaction);
      return typeof result === "string" ? result : result.signature;
    },
  };
}

/**
 * Finds a wallet able to sign-and-send: first the injected Wallet Standard
 * bridge (the MAUI host), then Phantom-style legacy providers. Returns null
 * on standalone web sessions with message-signing-only wallets.
 */
export function findVoteBridge(): VoteTransactionBridge | null {
  if (typeof window === "undefined") {
    return null;
  }

  for (const wallet of registeredSolanaWallets()) {
    const feature = wallet.features["solana:signAndSendTransaction"] as StandardSignAndSendFeature | undefined;
    if (typeof feature?.signAndSendTransaction === "function") {
      return standardBridge(wallet, feature);
    }
  }

  const w = window as unknown as {
    solana?: LegacySignAndSendProvider;
    phantom?: { solana?: LegacySignAndSendProvider };
  };
  if (typeof w.solana?.signAndSendTransaction === "function") {
    return legacyBridge("Solana wallet", w.solana);
  }
  if (typeof w.phantom?.solana?.signAndSendTransaction === "function") {
    return legacyBridge("Phantom", w.phantom.solana);
  }
  return null;
}

export interface CastVoteOptions {
  rpcUrl?: string;
  chain?: string;
  bridge?: VoteTransactionBridge | null;
}

function base58Encode(bytes: Uint8Array): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i += 1) {
      carry += digits[i]! << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "";
  for (const byte of bytes) {
    if (byte === 0) out += alphabet[0];
    else break;
  }
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    out += alphabet[digits[i]!];
  }
  return out;
}

/**
 * Fills in blockhash + fee payer, hands the transaction to the wallet, and
 * best-effort confirms it. Resolves to the base58 signature; a confirmation
 * that times out is NOT an error — the indexer poll reconciles tallies later.
 */
export async function castVoteOnChain(
  transaction: Transaction,
  voter: string,
  options?: CastVoteOptions,
): Promise<{ signature: string; walletName: string }> {
  const bridge = options?.bridge === undefined ? findVoteBridge() : options.bridge;
  if (!bridge) {
    throw new Error("NO_SIGN_AND_SEND_WALLET");
  }

  const voterKey = new PublicKey(voter);
  const rpcUrl = options?.rpcUrl ?? SOLANA_RPC_URL;
  const connection = new Connection(rpcUrl, "confirmed");

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = voterKey;

  const rawSignature = await bridge.signAndSend(transaction, options?.chain ?? SOLANA_VOTE_CHAIN, voterKey);
  const signature = typeof rawSignature === "string" ? rawSignature : base58Encode(rawSignature);

  try {
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  } catch {
    // Submission already succeeded by the time a signature exists; a slow
    // confirmation only means tallies settle a few seconds later.
  }

  return { signature, walletName: bridge.name };
}

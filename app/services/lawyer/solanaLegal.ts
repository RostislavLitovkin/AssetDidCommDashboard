import {
  AddressLookupTableProgram,
  Connection,
  PACKET_DATA_SIZE,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type AccountMeta,
  type AddressLookupTableAccount,
} from "@solana/web3.js";
import { registeredSolanaWallets, type StandardWallet } from "../wallet/solanaWalletRegistry";
import type { LegalClusterConfig } from "./cluster";

export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

const DISC_LAWYER_CONFIRM_DOCUMENTS = Uint8Array.from([218, 145, 193, 157, 127, 110, 10, 94]);
const DISC_EXECUTE_DEAL = Uint8Array.from([107, 92, 176, 235, 53, 80, 14, 94]);
const PLACEHOLDER_BLOCKHASH = PublicKey.default.toBase58();
const LOOKUP_TABLE_DEACTIVATED = 18446744073709551615n;

export type { LegalClusterConfig } from "./cluster";

export type LegalPublicKey = PublicKey | string;
export type LegalTransaction = Transaction | VersionedTransaction;

function publicKey(value: LegalPublicKey): PublicKey {
  return value instanceof PublicKey ? value : new PublicKey(value);
}

function textSeed(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function u64le(value: number | bigint | string): Uint8Array {
  const parsed = BigInt(value);
  if (parsed < 0n || parsed > 18446744073709551615n) {
    throw new Error("INVALID_U64");
  }
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, parsed, true);
  return out;
}

function u16le(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 65535) {
    throw new Error("INVALID_REGION_ID");
  }
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value, true);
  return out;
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

function pda(seeds: Uint8Array[], programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

function signer(pubkey: PublicKey, writable = false): AccountMeta {
  return { pubkey, isSigner: true, isWritable: writable };
}

function writable(pubkey: PublicKey): AccountMeta {
  return { pubkey, isSigner: false, isWritable: true };
}

function readonly(pubkey: PublicKey): AccountMeta {
  return { pubkey, isSigner: false, isWritable: false };
}

function assertClusterConfig(config: LegalClusterConfig): void {
  if (config.walletChain !== `solana:${config.cluster}` || !config.rpcUrl) {
    throw new Error("CLUSTER_CONFIG_MISMATCH");
  }
}

function marketplaceProgram(config: LegalClusterConfig): PublicKey {
  return new PublicKey(config.marketplaceProgramId);
}

function listingPda(listingId: number | bigint | string, config: LegalClusterConfig): PublicKey {
  return pda([textSeed("listing"), u64le(listingId)], marketplaceProgram(config));
}

function propertyPda(listingId: number | bigint | string, config: LegalClusterConfig): PublicKey {
  return pda([textSeed("property"), u64le(listingId)], marketplaceProgram(config));
}

function configPda(config: LegalClusterConfig): PublicKey {
  return pda([textSeed("config")], marketplaceProgram(config));
}

function lawyerRegistryPda(lawyer: PublicKey, config: LegalClusterConfig): PublicKey {
  return pda([textSeed("lawyer"), lawyer.toBytes()], marketplaceProgram(config));
}

function listingVaultPda(listingId: number | bigint | string, config: LegalClusterConfig): PublicKey {
  return pda([textSeed("listing-vault"), u64le(listingId)], marketplaceProgram(config));
}

function marketplaceVaultPda(config: LegalClusterConfig): PublicKey {
  return pda([textSeed("vault")], marketplaceProgram(config));
}

function regionPda(regionId: number, config: LegalClusterConfig): PublicKey {
  return pda([textSeed("region"), u16le(regionId)], new PublicKey(config.regionsProgramId));
}

export function lawyerRolePda(lawyer: LegalPublicKey, config: LegalClusterConfig): PublicKey {
  return pda(
    [textSeed("role"), publicKey(lawyer).toBytes(), Uint8Array.of(3)],
    new PublicKey(config.whitelistProgramId),
  );
}

export interface LawyerConfirmDocumentsRequest {
  config: LegalClusterConfig;
  listingId: number | bigint | string;
  lawyer: LegalPublicKey;
  approve: boolean;
  documentsHash: Uint8Array;
}

export function buildLawyerConfirmDocumentsTransaction(request: LawyerConfirmDocumentsRequest): Transaction {
  assertClusterConfig(request.config);
  if (request.documentsHash.length !== 32 || request.documentsHash.every((byte) => byte === 0)) {
    throw new Error("INVALID_DOCUMENTS_HASH");
  }
  const lawyer = publicKey(request.lawyer);
  const keys: AccountMeta[] = [
    signer(lawyer),
    readonly(lawyerRolePda(lawyer, request.config)),
    writable(listingPda(request.listingId, request.config)),
  ];
  const data = concat(
    DISC_LAWYER_CONFIRM_DOCUMENTS,
    u64le(request.listingId),
    Uint8Array.of(request.approve ? 1 : 0),
    request.documentsHash,
  );
  return new Transaction().add(new TransactionInstruction({
    programId: marketplaceProgram(request.config),
    keys,
    data: data as unknown as Buffer,
  }));
}

export interface CollectedMint {
  mint: LegalPublicKey;
  tokenProgramId: LegalPublicKey;
}

export interface ExecuteDealInstructionRequest {
  config: LegalClusterConfig;
  payer: LegalPublicKey;
  listingId: number | bigint | string;
  regionId: number;
  developer: LegalPublicKey;
  developerLawyer: LegalPublicKey;
  spvLawyer: LegalPublicKey;
  xcavMint: LegalPublicKey;
  xcavTokenProgramId: LegalPublicKey;
  treasury: LegalPublicKey;
  regionOwner: LegalPublicKey;
  paymentTokenProgramId: LegalPublicKey;
  collectedMints: readonly CollectedMint[];
}

export function associatedTokenAddress(
  owner: LegalPublicKey,
  mint: LegalPublicKey,
  tokenProgramId: LegalPublicKey,
  config: LegalClusterConfig,
): PublicKey {
  return pda(
    [publicKey(owner).toBytes(), publicKey(tokenProgramId).toBytes(), publicKey(mint).toBytes()],
    new PublicKey(config.associatedTokenProgramId),
  );
}

export function buildExecuteDealInstruction(request: ExecuteDealInstructionRequest): TransactionInstruction {
  assertClusterConfig(request.config);
  const payer = publicKey(request.payer);
  const developer = publicKey(request.developer);
  const developerLawyer = publicKey(request.developerLawyer);
  const spvLawyer = publicKey(request.spvLawyer);
  const xcavMint = publicKey(request.xcavMint);
  const xcavTokenProgram = publicKey(request.xcavTokenProgramId);
  const paymentTokenProgram = publicKey(request.paymentTokenProgramId);
  const treasury = publicKey(request.treasury);
  const regionOwner = publicKey(request.regionOwner);
  const listingVault = listingVaultPda(request.listingId, request.config);
  const keys: AccountMeta[] = [
    signer(payer),
    readonly(configPda(request.config)),
    writable(listingPda(request.listingId, request.config)),
    writable(propertyPda(request.listingId, request.config)),
    readonly(regionPda(request.regionId, request.config)),
    writable(lawyerRegistryPda(developerLawyer, request.config)),
    writable(lawyerRegistryPda(spvLawyer, request.config)),
    readonly(listingVault),
    readonly(xcavMint),
    writable(associatedTokenAddress(developer, xcavMint, xcavTokenProgram, request.config)),
    writable(marketplaceVaultPda(request.config)),
    readonly(xcavTokenProgram),
    readonly(paymentTokenProgram),
  ];
  const seen = new Set<string>();
  for (const collected of request.collectedMints) {
    const mint = publicKey(collected.mint);
    const tokenProgram = publicKey(collected.tokenProgramId);
    if (seen.has(mint.toBase58())) {
      throw new Error("DUPLICATE_COLLECTED_MINT");
    }
    seen.add(mint.toBase58());
    keys.push(
      readonly(mint),
      writable(associatedTokenAddress(listingVault, mint, tokenProgram, request.config)),
      writable(associatedTokenAddress(developer, mint, tokenProgram, request.config)),
      writable(associatedTokenAddress(developerLawyer, mint, tokenProgram, request.config)),
      writable(associatedTokenAddress(spvLawyer, mint, tokenProgram, request.config)),
      writable(associatedTokenAddress(regionOwner, mint, tokenProgram, request.config)),
      writable(associatedTokenAddress(treasury, mint, tokenProgram, request.config)),
    );
  }
  return new TransactionInstruction({
    programId: marketplaceProgram(request.config),
    keys,
    data: concat(DISC_EXECUTE_DEAL, u64le(request.listingId)) as unknown as Buffer,
  });
}

export interface ExecuteDealPreparationRequest {
  config: LegalClusterConfig;
  payer: LegalPublicKey;
  listingId: number | bigint | string;
  regionId: number;
  developer: LegalPublicKey;
  developerLawyer: LegalPublicKey;
  spvLawyer: LegalPublicKey;
  collectedMints: readonly LegalPublicKey[];
}

export interface PreparedLegalTransactions {
  transactions: LegalTransaction[];
  lookupTableAddress?: PublicKey;
}

interface ChainAccounts {
  xcavMint: PublicKey;
  treasury: PublicKey;
  regionOwner: PublicKey;
  xcavTokenProgram: PublicKey;
  paymentTokenProgram: PublicKey;
  collectedMints: CollectedMint[];
}

function readPublicKey(data: Buffer, offset: number): PublicKey {
  return new PublicKey(data.subarray(offset, offset + 32));
}

function requiredAccount<T>(account: T | null | undefined, label: string): T {
  if (!account) {
    throw new Error(`MISSING_${label}_ACCOUNT`);
  }
  return account;
}

function assertTokenProgram(programId: PublicKey): void {
  if (!programId.equals(TOKEN_PROGRAM_ID) && !programId.equals(TOKEN_2022_PROGRAM_ID)) {
    throw new Error("UNSUPPORTED_TOKEN_PROGRAM");
  }
}

async function loadChainAccounts(
  request: ExecuteDealPreparationRequest,
  connection: Connection,
): Promise<ChainAccounts> {
  const configAddress = configPda(request.config);
  const regionAddress = regionPda(request.regionId, request.config);
  const mintAddresses = request.collectedMints.map(publicKey);
  const accounts = await connection.getMultipleAccountsInfo([configAddress, regionAddress, ...mintAddresses]);
  const configInfo = requiredAccount(accounts[0], "CONFIG");
  const regionInfo = requiredAccount(accounts[1], "REGION");
  if (!configInfo.owner.equals(marketplaceProgram(request.config)) || configInfo.data.length < 41) {
    throw new Error("INVALID_CONFIG_ACCOUNT");
  }
  if (!regionInfo.owner.equals(new PublicKey(request.config.regionsProgramId)) || regionInfo.data.length < 42) {
    throw new Error("INVALID_REGION_ACCOUNT");
  }
  const pendingAuthorityTag = configInfo.data[40];
  if (pendingAuthorityTag !== 0 && pendingAuthorityTag !== 1) {
    throw new Error("INVALID_CONFIG_ACCOUNT");
  }
  const xcavOffset = 41 + (pendingAuthorityTag === 1 ? 32 : 0);
  if (configInfo.data.length < xcavOffset + 64) {
    throw new Error("INVALID_CONFIG_ACCOUNT");
  }
  if (regionInfo.data.readUInt16LE(8) !== request.regionId) {
    throw new Error("REGION_ID_MISMATCH");
  }
  const xcavMint = readPublicKey(configInfo.data, xcavOffset);
  const treasury = readPublicKey(configInfo.data, xcavOffset + 32);
  const regionOwner = readPublicKey(regionInfo.data, 10);
  const mintOwners = new Map< string, PublicKey>();
  for (const [index, mint] of mintAddresses.entries()) {
    const info = requiredAccount(accounts[index + 2], "MINT");
    if (!mintOwners.has(mint.toBase58())) {
      assertTokenProgram(info.owner);
      mintOwners.set(mint.toBase58(), info.owner);
    }
  }
  const xcavInfo = requiredAccount(
    (await connection.getMultipleAccountsInfo([xcavMint]))[0],
    "XCAV_MINT",
  );
  assertTokenProgram(xcavInfo.owner);
  const paymentPrograms = [...new Set([...mintOwners.values()].map((owner) => owner.toBase58()))]
    .map((owner) => new PublicKey(owner));
  const unsupported = paymentPrograms.find((program) => !program.equals(xcavInfo.owner) && paymentPrograms.length > 2);
  if (unsupported) {
    throw new Error("TOO_MANY_TOKEN_PROGRAMS");
  }
  const paymentTokenProgram = paymentPrograms.find((program) => !program.equals(xcavInfo.owner))
    ?? paymentPrograms[0]
    ?? xcavInfo.owner;
  return {
    xcavMint,
    treasury,
    regionOwner,
    xcavTokenProgram: xcavInfo.owner,
    paymentTokenProgram,
    collectedMints: mintAddresses.map((mint) => ({
      mint,
      tokenProgramId: mintOwners.get(mint.toBase58())!,
    })),
  };
}

function createAtaInstruction(
  payer: PublicKey,
  address: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
  tokenProgram: PublicKey,
  config: LegalClusterConfig,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(config.associatedTokenProgramId),
    keys: [
      signer(payer, true),
      writable(address),
      readonly(owner),
      readonly(mint),
      readonly(new PublicKey(config.systemProgramId)),
      readonly(tokenProgram),
    ],
  });
}

function legacyTransaction(instructions: TransactionInstruction[], payer: PublicKey): Transaction {
  const transaction = new Transaction();
  transaction.feePayer = payer;
  transaction.recentBlockhash = PLACEHOLDER_BLOCKHASH;
  transaction.add(...instructions);
  return transaction;
}

function transactionSize(transaction: LegalTransaction): number {
  try {
    return transaction instanceof Transaction
      ? transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).length
      : transaction.serialize().length;
  } catch (error) {
    if (transaction instanceof Transaction && error instanceof Error && (
      error instanceof RangeError || error.message.startsWith("Transaction too large:")
    )) {
      return PACKET_DATA_SIZE + 1;
    }
    throw error;
  }
}

function packLegacyInstructions(instructions: TransactionInstruction[], payer: PublicKey): Transaction[] {
  const batches: TransactionInstruction[][] = [];
  let current: TransactionInstruction[] = [];
  for (const instruction of instructions) {
    const candidate = [...current, instruction];
    if (transactionSize(legacyTransaction(candidate, payer)) > PACKET_DATA_SIZE) {
      if (current.length === 0) {
        throw new Error("TRANSACTION_PACKET_TOO_LARGE");
      }
      batches.push(current);
      current = [instruction];
      if (transactionSize(legacyTransaction(current, payer)) > PACKET_DATA_SIZE) {
        throw new Error("TRANSACTION_PACKET_TOO_LARGE");
      }
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) {
    batches.push(current);
  }
  return batches.map((batch) => legacyTransaction(batch, payer));
}

async function prepareMissingTokenAccounts(
  request: ExecuteDealPreparationRequest,
  chain: ChainAccounts,
  connection: Connection,
): Promise<TransactionInstruction[]> {
  const payer = publicKey(request.payer);
  const developer = publicKey(request.developer);
  const owners = [developer, publicKey(request.developerLawyer), publicKey(request.spvLawyer), chain.regionOwner, chain.treasury];
  const targets: { address: PublicKey; owner: PublicKey; mint: PublicKey; tokenProgram: PublicKey }[] = [{
    address: associatedTokenAddress(developer, chain.xcavMint, chain.xcavTokenProgram, request.config),
    owner: developer,
    mint: chain.xcavMint,
    tokenProgram: chain.xcavTokenProgram,
  }];
  for (const collected of chain.collectedMints) {
    const mint = publicKey(collected.mint);
    const tokenProgram = publicKey(collected.tokenProgramId);
    for (const owner of owners) {
      targets.push({
        address: associatedTokenAddress(owner, mint, tokenProgram, request.config),
        owner,
        mint,
        tokenProgram,
      });
    }
  }
  const infos = await connection.getMultipleAccountsInfo(targets.map((target) => target.address));
  const instructions: TransactionInstruction[] = [];
  for (const [index, target] of targets.entries()) {
    const info = infos[index];
    if (!info) {
      instructions.push(createAtaInstruction(
        payer,
        target.address,
        target.owner,
        target.mint,
        target.tokenProgram,
        request.config,
      ));
      continue;
    }
    if (
      !info.owner.equals(target.tokenProgram)
      || info.data.length < 72
      || !readPublicKey(info.data, 0).equals(target.mint)
      || !readPublicKey(info.data, 32).equals(target.owner)
    ) {
      throw new Error("INVALID_TOKEN_ACCOUNT");
    }
  }
  return instructions;
}

function lookupAddresses(instruction: TransactionInstruction, payer: PublicKey): PublicKey[] {
  const unique = new Map<string, PublicKey>();
  for (const key of [instruction.programId, ...instruction.keys.map((meta) => meta.pubkey)]) {
    if (!key.equals(payer)) {
      unique.set(key.toBase58(), key);
    }
  }
  if (unique.size > 256) {
    throw new Error("TOO_MANY_LOOKUP_TABLE_ADDRESSES");
  }
  return [...unique.values()];
}

export async function prepareExecuteDealTransactions(
  request: ExecuteDealPreparationRequest,
  options: { connection: Connection },
): Promise<PreparedLegalTransactions> {
  assertClusterConfig(request.config);
  const payer = publicKey(request.payer);
  const chain = await loadChainAccounts(request, options.connection);
  const preparationInstructions = await prepareMissingTokenAccounts(request, chain, options.connection);
  const transactions: LegalTransaction[] = packLegacyInstructions(preparationInstructions, payer);
  const settlementInstruction = buildExecuteDealInstruction({
    ...request,
    xcavMint: chain.xcavMint,
    xcavTokenProgramId: chain.xcavTokenProgram,
    treasury: chain.treasury,
    regionOwner: chain.regionOwner,
    paymentTokenProgramId: chain.paymentTokenProgram,
    collectedMints: chain.collectedMints,
  });
  const legacySettlement = legacyTransaction([settlementInstruction], payer);
  if (transactionSize(legacySettlement) <= PACKET_DATA_SIZE) {
    transactions.push(legacySettlement);
    return { transactions };
  }

  const recentSlot = await options.connection.getSlot("confirmed");
  const [createLookup, lookupTableAddress] = AddressLookupTableProgram.createLookupTable({
    authority: payer,
    payer,
    recentSlot,
  });
  transactions.push(...packLegacyInstructions([createLookup], payer));
  const addresses = lookupAddresses(settlementInstruction, payer);
  const extendInstructions: TransactionInstruction[] = [];
  for (let offset = 0; offset < addresses.length; offset += 20) {
    extendInstructions.push(AddressLookupTableProgram.extendLookupTable({
      lookupTable: lookupTableAddress,
      authority: payer,
      payer,
      addresses: addresses.slice(offset, offset + 20),
    }));
  }
  transactions.push(...packLegacyInstructions(extendInstructions, payer));
  const lookupTable: AddressLookupTableAccount = {
    key: lookupTableAddress,
    state: {
      deactivationSlot: LOOKUP_TABLE_DEACTIVATED,
      lastExtendedSlot: 0,
      lastExtendedSlotStartIndex: 0,
      authority: payer,
      addresses,
    },
    isActive: () => true,
  };
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: PLACEHOLDER_BLOCKHASH,
    instructions: [settlementInstruction],
  }).compileToV0Message([lookupTable]);
  const settlement = new VersionedTransaction(message);
  if (transactionSize(settlement) > PACKET_DATA_SIZE) {
    throw new Error("VERSIONED_TRANSACTION_PACKET_TOO_LARGE");
  }
  transactions.push(settlement);
  return { transactions, lookupTableAddress };
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

export interface LegalTransactionBridge {
  name: string;
  signAndSend(
    transaction: LegalTransaction,
    chain: string,
    signer: PublicKey,
  ): Promise<Uint8Array | string>;
}

function standardBridge(wallet: StandardWallet, feature: StandardSignAndSendFeature): LegalTransactionBridge {
  return {
    name: wallet.name,
    async signAndSend(transaction, chain, signerKey) {
      const serialized = transaction instanceof Transaction
        ? transaction.serialize({ requireAllSignatures: false, verifySignatures: false })
        : transaction.serialize();
      const [result] = await feature.signAndSendTransaction({
        account: { address: signerKey.toBase58() },
        transaction: serialized,
        chain,
      });
      if (!result?.signature) {
        throw new Error("WALLET_RETURNED_NO_SIGNATURE");
      }
      return result.signature;
    },
  };
}

function legacyBridge(name: string, provider: LegacySignAndSendProvider): LegalTransactionBridge {
  return {
    name,
    async signAndSend(transaction) {
      if (!(transaction instanceof Transaction)) {
        throw new Error("VERSIONED_TRANSACTION_UNSUPPORTED");
      }
      const result = await provider.signAndSendTransaction(transaction);
      return typeof result === "string" ? result : result.signature;
    },
  };
}

export function findLegalBridge(): LegalTransactionBridge | null {
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

function base58Encode(bytes: Uint8Array): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let index = 0; index < digits.length; index += 1) {
      carry += digits[index]! << 8;
      digits[index] = carry % 58;
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
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    out += alphabet[digits[index]!];
  }
  return out;
}

export interface LegalSubmissionOptions {
  connection?: Connection;
  bridge?: LegalTransactionBridge | null;
}

const LOOKUP_TABLE_ACTIVATION_TIMEOUT_MS = 30_000;

async function waitForActiveLookupTable(
  connection: Connection,
  lookupTableAddress: PublicKey,
): Promise<AddressLookupTableAccount> {
  const deadline = Date.now() + LOOKUP_TABLE_ACTIVATION_TIMEOUT_MS;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error("LOOKUP_TABLE_ACTIVATION_TIMEOUT");
    }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const { context, value } = await Promise.race([
      connection.getAddressLookupTable(lookupTableAddress, { commitment: "confirmed" }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("LOOKUP_TABLE_ACTIVATION_TIMEOUT")), remaining);
      }),
    ]).finally(() => clearTimeout(timeout));
    if (value?.isActive() && context.slot > value.state.lastExtendedSlot) {
      return value;
    }
    const delay = Math.min(400, deadline - Date.now());
    if (delay <= 0) {
      throw new Error("LOOKUP_TABLE_ACTIVATION_TIMEOUT");
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

export async function submitPreparedLegalTransactions(
  prepared: PreparedLegalTransactions,
  currentSigner: LegalPublicKey,
  config: LegalClusterConfig,
  options: LegalSubmissionOptions = {},
): Promise<{ signature: string; walletName: string }[]> {
  assertClusterConfig(config);
  const bridge = options.bridge === undefined ? findLegalBridge() : options.bridge;
  if (!bridge) {
    throw new Error("NO_SIGN_AND_SEND_WALLET");
  }
  const signerKey = publicKey(currentSigner);
  const connection = options.connection ?? new Connection(config.rpcUrl, "confirmed");
  const results: { signature: string; walletName: string }[] = [];
  for (const preparedTransaction of prepared.transactions) {
    let transaction = preparedTransaction;
    if (!(transaction instanceof Transaction) && prepared.lookupTableAddress) {
      const lookupTable = await waitForActiveLookupTable(connection, prepared.lookupTableAddress);
      const message = TransactionMessage.decompile(transaction.message, {
        addressLookupTableAccounts: [lookupTable],
      });
      transaction = new VersionedTransaction(message.compileToV0Message([lookupTable]));
    }
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    if (transaction instanceof Transaction) {
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = signerKey;
    } else {
      transaction.message.recentBlockhash = blockhash;
    }
    const simulation = transaction instanceof Transaction
      ? await connection.simulateTransaction(transaction)
      : await connection.simulateTransaction(transaction, { commitment: "confirmed" });
    if (simulation.value.err) {
      const logs = simulation.value.logs?.join("\n") ?? "";
      throw new Error(`TRANSACTION_SIMULATION_FAILED: ${JSON.stringify(simulation.value.err)}${logs ? `\n${logs}` : ""}`);
    }
    const rawSignature = await bridge.signAndSend(transaction, config.walletChain, signerKey);
    const signature = typeof rawSignature === "string" ? rawSignature : base58Encode(rawSignature);
    if (!signature) {
      throw new Error("WALLET_RETURNED_NO_SIGNATURE");
    }
    try {
      const confirmation = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
      if (confirmation.value.err) {
        throw new Error(JSON.stringify(confirmation.value.err));
      }
    } catch (error) {
      throw new Error(`TRANSACTION_CONFIRMATION_FAILED: ${error instanceof Error ? error.message : String(error)}`);
    }
    results.push({ signature, walletName: bridge.name });
  }
  return results;
}

export interface SubmitLawyerConfirmDocumentsRequest extends LawyerConfirmDocumentsRequest {
  assignedLawyers: readonly LegalPublicKey[];
}

export async function submitLawyerConfirmDocuments(
  request: SubmitLawyerConfirmDocumentsRequest,
  options: LegalSubmissionOptions = {},
): Promise<{ signature: string; walletName: string }> {
  const lawyer = publicKey(request.lawyer);
  if (!request.assignedLawyers.some((assigned) => publicKey(assigned).equals(lawyer))) {
    throw new Error("NOT_ASSIGNED_LAWYER");
  }
  const transaction = buildLawyerConfirmDocumentsTransaction(request);
  const [result] = await submitPreparedLegalTransactions({ transactions: [transaction] }, lawyer, request.config, options);
  return result!;
}

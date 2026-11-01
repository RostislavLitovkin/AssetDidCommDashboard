import { describe, expect, it, vi } from "vitest";
import {
  AddressLookupTableProgram,
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
  type AccountInfo,
  type AddressLookupTableAccount,
} from "@solana/web3.js";
import {
  buildExecuteDealInstruction,
  buildLawyerConfirmDocumentsTransaction,
  lawyerRolePda,
  prepareExecuteDealTransactions,
  submitLawyerConfirmDocuments,
  submitPreparedLegalTransactions,
  type LegalClusterConfig,
  type LegalTransactionBridge,
} from "../../app/services/lawyer/solanaLegal";
import { castVoteOnChain } from "../../app/services/voting/solanaVote";
import { getLegalClusterConfig } from "../../app/services/lawyer/cluster";

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const LAWYER = new PublicKey("4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM");
const DEVELOPER = new PublicKey(new Uint8Array(32).fill(11));
const DEVELOPER_LAWYER = LAWYER;
const SPV_LAWYER = new PublicKey(new Uint8Array(32).fill(13));
const REGION_OWNER = new PublicKey(new Uint8Array(32).fill(14));
const TREASURY = new PublicKey(new Uint8Array(32).fill(15));
const XCAV_MINT = new PublicKey(new Uint8Array(32).fill(16));
const PAYER = new PublicKey(new Uint8Array(32).fill(17));
const BLOCKHASH = new PublicKey(new Uint8Array(32).fill(18)).toBase58();

const DEVNET: LegalClusterConfig = {
  cluster: "devnet",
  marketplaceProgramId: "dj9Q3CpHvDHwexCbkgJ5APDx4JsTxPssNebkvP15g1T",
  whitelistProgramId: "7TrzjKpdrEhnfhxuw8tWdH1sjxadazscsG5HXCDPLmaY",
  regionsProgramId: "5iupkzVtWxee48UXh3s615V9sXXuYjsSr61VPuduXdPc",
  tokenProgramId: TOKEN_PROGRAM_ID.toBase58(),
  associatedTokenProgramId: ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
  systemProgramId: SystemProgram.programId.toBase58(),
  rpcUrl: "https://api.devnet.solana.com",
  walletChain: "solana:devnet",
  indexerGraphqlUrl: "https://indexer-devnet.xcavate.io/graphql",
  explorerCluster: "devnet",
};

function key(fill: number): PublicKey {
  return new PublicKey(new Uint8Array(32).fill(fill));
}

function u64le(value: number | bigint): number[] {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(value), true);
  return Array.from(out);
}

function ata(owner: PublicKey, mint: PublicKey, tokenProgram = TOKEN_PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBytes(), tokenProgram.toBytes(), mint.toBytes()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

function account(data: Buffer, owner: PublicKey): AccountInfo<Buffer> {
  return { data, owner, executable: false, lamports: 1 };
}

function configAccount(): AccountInfo<Buffer> {
  const data = Buffer.alloc(105);
  DEVELOPER.toBuffer().copy(data, 8);
  data[40] = 0;
  XCAV_MINT.toBuffer().copy(data, 41);
  TREASURY.toBuffer().copy(data, 73);
  return account(data, new PublicKey(DEVNET.marketplaceProgramId));
}

function regionAccount(regionId = 1): AccountInfo<Buffer> {
  const data = Buffer.alloc(42);
  data.writeUInt16LE(regionId, 8);
  REGION_OWNER.toBuffer().copy(data, 10);
  return account(data, new PublicKey(DEVNET.regionsProgramId));
}

function tokenAccount(mint: PublicKey, owner: PublicKey): AccountInfo<Buffer> {
  const data = Buffer.alloc(165);
  mint.toBuffer().copy(data, 0);
  owner.toBuffer().copy(data, 32);
  return account(data, TOKEN_PROGRAM_ID);
}

function prepareRequest(collectedMints: PublicKey[]) {
  return {
    config: DEVNET,
    payer: PAYER,
    listingId: 42,
    regionId: 1,
    developer: DEVELOPER,
    developerLawyer: DEVELOPER_LAWYER,
    spvLawyer: SPV_LAWYER,
    collectedMints,
  };
}

function fakePreparationConnection(mints: PublicKey[], existing = new Map<string, AccountInfo<Buffer>>()) {
  const accounts = new Map(existing);
  accounts.set("FvypPqraGoYskTM9jiUywfsdfTeoqkXg2RdPHuw5S7aK", configAccount());
  accounts.set("5qDQzydw8oSw7uCPThUihyo6yc1NZcWQkhhebDKpC6Cn", regionAccount());
  for (const mint of [XCAV_MINT, ...mints]) {
    accounts.set(mint.toBase58(), account(Buffer.alloc(82), TOKEN_PROGRAM_ID));
  }
  return {
    getMultipleAccountsInfo: vi.fn(async (keys: PublicKey[]) => keys.map((key) => accounts.get(key.toBase58()) ?? null)),
    getSlot: vi.fn(async () => 100),
  } as unknown as Connection;
}

function successfulSubmission() {
  const connection = {
    getLatestBlockhash: vi.fn(async () => ({ blockhash: BLOCKHASH, lastValidBlockHeight: 100 })),
    simulateTransaction: vi.fn(async () => ({ value: { err: null, logs: [] } })),
    confirmTransaction: vi.fn(async () => ({ value: { err: null } })),
  } as unknown as Connection;
  const bridge: LegalTransactionBridge = {
    name: "Test wallet",
    signAndSend: vi.fn(async () => new Uint8Array(64).fill(1)),
  };
  return { connection, bridge };
}

describe("lawyer_confirm_documents", () => {
  const documentsHash = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
  const tx = buildLawyerConfirmDocumentsTransaction({
    config: DEVNET,
    listingId: 42,
    lawyer: LAWYER,
    approve: true,
    documentsHash,
  });
  const ix = tx.instructions[0]!;

  it("encodes the Anchor discriminator, u64, bool, and 32-byte hash exactly", () => {
    expect(Array.from(ix.data)).toEqual([
      218, 145, 193, 157, 127, 110, 10, 94,
      ...u64le(42),
      1,
      ...documentsHash,
    ]);
    const rejected = buildLawyerConfirmDocumentsTransaction({
      config: DEVNET, listingId: 42, lawyer: LAWYER, approve: false, documentsHash,
    });
    expect(rejected.instructions[0]!.data[16]).toBe(0);
  });

  it("uses the lawyer role and listing PDAs with exact account flags", () => {
    expect(lawyerRolePda(LAWYER, DEVNET).toBase58()).toBe("DkiEQms6bCdSwxBU7ZydcPaD4cBQJwLU1dG4hfcbL5wG");
    expect(ix.programId.toBase58()).toBe(DEVNET.marketplaceProgramId);
    expect(ix.keys.map((meta) => [meta.pubkey.toBase58(), meta.isSigner, meta.isWritable])).toEqual([
      [LAWYER.toBase58(), true, false],
      ["DkiEQms6bCdSwxBU7ZydcPaD4cBQJwLU1dG4hfcbL5wG", false, false],
      ["Da9GJLvR88quSajqF6uuRWwakEFyUxvjxZu35UYRGqCS", false, true],
    ]);
  });

  it("rejects missing, zero, and incorrectly sized document hashes", () => {
    for (const hash of [new Uint8Array(32), new Uint8Array(31), new Uint8Array(33)]) {
      expect(() => buildLawyerConfirmDocumentsTransaction({
        config: DEVNET, listingId: 42, lawyer: LAWYER, approve: true, documentsHash: hash,
      })).toThrow("INVALID_DOCUMENTS_HASH");
    }
  });

  it("fails closed before wallet submission when the signer is not an assigned seat", async () => {
    const { connection, bridge } = successfulSubmission();
    await expect(submitLawyerConfirmDocuments({
      config: DEVNET,
      listingId: 42,
      lawyer: PAYER,
      assignedLawyers: [DEVELOPER_LAWYER, SPV_LAWYER],
      approve: true,
      documentsHash,
    }, { connection, bridge })).rejects.toThrow("NOT_ASSIGNED_LAWYER");
    expect(bridge.signAndSend).not.toHaveBeenCalled();
  });
});

describe("execute_deal instruction", () => {
  const mintA = key(21);
  const mintB = key(22);
  const ix = buildExecuteDealInstruction({
    config: DEVNET,
    payer: PAYER,
    listingId: 42,
    regionId: 1,
    developer: DEVELOPER,
    developerLawyer: DEVELOPER_LAWYER,
    spvLawyer: SPV_LAWYER,
    xcavMint: XCAV_MINT,
    xcavTokenProgramId: TOKEN_PROGRAM_ID,
    treasury: TREASURY,
    regionOwner: REGION_OWNER,
    paymentTokenProgramId: TOKEN_PROGRAM_ID,
    collectedMints: [
      { mint: mintA, tokenProgramId: TOKEN_PROGRAM_ID },
      { mint: mintB, tokenProgramId: TOKEN_2022_PROGRAM_ID },
    ],
  });

  it("encodes execute_deal and its u64 argument", () => {
    expect(ix.programId.toBase58()).toBe(DEVNET.marketplaceProgramId);
    expect(Array.from(ix.data)).toEqual([107, 92, 176, 235, 53, 80, 14, 94, ...u64le(42)]);
  });

  it("uses all 13 fixed accounts in deployed order with correct flags", () => {
    const expected: [string, boolean, boolean][] = [
      [PAYER.toBase58(), true, false],
      ["FvypPqraGoYskTM9jiUywfsdfTeoqkXg2RdPHuw5S7aK", false, false],
      ["Da9GJLvR88quSajqF6uuRWwakEFyUxvjxZu35UYRGqCS", false, true],
      ["EYzsprEpwDcAQ4tCPQaMGqP4L2k2acWirrtkhzMWM3Nz", false, true],
      ["5qDQzydw8oSw7uCPThUihyo6yc1NZcWQkhhebDKpC6Cn", false, false],
      ["E1HB7hkxBtDt8qABxS7wHeF7vRy6ZyBXFaTRaxPA8uW2", false, true],
      [PublicKey.findProgramAddressSync([Buffer.from("lawyer"), SPV_LAWYER.toBytes()], new PublicKey(DEVNET.marketplaceProgramId))[0].toBase58(), false, true],
      ["9P4XoYybtrh7ZPnDWRFY2GCxiyVcNUQ5Jw5EkK7WLvRZ", false, false],
      [XCAV_MINT.toBase58(), false, false],
      [ata(DEVELOPER, XCAV_MINT).toBase58(), false, true],
      ["B5hhQpd5585UgVKNJyvsxb26eZxPeJeosRtm6Qj37LS3", false, true],
      [TOKEN_PROGRAM_ID.toBase58(), false, false],
      [TOKEN_PROGRAM_ID.toBase58(), false, false],
    ];
    expect(ix.keys.slice(0, 13).map((meta) => [meta.pubkey.toBase58(), meta.isSigner, meta.isWritable])).toEqual(expected);
  });

  it("preserves collected order and seven-per-mint account order using actual token programs", () => {
    const listingVault = new PublicKey("9P4XoYybtrh7ZPnDWRFY2GCxiyVcNUQ5Jw5EkK7WLvRZ");
    const expected = [mintA, mintB].flatMap((mint, index) => {
      const tokenProgram = index === 0 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;
      return [
        mint,
        ata(listingVault, mint, tokenProgram),
        ata(DEVELOPER, mint, tokenProgram),
        ata(DEVELOPER_LAWYER, mint, tokenProgram),
        ata(SPV_LAWYER, mint, tokenProgram),
        ata(REGION_OWNER, mint, tokenProgram),
        ata(TREASURY, mint, tokenProgram),
      ];
    });
    expect(ix.keys).toHaveLength(27);
    expect(ix.keys.slice(13).map((meta) => meta.pubkey.toBase58())).toEqual(expected.map((key) => key.toBase58()));
    expect(ix.keys.slice(13).every((meta, index) => meta.isSigner === false && meta.isWritable === (index % 7 !== 0))).toBe(true);
  });
});

describe("execute_deal preparation", () => {
  it("derives missing payee and developer XCAV ATAs into separate transactions", async () => {
    const mint = key(21);
    const connection = fakePreparationConnection([mint]);
    const prepared = await prepareExecuteDealTransactions(prepareRequest([mint]), { connection });
    const createInstructions = prepared.transactions.flatMap((transaction) =>
      transaction instanceof Transaction ? transaction.instructions : [],
    ).filter((instruction) => instruction.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID));
    expect(createInstructions.map((instruction) => instruction.keys[1]!.pubkey.toBase58())).toEqual([
      ata(DEVELOPER, XCAV_MINT).toBase58(),
      ata(DEVELOPER, mint).toBase58(),
      ata(DEVELOPER_LAWYER, mint).toBase58(),
      ata(SPV_LAWYER, mint).toBase58(),
      ata(REGION_OWNER, mint).toBase58(),
      ata(TREASURY, mint).toBase58(),
    ]);
    expect(prepared.transactions.at(-1)).toBeInstanceOf(Transaction);
    for (const transaction of prepared.transactions) {
      const size = transaction instanceof Transaction
        ? transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).length
        : transaction.serialize().length;
      expect(size).toBeLessThanOrEqual(1232);
    }
  });

  it("does not recreate an existing valid associated token account", async () => {
    const mint = key(21);
    const existing = new Map([[ata(TREASURY, mint).toBase58(), tokenAccount(mint, TREASURY)]]);
    const prepared = await prepareExecuteDealTransactions(prepareRequest([mint]), {
      connection: fakePreparationConnection([mint], existing),
    });
    const created = prepared.transactions.flatMap((transaction) =>
      transaction instanceof Transaction ? transaction.instructions : [],
    ).filter((instruction) => instruction.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID));
    expect(created).toHaveLength(5);
    expect(created.some((instruction) => instruction.keys[1]!.pubkey.equals(ata(TREASURY, mint)))).toBe(false);
  });

  it("rejects an existing token account with the wrong owner or mint", async () => {
    const mint = key(21);
    const existing = new Map([[ata(TREASURY, mint).toBase58(), tokenAccount(mint, DEVELOPER)]]);
    await expect(prepareExecuteDealTransactions(prepareRequest([mint]), {
      connection: fakePreparationConnection([mint], existing),
    })).rejects.toThrow("INVALID_TOKEN_ACCOUNT");
  });

  it("uses versioned settlement and a created address lookup table instead of dropping accounts", async () => {
    const mints = [21, 22, 23, 24].map(key);
    const prepared = await prepareExecuteDealTransactions(prepareRequest(mints), {
      connection: fakePreparationConnection(mints),
    });
    const settlement = prepared.transactions.at(-1);
    expect(settlement).toBeInstanceOf(VersionedTransaction);
    expect(prepared.lookupTableAddress).toBeDefined();
    expect(settlement instanceof VersionedTransaction ? settlement.message.addressTableLookups : []).toHaveLength(1);
    const staticAndLookedUp = settlement instanceof VersionedTransaction
      ? settlement.message.staticAccountKeys.length + settlement.message.addressTableLookups[0]!.writableIndexes.length + settlement.message.addressTableLookups[0]!.readonlyIndexes.length
      : 0;
    expect(staticAndLookedUp).toBeGreaterThanOrEqual(41);
    for (const transaction of prepared.transactions) {
      const size = transaction instanceof Transaction
        ? transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).length
        : transaction.serialize().length;
      expect(size).toBeLessThanOrEqual(1232);
    }
  });

  it("keeps mainnet chain configuration explicit without devnet fallback", async () => {
    const mainnet: LegalClusterConfig = {
      ...DEVNET,
      cluster: "mainnet",
      walletChain: "solana:mainnet",
      rpcUrl: "https://api.mainnet-beta.solana.com",
      explorerCluster: null,
    };
    const tx = buildLawyerConfirmDocumentsTransaction({
      config: mainnet, listingId: 42, lawyer: LAWYER, approve: true, documentsHash: new Uint8Array(32).fill(1),
    });
    expect(tx.instructions[0]!.programId.toBase58()).toBe(mainnet.marketplaceProgramId);
    const { connection, bridge } = successfulSubmission();
    await expect(submitLawyerConfirmDocuments({
      config: { ...mainnet, walletChain: "solana:devnet" },
      listingId: 42,
      lawyer: LAWYER,
      assignedLawyers: [LAWYER],
      approve: true,
      documentsHash: new Uint8Array(32).fill(1),
    }, { connection, bridge })).rejects.toThrow("CLUSTER_CONFIG_MISMATCH");
    expect(bridge.signAndSend).not.toHaveBeenCalled();
  });

  it("consumes the shared Task 2 cluster config and wallet chain", async () => {
    const config = getLegalClusterConfig("devnet") as unknown as LegalClusterConfig;
    const { connection, bridge } = successfulSubmission();
    await submitLawyerConfirmDocuments({
      config,
      listingId: 42,
      lawyer: LAWYER,
      assignedLawyers: [LAWYER],
      approve: true,
      documentsHash: new Uint8Array(32).fill(1),
    }, { connection, bridge });
    expect(bridge.signAndSend).toHaveBeenCalledWith(expect.any(Transaction), "solana:devnet", LAWYER);
  });
});

describe("transaction submission", () => {
  it("simulates before signing and returns confirmed signatures", async () => {
    const { connection, bridge } = successfulSubmission();
    const tx = buildLawyerConfirmDocumentsTransaction({
      config: DEVNET, listingId: 42, lawyer: LAWYER, approve: true, documentsHash: new Uint8Array(32).fill(1),
    });
    const result = await submitPreparedLegalTransactions({ transactions: [tx] }, LAWYER, DEVNET, { connection, bridge });
    expect(connection.simulateTransaction).toHaveBeenCalledTimes(1);
    expect(bridge.signAndSend).toHaveBeenCalledTimes(1);
    expect(connection.confirmTransaction).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
    expect(result[0]!.signature).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
  });

  it("waits for a new lookup table to activate, then recompiles and submits the versioned settlement", async () => {
    const { connection, bridge } = successfulSubmission();
    const recipient = key(30);
    const [createLookup, lookupTableAddress] = AddressLookupTableProgram.createLookupTable({
      authority: PAYER,
      payer: PAYER,
      recentSlot: 100,
    });
    const addresses = [SystemProgram.programId, recipient];
    const extendLookup = AddressLookupTableProgram.extendLookupTable({
      lookupTable: lookupTableAddress,
      authority: PAYER,
      payer: PAYER,
      addresses,
    });
    const lookupTable: AddressLookupTableAccount = {
      key: lookupTableAddress,
      state: {
        deactivationSlot: 18446744073709551615n,
        lastExtendedSlot: 100,
        lastExtendedSlotStartIndex: 0,
        authority: PAYER,
        addresses,
      },
      isActive: () => true,
    };
    const settlement = new VersionedTransaction(new TransactionMessage({
      payerKey: PAYER,
      recentBlockhash: BLOCKHASH,
      instructions: [SystemProgram.transfer({ fromPubkey: PAYER, toPubkey: recipient, lamports: 1 })],
    }).compileToV0Message([lookupTable]));
    const getAddressLookupTable = vi.fn()
      .mockResolvedValueOnce({ context: { slot: 100 }, value: lookupTable })
      .mockResolvedValueOnce({ context: { slot: 101 }, value: lookupTable });
    Object.assign(connection, { getAddressLookupTable });

    await submitPreparedLegalTransactions({
      transactions: [new Transaction().add(createLookup), new Transaction().add(extendLookup), settlement],
      lookupTableAddress,
    }, PAYER, DEVNET, { connection, bridge });

    expect(getAddressLookupTable).toHaveBeenCalledTimes(2);
    const confirmationOrder = vi.mocked(connection.confirmTransaction).mock.invocationCallOrder;
    const simulationOrder = vi.mocked(connection.simulateTransaction).mock.invocationCallOrder;
    expect(getAddressLookupTable.mock.invocationCallOrder[0]).toBeGreaterThan(confirmationOrder[1]!);
    expect(getAddressLookupTable.mock.invocationCallOrder[1]).toBeLessThan(simulationOrder[2]!);
    const simulatedSettlement = vi.mocked(connection.simulateTransaction).mock.calls[2]![0];
    expect(simulatedSettlement).toBeInstanceOf(VersionedTransaction);
    expect(simulatedSettlement).not.toBe(settlement);
    expect(bridge.signAndSend).toHaveBeenNthCalledWith(3, simulatedSettlement, "solana:devnet", PAYER);
  });

  it("rejects when lookup table activation does not complete before the timeout", async () => {
    vi.useFakeTimers();
    try {
      const { connection, bridge } = successfulSubmission();
      const recipient = key(30);
      const lookupTableAddress = key(31);
      const addresses = [SystemProgram.programId, recipient];
      const lookupTable: AddressLookupTableAccount = {
        key: lookupTableAddress,
        state: {
          deactivationSlot: 18446744073709551615n,
          lastExtendedSlot: 100,
          lastExtendedSlotStartIndex: 0,
          authority: PAYER,
          addresses,
        },
        isActive: () => false,
      };
      const settlement = new VersionedTransaction(new TransactionMessage({
        payerKey: PAYER,
        recentBlockhash: BLOCKHASH,
        instructions: [SystemProgram.transfer({ fromPubkey: PAYER, toPubkey: recipient, lamports: 1 })],
      }).compileToV0Message([lookupTable]));
      Object.assign(connection, {
        getAddressLookupTable: vi.fn(async () => ({ context: { slot: 101 }, value: lookupTable })),
      });

      let outcome: unknown;
      const submission = submitPreparedLegalTransactions({
        transactions: [settlement],
        lookupTableAddress,
      }, PAYER, DEVNET, { connection, bridge }).catch((error) => {
        outcome = error;
      });
      await vi.advanceTimersByTimeAsync(30_000);

      expect(outcome).toBeInstanceOf(Error);
      expect((outcome as Error).message).toBe("LOOKUP_TABLE_ACTIVATION_TIMEOUT");
      expect(bridge.signAndSend).not.toHaveBeenCalled();
      await submission;
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it("rejects simulation value.err and never asks the wallet to sign", async () => {
    const { connection, bridge } = successfulSubmission();
    vi.mocked(connection.simulateTransaction).mockResolvedValue({ value: { err: { InstructionError: [0, "Custom"] }, logs: ["failed"] } } as never);
    const tx = buildLawyerConfirmDocumentsTransaction({
      config: DEVNET, listingId: 42, lawyer: LAWYER, approve: true, documentsHash: new Uint8Array(32).fill(1),
    });
    await expect(submitPreparedLegalTransactions({ transactions: [tx] }, LAWYER, DEVNET, { connection, bridge }))
      .rejects.toThrow("TRANSACTION_SIMULATION_FAILED");
    expect(bridge.signAndSend).not.toHaveBeenCalled();
  });

  it("rejects confirmation value.err instead of reporting success", async () => {
    const { connection, bridge } = successfulSubmission();
    vi.mocked(connection.confirmTransaction).mockResolvedValue({ value: { err: "BlockhashNotFound" } } as never);
    const tx = buildLawyerConfirmDocumentsTransaction({
      config: DEVNET, listingId: 42, lawyer: LAWYER, approve: true, documentsHash: new Uint8Array(32).fill(1),
    });
    await expect(submitPreparedLegalTransactions({ transactions: [tx] }, LAWYER, DEVNET, { connection, bridge }))
      .rejects.toThrow("TRANSACTION_CONFIRMATION_FAILED");
  });

  it("propagates wallet rejection as an error", async () => {
    const { connection, bridge } = successfulSubmission();
    vi.mocked(bridge.signAndSend).mockRejectedValue(new Error("USER_REJECTED"));
    const tx = buildLawyerConfirmDocumentsTransaction({
      config: DEVNET, listingId: 42, lawyer: LAWYER, approve: true, documentsHash: new Uint8Array(32).fill(1),
    });
    await expect(submitPreparedLegalTransactions({ transactions: [tx] }, LAWYER, DEVNET, { connection, bridge }))
      .rejects.toThrow("USER_REJECTED");
    expect(connection.confirmTransaction).not.toHaveBeenCalled();
  });
});

describe("existing vote submission confirmation", () => {
  function voteSubmission() {
    const tx = buildLawyerConfirmDocumentsTransaction({
      config: DEVNET, listingId: 42, lawyer: LAWYER, approve: true, documentsHash: new Uint8Array(32).fill(1),
    });
    const bridge: LegalTransactionBridge = {
      name: "Test wallet",
      signAndSend: vi.fn(async () => new Uint8Array(64).fill(1)),
    };
    vi.spyOn(Connection.prototype, "getLatestBlockhash").mockResolvedValue({ blockhash: BLOCKHASH, lastValidBlockHeight: 100 });
    return { tx, bridge };
  }

  it("rejects a confirmation response containing value.err", async () => {
    const { tx, bridge } = voteSubmission();
    vi.spyOn(Connection.prototype, "confirmTransaction").mockResolvedValue({ context: { slot: 0 }, value: { err: "BlockhashNotFound" } });
    try {
      await expect(castVoteOnChain(tx, LAWYER.toBase58(), { bridge })).rejects.toThrow("TRANSACTION_CONFIRMATION_FAILED");
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("does not swallow a thrown confirmation failure", async () => {
    const { tx, bridge } = voteSubmission();
    vi.spyOn(Connection.prototype, "confirmTransaction").mockRejectedValue(new Error("RPC_UNAVAILABLE"));
    try {
      await expect(castVoteOnChain(tx, LAWYER.toBase58(), { bridge })).rejects.toThrow("TRANSACTION_CONFIRMATION_FAILED");
    } finally {
      vi.restoreAllMocks();
    }
  });
});

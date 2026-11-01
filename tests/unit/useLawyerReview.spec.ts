import { PublicKey, type Connection } from "@solana/web3.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiMessage } from "../../app/services/buckets/types";
import type { LegalTransactionBridge } from "../../app/services/lawyer/solanaLegal";
import { useLawyerReview, type LawyerDocumentSource } from "../../app/composables/useLawyerReview";

const solanaMocks = vi.hoisted(() => ({
  submitConfirmation: vi.fn(),
  prepareExecution: vi.fn(),
  submitPrepared: vi.fn(),
}));

vi.mock("../../app/services/lawyer/solanaLegal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../app/services/lawyer/solanaLegal")>();
  return {
    ...actual,
    submitLawyerConfirmDocuments: solanaMocks.submitConfirmation,
    prepareExecuteDealTransactions: solanaMocks.prepareExecution,
    submitPreparedLegalTransactions: solanaMocks.submitPrepared,
  };
});

const SPV = new PublicKey(new Uint8Array(32).fill(1)).toBase58();
const DEVELOPER = new PublicKey(new Uint8Array(32).fill(2)).toBase58();
const OTHER = new PublicKey(new Uint8Array(32).fill(3)).toBase58();
const REPLACEMENT = new PublicKey(new Uint8Array(32).fill(4)).toBase58();
const DOCUMENT_HASH = "0xfa7b1589b5bbf56990e5bd1f31a54473064f4e2b52e587bacb3ef7389a9a847c";

let sequence = 0;
function message(overrides: Partial<ApiMessage> = {}): ApiMessage {
  sequence += 1;
  return {
    id: `row-${sequence}`,
    messageId: String(sequence),
    bucketId: "39",
    contributor: "Admin",
    reference: sequence % 2 === 0 ? "developer-cid" : "spv-cid",
    tag: "lawyer/terms-document",
    description: "terms.pdf",
    contentType: "application/pdf",
    contentHash: null,
    ipfsContent: null,
    createdAt: new Date(Date.UTC(2026, 9, 1, 12, 0, sequence)).toISOString(),
    ...overrides,
  };
}

function initialMessages(): ApiMessage[] {
  return [
    message({ reference: "spv-cid", description: "spv.pdf" }),
    message({ reference: "developer-cid", description: "developer.pdf" }),
  ];
}

function reviewBucket(cluster: "devnet" | "mainnet" = "devnet") {
  return {
    category: "lawyer-document-review",
    properties: JSON.stringify({
      property_id: "42",
      listing_id: "42",
      cluster,
      spv_lawyer: SPV,
      developer_lawyer: DEVELOPER,
    }),
  };
}

function indexerPayload(overrides: Record<string, unknown> = {}, settlement: Record<string, unknown> | null = null) {
  return {
    data: {
      listings: {
        nodes: [{
          listingId: "42",
          assetId: "42",
          spvLawyer: SPV,
          spvLawyerDocStatus: "PENDING",
          spvLawyerDocumentsHash: "0x00",
          developerLawyer: DEVELOPER,
          developerLawyerDocStatus: "PENDING",
          developerLawyerDocumentsHash: "0x00",
          secondAttempt: false,
          status: "SOLD_OUT",
          legalDeadline: 1_900_000_000,
          ...overrides,
        }],
      },
      pendingFinalizations: { executeDeal: settlement },
    },
  };
}

function legalPayload() {
  return indexerPayload({
    spvLawyerDocStatus: "APPROVED",
    spvLawyerDocumentsHash: DOCUMENT_HASH,
    developerLawyerDocStatus: "APPROVED",
    developerLawyerDocumentsHash: DOCUMENT_HASH,
    status: "LEGAL",
  }, {
    regionId: 7,
    developer: "DeveloperAccount",
    developerLawyer: DEVELOPER,
    spvLawyer: SPV,
    xcavMint: "XcavMint",
    treasury: "Treasury",
    acceptedPaymentMints: [],
    collectedMints: ["MintB", "MintA"],
  });
}

function setup(payload: unknown = indexerPayload(), cluster: "devnet" | "mainnet" = "devnet") {
  const fetcher = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => payload,
  })) as unknown as typeof fetch;
  const loadDocument = vi.fn(async (source: LawyerDocumentSource) => (
    source.message.reference === "spv-cid" ? Uint8Array.of(1, 2, 3) : Uint8Array.of(4, 5)
  ));
  const connection = { name: "injected-rpc" } as unknown as Connection;
  const bridge: LegalTransactionBridge = {
    name: "Injected wallet",
    signAndSend: vi.fn(),
  };
  const review = useLawyerReview({
    loadDocument,
    indexer: { fetcher },
    submission: { connection, bridge },
    now: () => 1_800_000_000_000,
  });
  return {
    review,
    fetcher,
    loadDocument,
    connection,
    bridge,
    input: (walletAddress: string | null = SPV, messages = initialMessages()) => ({
      bucket: reviewBucket(cluster),
      messages,
      walletAddress,
    }),
  };
}

beforeEach(() => {
  solanaMocks.submitConfirmation.mockResolvedValue({ signature: "confirm-signature", walletName: "Injected wallet" });
  solanaMocks.prepareExecution.mockResolvedValue({ transactions: [] });
  solanaMocks.submitPrepared.mockResolvedValue([{ signature: "execute-signature", walletName: "Injected wallet" }]);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function fetchResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  } as Response;
}

describe("useLawyerReview loading and documents", () => {
  it("keeps prior review state visible while a refresh is pending", async () => {
    const { review, fetcher, input } = setup();
    await review.refresh(input());
    const previous = {
      metadata: review.metadata.value,
      state: review.state.value,
      documents: review.documents.value,
      hash: review.documentSetHash.value,
    };
    const pending = deferred<Response>();
    (fetcher as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => pending.promise);

    const refreshing = review.refresh(input());

    expect(review.loading.value).toBe(true);
    expect(review.metadata.value).toEqual(previous.metadata);
    expect(review.state.value).toEqual(previous.state);
    expect(review.documents.value).toEqual(previous.documents);
    expect(review.documentSetHash.value).toBe(previous.hash);
    pending.resolve(fetchResponse(indexerPayload()));
    await refreshing;
  });

  it("ignores a delayed older refresh that completes after the latest input", async () => {
    const { review, fetcher, input } = setup();
    const oldMessages = initialMessages();
    const oldState = deferred<Response>();
    (fetcher as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => oldState.promise);
    const oldRefresh = review.refresh(input(SPV, oldMessages));
    const latestRevision = message({ contributor: SPV, reference: "latest-spv-cid", tag: null });
    const latestMessages = [...oldMessages, latestRevision];

    await review.refresh(input(SPV, latestMessages));
    expect(review.documents.value.spv?.id).toBe(latestRevision.id);
    oldState.resolve(fetchResponse(indexerPayload()));
    await oldRefresh;

    expect(review.documents.value.spv?.id).toBe(latestRevision.id);
    expect(review.documents.value.developer?.id).toBe(oldMessages[1]!.id);
    expect(review.error.value).toBe("");
  });

  it("uses the latest session input for the post-submission refresh", async () => {
    const { review, input } = setup();
    const oldMessages = initialMessages();
    await review.refresh(input(SPV, oldMessages));
    const submission = deferred<{ signature: string; walletName: string }>();
    solanaMocks.submitConfirmation.mockImplementationOnce(() => submission.promise);
    const submitting = review.submitVerdict(true);
    const latestRevision = message({ contributor: SPV, reference: "latest-spv-cid", tag: null });
    const latestInput = input(SPV, [...oldMessages, latestRevision]);
    await review.refresh(latestInput);

    submission.resolve({ signature: "confirm-signature", walletName: "Injected wallet" });
    await submitting;

    expect(review.documents.value.spv?.id).toBe(latestRevision.id);
    expect(review.statusMessage.value).toBe("Lawyer decision submitted.");
  });

  it("ignores buckets that are not lawyer document reviews", async () => {
    const { review, fetcher, loadDocument, input } = setup();
    await review.refresh({ ...input(), bucket: { category: "general", properties: null } });

    expect(review.metadata.value).toBeNull();
    expect(review.state.value).toBeNull();
    expect(review.error.value).toBe("This is not a valid lawyer review bucket.");
    expect(fetcher).not.toHaveBeenCalled();
    expect(loadDocument).not.toHaveBeenCalled();
  });

  it("loads Indexer state and hashes public PDF references in SPV/developer order", async () => {
    const { review, fetcher, loadDocument, input } = setup();
    await review.refresh(input());

    expect(review.metadata.value).toMatchObject({ propertyId: "42", cluster: "devnet" });
    expect(review.state.value).toMatchObject({ listingId: "42", staleAssignment: false });
    expect(review.documents.value.spv?.reference).toBe("spv-cid");
    expect(review.documents.value.developer?.reference).toBe("developer-cid");
    expect(loadDocument).toHaveBeenCalledTimes(2);
    expect(loadDocument.mock.calls.map(([source]) => source.reference)).toEqual(["spv-cid", "developer-cid"]);
    expect(review.documentSetHash.value).toBe(DOCUMENT_HASH);
    expect(fetcher).toHaveBeenCalledWith("https://indexer-devnet.xcavate.io/graphql", expect.anything());
  });

  it("passes existing hydrated attachments to the loader", async () => {
    const { review, loadDocument, input } = setup();
    const messages = initialMessages();
    const hydratedAttachments = {
      [messages[0]!.id]: { contentType: "application/pdf", fileName: "spv.pdf", data: "AQID" },
    };

    await review.refresh({ ...input(), messages, hydratedAttachments });

    expect(loadDocument.mock.calls[0]?.[0]).toEqual({
      message: messages[0],
      reference: "spv-cid",
      attachment: hydratedAttachments[messages[0]!.id],
    });
    expect(loadDocument.mock.calls[1]?.[0].attachment).toBeNull();
    expect(review.documentSetHash.value).toBe(DOCUMENT_HASH);
  });

  it("uses only the latest PDF from each currently assigned lawyer", async () => {
    const { review, input } = setup();
    const [spv, developer] = initialMessages();
    const oldRevision = message({ contributor: SPV, reference: "old-cid", tag: null });
    const ignoredRevision = message({ contributor: OTHER, reference: "other-cid", tag: null });
    const currentRevision = message({ contributor: SPV, reference: "spv-cid", tag: null });

    await review.refresh(input(SPV, [oldRevision, ignoredRevision, currentRevision, developer!, spv!]));

    expect(review.documents.value.spv).toEqual(currentRevision);
    expect(review.documents.value.developer).toEqual(developer);
  });

  it("fails closed when either current PDF is missing", async () => {
    const { review, loadDocument, input } = setup();
    const [spv] = initialMessages();
    await review.refresh(input(SPV, [spv!]));

    expect(review.documents.value).toEqual({ spv, developer: null });
    expect(review.documentSetHash.value).toBeNull();
    expect(review.documentError.value).toBe("Both current lawyer PDF documents are required.");
    expect(review.canSubmit.value).toBe(false);
    expect(loadDocument).not.toHaveBeenCalled();
    await expect(review.submitVerdict(true)).resolves.toBeNull();
    expect(solanaMocks.submitConfirmation).not.toHaveBeenCalled();
  });

  it("surfaces loader failures without enabling confirmation", async () => {
    const { review, loadDocument, input } = setup();
    loadDocument.mockRejectedValueOnce(new Error("PDF gateway unavailable"));
    await review.refresh(input());

    expect(review.documentSetHash.value).toBeNull();
    expect(review.documentError.value).toBe("PDF gateway unavailable");
    expect(review.canSubmit.value).toBe(false);
  });
});

describe("useLawyerReview eligibility and confirmation", () => {
  it("uses the prior PDF revision set compatible with the other seat's recorded hash", async () => {
    const { review, input } = setup(indexerPayload({
      developerLawyerDocStatus: "APPROVED",
      developerLawyerDocumentsHash: DOCUMENT_HASH,
    }));
    const original = initialMessages();
    const newer = message({ contributor: SPV, reference: "latest-spv-cid", tag: null });

    await review.refresh(input(SPV, [...original, newer]));

    expect(review.documents.value.spv?.id).toBe(original[0]!.id);
    expect(review.documents.value.developer?.id).toBe(original[1]!.id);
    expect(review.documentSetHash.value).toBe(DOCUMENT_HASH);
    expect(review.documentError.value).toBe("");
    expect(review.canSubmit.value).toBe(true);
  });

  it("fails closed when no available PDF revision set matches the other seat's hash", async () => {
    const { review, input } = setup(indexerPayload({
      developerLawyerDocStatus: "APPROVED",
      developerLawyerDocumentsHash: "0xabc",
    }));
    const original = initialMessages();
    const newer = message({ contributor: SPV, reference: "latest-spv-cid", tag: null });

    await review.refresh(input(SPV, [...original, newer]));

    expect(review.documentSetHash.value).toBeNull();
    expect(review.documentError.value).toBe(
      "The recorded lawyer decision does not match any available PDF revision set. Restore the original PDFs before submitting another verdict.",
    );
    expect(review.canSubmit.value).toBe(false);
    await expect(review.submitVerdict(true)).resolves.toBeNull();
    expect(solanaMocks.submitConfirmation).not.toHaveBeenCalled();
  });

  it("uses new PDF revisions after a split verdict resets both seats for a second attempt", async () => {
    const { review, input } = setup(indexerPayload({ secondAttempt: true }));
    const original = initialMessages();
    const resetRevision = message({ contributor: SPV, reference: "latest-spv-cid", tag: null });

    await review.refresh(input(SPV, [...original, resetRevision]));

    expect(review.documents.value.spv?.id).toBe(resetRevision.id);
    expect(review.documentSetHash.value).toBe("0x2e60ae153a59a6edfb6284a1b524863fdac559666031cdb62d15a7110fdd9da6");
    expect(review.canSubmit.value).toBe(true);
  });

  it("does not let a seat submit a duplicate verdict", async () => {
    const { review, input } = setup(indexerPayload({
      spvLawyerDocStatus: "APPROVED",
      spvLawyerDocumentsHash: DOCUMENT_HASH,
    }));
    await review.refresh(input());

    expect(review.canSubmit.value).toBe(false);
    await expect(review.submitVerdict(true)).resolves.toBeNull();
    expect(solanaMocks.submitConfirmation).not.toHaveBeenCalled();
  });

  it("allows only a currently assigned lawyer with a document hash to confirm", async () => {
    const { review, input } = setup();
    await review.refresh(input());
    expect(review.lawyerRole.value).toBe("spv");
    expect(review.canSubmit.value).toBe(true);

    await review.refresh(input(OTHER));
    expect(review.lawyerRole.value).toBeNull();
    expect(review.canSubmit.value).toBe(false);
    await expect(review.submitVerdict(true)).resolves.toBeNull();
    expect(solanaMocks.submitConfirmation).not.toHaveBeenCalled();
  });

  it("fails closed for stale seats even when the replacement wallet is connected", async () => {
    const { review, input } = setup(indexerPayload({ spvLawyer: REPLACEMENT }));
    await review.refresh(input(REPLACEMENT));

    expect(review.state.value?.staleAssignment).toBe(true);
    expect(review.lawyerRole.value).toBeNull();
    expect(review.canSubmit.value).toBe(false);
    await expect(review.submitVerdict(true)).resolves.toBeNull();
    expect(solanaMocks.submitConfirmation).not.toHaveBeenCalled();
  });

  it("submits an approval through solanaLegal and refreshes Indexer state", async () => {
    const { review, fetcher, connection, bridge, input } = setup();
    await review.refresh(input());

    const result = await review.submitVerdict(true);

    expect(result).toEqual({ signature: "confirm-signature", walletName: "Injected wallet" });
    expect(solanaMocks.submitConfirmation).toHaveBeenCalledWith({
      config: expect.objectContaining({ cluster: "devnet", walletChain: "solana:devnet" }),
      listingId: "42",
      lawyer: SPV,
      assignedLawyers: [SPV, DEVELOPER],
      approve: true,
      documentsHash: Uint8Array.from(Buffer.from(DOCUMENT_HASH.slice(2), "hex")),
    }, { connection, bridge });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(review.statusMessage.value).toBe("Lawyer decision submitted.");
  });

  it("submits a rejection with approve false", async () => {
    const { review, input } = setup();
    await review.refresh(input(DEVELOPER));
    await review.submitVerdict(false);

    expect(solanaMocks.submitConfirmation).toHaveBeenCalledWith(expect.objectContaining({
      lawyer: DEVELOPER,
      approve: false,
    }), expect.anything());
  });

  it("surfaces confirmation errors and does not refresh after failure", async () => {
    const { review, fetcher, input } = setup();
    solanaMocks.submitConfirmation.mockRejectedValueOnce(new Error("Wallet rejected"));
    await review.refresh(input());

    await expect(review.submitVerdict(true)).resolves.toBeNull();

    expect(review.error.value).toBe("Wallet rejected");
    expect(review.submitting.value).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("useLawyerReview settlement and cluster configuration", () => {
  it("lets any connected wallet execute a ready deal with injected RPC options and refreshes", async () => {
    const { review, fetcher, connection, bridge, input } = setup(legalPayload());
    await review.refresh(input(OTHER));

    expect(review.lawyerRole.value).toBeNull();
    expect(review.canExecute.value).toBe(true);
    const result = await review.executeDeal();

    expect(solanaMocks.prepareExecution).toHaveBeenCalledWith({
      config: expect.objectContaining({ cluster: "devnet" }),
      payer: OTHER,
      listingId: "42",
      regionId: 7,
      developer: "DeveloperAccount",
      developerLawyer: DEVELOPER,
      spvLawyer: SPV,
      collectedMints: ["MintB", "MintA"],
    }, { connection });
    expect(solanaMocks.submitPrepared).toHaveBeenCalledWith(
      { transactions: [] },
      OTHER,
      expect.objectContaining({ cluster: "devnet" }),
      { connection, bridge },
    );
    expect(result).toEqual([{ signature: "execute-signature", walletName: "Injected wallet" }]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(review.statusMessage.value).toBe("Deal executed.");
  });

  it("fails closed when settlement is not ready or the deadline has passed", async () => {
    const notReady = setup();
    await notReady.review.refresh(notReady.input());
    expect(notReady.review.canExecute.value).toBe(false);
    await expect(notReady.review.executeDeal()).resolves.toBeNull();

    let now = 1_800_000_000_000;
    const expired = setup(legalPayload());
    const expiredReview = useLawyerReview({
      loadDocument: expired.loadDocument,
      indexer: { fetcher: expired.fetcher },
      now: () => now,
    });
    await expiredReview.refresh(expired.input());
    now = 2_000_000_000_000;
    expect(expiredReview.canExecute.value).toBe(false);
    await expect(expiredReview.executeDeal()).resolves.toBeNull();
    expect(solanaMocks.prepareExecution).not.toHaveBeenCalled();
  });

  it("surfaces execution errors without a post-submission refresh", async () => {
    const { review, fetcher, input } = setup(legalPayload());
    solanaMocks.prepareExecution.mockRejectedValueOnce(new Error("Simulation failed"));
    await review.refresh(input());

    await expect(review.executeDeal()).resolves.toBeNull();

    expect(review.error.value).toBe("Simulation failed");
    expect(review.executing.value).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("requires explicit mainnet Indexer configuration instead of falling back to devnet", async () => {
    vi.stubEnv("NUXT_PUBLIC_INDEXER_MAINNET_GRAPHQL_URL", "");
    const { review, fetcher, input } = setup(indexerPayload(), "mainnet");
    await review.refresh(input());

    expect(review.error.value).toBe("Mainnet Indexer GraphQL URL is not configured");
    expect(review.state.value).toBeNull();
    expect(review.documentSetHash.value).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("uses the explicitly supplied mainnet Indexer endpoint", async () => {
    const { review, fetcher, input } = setup(indexerPayload(), "mainnet");
    const configured = useLawyerReview({
      loadDocument: vi.fn(async () => new Uint8Array()),
      indexer: { fetcher, mainnetIndexerGraphqlUrl: "https://indexer-mainnet.example/graphql" },
    });

    await configured.refresh(input());

    expect(configured.error.value).toBe("");
    expect(fetcher).toHaveBeenCalledWith("https://indexer-mainnet.example/graphql", expect.anything());
    expect(review.state.value).toBeNull();
  });
});

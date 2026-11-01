import { describe, expect, it } from "vitest";
import type { ApiMessage } from "../../app/services/buckets/types";
import { computeDocumentSetHash, selectCurrentLawyerDocuments } from "../../app/services/lawyer/documentSet";

let sequence = 0;
function message(overrides: Partial<ApiMessage> = {}): ApiMessage {
  sequence += 1;
  return {
    id: `row-${sequence}`,
    messageId: String(sequence),
    bucketId: "39",
    contributor: "AdminWallet",
    reference: `document-${sequence}`,
    tag: null,
    description: `document-${sequence}.pdf`,
    contentType: "application/pdf",
    contentHash: null,
    ipfsContent: null,
    createdAt: new Date(Date.UTC(2026, 9, 1, 12, 0, sequence)).toISOString(),
    ...overrides,
  };
}

function initialDocuments() {
  return [
    message({ tag: "lawyer/terms-document", description: "spv.pdf" }),
    message({ tag: "lawyer/terms-document", description: "developer.pdf" }),
  ];
}

const seats = { spvLawyer: "SpvWallet", developerLawyer: "DeveloperWallet" };

describe("selectCurrentLawyerDocuments", () => {
  it("selects the immutable admin snapshots in SPV/developer role order", () => {
    const [spv, developer] = initialDocuments();
    expect(selectCurrentLawyerDocuments([developer!, spv!], seats)).toEqual({ spv, developer });
  });

  it("uses the latest qualifying PDF revision from each currently assigned lawyer", () => {
    const [spv, developer] = initialDocuments();
    const oldSpvRevision = message({ contributor: seats.spvLawyer });
    const ignored = message({ contributor: "OtherWallet" });
    const currentSpvRevision = message({ contributor: seats.spvLawyer });
    const developerRevision = message({ contributor: seats.developerLawyer });
    expect(selectCurrentLawyerDocuments(
      [developerRevision, ignored, currentSpvRevision, spv!, oldSpvRevision, developer!],
      seats,
    )).toEqual({ spv: currentSpvRevision, developer: developerRevision });
  });

  it("lets an assigned lawyer supply a missing initial document", () => {
    const [spv] = initialDocuments();
    const developerRevision = message({ contributor: seats.developerLawyer });
    expect(selectCurrentLawyerDocuments([spv!, developerRevision], seats)).toEqual({
      spv,
      developer: developerRevision,
    });
  });

  it("returns null for missing seats instead of substituting another contributor's PDF", () => {
    const [spv] = initialDocuments();
    expect(selectCurrentLawyerDocuments([spv!, message({ contributor: "OtherWallet" })], seats)).toEqual({
      spv,
      developer: null,
    });
    expect(selectCurrentLawyerDocuments([], seats)).toEqual({ spv: null, developer: null });
  });

  it("ignores non-PDF revisions and breaks timestamp ties by numeric message id", () => {
    const [spv, developer] = initialDocuments();
    const timestamp = "2026-11-01T12:00:00.000Z";
    const higher = message({ contributor: seats.spvLawyer, messageId: "20", createdAt: timestamp });
    const lower = message({ contributor: seats.spvLawyer, messageId: "9", createdAt: timestamp });
    const text = message({ contributor: seats.spvLawyer, contentType: "text/plain", createdAt: "2026-11-02T12:00:00.000Z" });
    expect(selectCurrentLawyerDocuments([text, lower, spv!, developer!, higher], seats).spv).toBe(higher);
  });
});

describe("computeDocumentSetHash", () => {
  it("hashes empty documents with the domain separator and uint64LE lengths", async () => {
    expect(await computeDocumentSetHash(new Uint8Array(), new Uint8Array())).toBe(
      "0x48a43fb68ee7c6165e7cb7f0abc359d2609f9b34f86c64482f63862ae35b2d80",
    );
  });

  it("matches a binary known-answer vector without concatenation ambiguity", async () => {
    expect(await computeDocumentSetHash(Uint8Array.of(0, 1, 2, 255), new TextEncoder().encode("PDF\n"))).toBe(
      "0x334e714dc83ad9f8f53bc57d81fb2716bc704d700152037256f1f7890cfe8598",
    );
  });

  it("encodes lengths wider than one byte and preserves every binary byte", async () => {
    expect(await computeDocumentSetHash(Uint8Array.of(65), Uint8Array.from({ length: 256 }, (_, i) => i))).toBe(
      "0xe648c47165d1494d4dd7adc32a1511f649576178f278e36dd15aed9a3efcfbdf",
    );
  });
});

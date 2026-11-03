import type { ApiMessage } from "../buckets/types";
import { compareKeySharingMessages } from "../messages/keyAccess";
import { addressesEqual } from "../wallet/addressUtils";

export const LAWYER_TERMS_DOCUMENT_TAG = "lawyer/terms-document";
const DOCUMENT_SET_DOMAIN = "XCAVATE_LEGAL_DOCUMENT_SET_V1";

export interface CurrentLawyerDocuments {
  spv: ApiMessage | null;
  developer: ApiMessage | null;
}

function isPdf(message: ApiMessage): boolean {
  return message.contentType?.split(";", 1)[0]?.trim().toLowerCase() === "application/pdf";
}

function sortComparator(a: ApiMessage, b: ApiMessage): number {
  return compareKeySharingMessages(a, b);
}

export function selectLawyerDocumentRevisionCandidates(
  messages: readonly ApiMessage[],
  seats: { spvLawyer: string; developerLawyer: string },
): { spv: ApiMessage[]; developer: ApiMessage[] } {
  const sorted = [...messages].sort(sortComparator);
  const initial = sorted.filter((message) => message.tag === LAWYER_TERMS_DOCUMENT_TAG && isPdf(message)).slice(0, 2);
  const initialIds = new Set(initial.map((message) => message.id));

  function revisions(initialDocument: ApiMessage | undefined, wallet: string): ApiMessage[] {
    const candidates = initialDocument ? [initialDocument] : [];
    for (const message of sorted) {
      if (initialIds.has(message.id) || !isPdf(message) || !addressesEqual(message.contributor, wallet)) continue;
      if (initialDocument && sortComparator(message, initialDocument) <= 0) continue;
      candidates.push(message);
    }
    return candidates.reverse();
  }

  return {
    spv: revisions(initial[0], seats.spvLawyer),
    developer: revisions(initial[1], seats.developerLawyer),
  };
}

export function selectCurrentLawyerDocuments(
  messages: readonly ApiMessage[],
  seats: { spvLawyer: string; developerLawyer: string },
): CurrentLawyerDocuments {
  const candidates = selectLawyerDocumentRevisionCandidates(messages, seats);
  return {
    spv: candidates.spv[0] ?? null,
    developer: candidates.developer[0] ?? null,
  };
}

function uint64le(value: number): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), true);
  return bytes;
}

export async function computeDocumentSetHash(
  spvBytes: Uint8Array,
  developerBytes: Uint8Array,
): Promise<`0x${string}`> {
  const domain = new TextEncoder().encode(DOCUMENT_SET_DOMAIN);
  const payload = new Uint8Array(domain.length + 16 + spvBytes.length + developerBytes.length);
  let offset = 0;
  for (const part of [domain, uint64le(spvBytes.length), spvBytes, uint64le(developerBytes.length), developerBytes]) {
    payload.set(part, offset);
    offset += part.length;
  }

  let digest: Uint8Array;
  if (typeof crypto !== "undefined" && crypto.subtle) {
    digest = new Uint8Array(await crypto.subtle.digest("SHA-256", payload));
  } else {
    const { createHash } = await import("node:crypto");
    digest = Uint8Array.from(createHash("sha256").update(payload).digest().values());
  }

  let hex = "";
  for (const byte of digest) hex += byte.toString(16).padStart(2, "0");
  return `0x${hex}`;
}

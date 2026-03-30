import type { DidRecord, DidWriteInput, DidWriteResult } from "../../types/did"

function operationId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export class DidRepository {
  async fetchDid(subjectId: string): Promise<DidRecord> {
    if (!subjectId) {
      return {
        subjectId,
        status: "failed",
        source: "unknown",
        errorMessage: "Missing subject identifier"
      }
    }

    return {
      subjectId,
      didUri: `did:kilt:${subjectId.slice(0, 12)}`,
      status: "found",
      source: "did_pallet",
      details: { displayName: "Admin DID", endpoint: "kilt" },
      lastRefreshedAt: new Date().toISOString()
    }
  }

  async registerDid(input: DidWriteInput): Promise<DidWriteResult> {
    return {
      operationId: operationId("register"),
      state: "succeeded",
      message: `DID registered for ${input.subjectId}`
    }
  }

  async updateDid(input: DidWriteInput): Promise<DidWriteResult> {
    return {
      operationId: operationId("update"),
      state: "succeeded",
      message: `DID updated for ${input.subjectId}`
    }
  }
}

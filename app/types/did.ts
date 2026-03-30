export type DidSource = "did_pallet" | "did_lookup" | "unknown"
export type DidReadStatus = "found" | "not_found" | "failed"
export type DidOperationType = "register" | "update"
export type DidOperationState = "draft" | "submitted" | "pending" | "succeeded" | "failed"

export interface DidRecord {
  didUri?: string
  subjectId: string
  status: DidReadStatus
  source: DidSource
  details?: Record<string, unknown>
  lastRefreshedAt?: string
  errorMessage?: string
}

export interface DidWriteInput {
  subjectId: string
  details: Record<string, unknown>
}

export interface DidWriteResult {
  operationId: string
  state: DidOperationState
  message: string
}

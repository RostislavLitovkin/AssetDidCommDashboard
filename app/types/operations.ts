export type WalletStatus = "disconnected" | "connecting" | "connected" | "rejected" | "unavailable"
export type OperationCategory = "wallet" | "did_read" | "did_write" | "key_mgmt"
export type OperationStatus = "success" | "warning" | "error" | "info"

export interface OperationLogEntry {
  entryId: string
  category: OperationCategory
  targetRef: string
  status: OperationStatus
  message: string
  timestamp: string
}

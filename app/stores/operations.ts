import type { OperationCategory, OperationLogEntry, OperationStatus } from "../types/operations"
import { useNotificationsStore } from "./notifications"

function entryId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export const useOperationsStore = defineStore("operations", {
  state: () => ({
    entries: [] as OperationLogEntry[]
  }),
  actions: {
    add(category: OperationCategory, targetRef: string, status: OperationStatus, message: string): void {
      const notifications = useNotificationsStore()
      const notificationTitle = category === "bucket_write" ? targetRef : `${category} · ${targetRef}`

      this.entries.unshift({
        entryId: entryId(),
        category,
        targetRef,
        status,
        message,
        timestamp: new Date().toISOString()
      })

      notifications.push(notificationTitle, message, status)
    }
  }
})

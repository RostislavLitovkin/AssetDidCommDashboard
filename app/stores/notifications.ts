import type { OperationStatus } from "../types/operations"
import { useSettingsStore } from "./settings"

export interface NotificationItem {
  id: string
  title: string
  message: string
  status: OperationStatus
  timestamp: string
}

function notificationId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export const useNotificationsStore = defineStore("notifications", {
  state: () => ({
    items: [] as NotificationItem[]
  }),
  actions: {
    push(title: string, message: string, status: OperationStatus = "info"): void {
      const settings = useSettingsStore()
      settings.initialize()
      if (!settings.notificationsEnabled) {
        return
      }

      const item: NotificationItem = {
        id: notificationId(),
        title,
        message,
        status,
        timestamp: new Date().toISOString()
      }

      this.items.unshift(item)
    },
    dismiss(id: string): void {
      this.items = this.items.filter((item) => item.id !== id)
    },
    clear(): void {
      this.items = []
    }
  }
})

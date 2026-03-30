import { DidRepository } from "../services/papi/didRepository"
import type { DidRecord } from "../types/did"

export function useDid() {
  const session = useSessionStore()
  const operations = useOperationsStore()
  const repo = new DidRepository()
  const didRecord = ref<DidRecord | null>(null)
  const loading = ref(false)

  async function fetchDid(): Promise<void> {
    if (!session.accountAddress) {
      didRecord.value = {
        subjectId: "",
        status: "failed",
        source: "unknown",
        errorMessage: "Wallet must be connected"
      }
      operations.add("did_read", "none", "error", "Wallet must be connected")
      return
    }

    loading.value = true
    const record = await repo.fetchDid(session.accountAddress)
    didRecord.value = record
    operations.add("did_read", record.subjectId, record.status === "failed" ? "error" : "success", `DID lookup ${record.status}`)
    loading.value = false
  }

  async function registerDid(details: Record<string, unknown>): Promise<void> {
    if (!session.accountAddress) {
      operations.add("did_write", "register", "error", "Wallet must be connected")
      return
    }
    const result = await repo.registerDid({ subjectId: session.accountAddress, details })
    operations.add("did_write", result.operationId, result.state === "failed" ? "error" : "success", result.message)
    await fetchDid()
  }

  async function updateDid(details: Record<string, unknown>): Promise<void> {
    if (!session.accountAddress) {
      operations.add("did_write", "update", "error", "Wallet must be connected")
      return
    }
    const result = await repo.updateDid({ subjectId: session.accountAddress, details })
    operations.add("did_write", result.operationId, result.state === "failed" ? "error" : "success", result.message)
    await fetchDid()
  }

  return {
    didRecord,
    loading,
    fetchDid,
    registerDid,
    updateDid
  }
}

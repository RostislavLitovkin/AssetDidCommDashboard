import { X25519KeyService } from "../services/crypto/x25519KeyService"
import type { KeyMaterial } from "../types/keys"

export function useKeys() {
  const operations = useOperationsStore()
  const service = new X25519KeyService()
  const activeKey = ref<KeyMaterial | null>(null)

  async function generate(): Promise<void> {
    activeKey.value = await service.generate()
    operations.add("key_mgmt", activeKey.value.keyId, "success", "X25519 keypair generated")
  }

  function importKey(rawJson: string): void {
    try {
      activeKey.value = service.import(rawJson)
      operations.add("key_mgmt", activeKey.value.keyId, "success", "X25519 key imported")
    } catch (error) {
      operations.add("key_mgmt", "import", "error", error instanceof Error ? error.message : "Key import failed")
      throw error
    }
  }

  function exportKey(): string {
    if (!activeKey.value) {
      throw new Error("No active key to export")
    }
    operations.add("key_mgmt", activeKey.value.keyId, "info", "X25519 key exported")
    return service.export(activeKey.value)
  }

  return {
    activeKey,
    generate,
    importKey,
    exportKey
  }
}

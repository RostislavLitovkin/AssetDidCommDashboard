import { encodeAddress } from "@polkadot/util-crypto"
import { computed } from "vue"
import { useSettingsStore } from "../stores/settings"
import { addressesEqual, toPublicKeyHex } from "../services/wallet/addressUtils"
import { hexToU8a } from "@polkadot/util"

export function useAddress() {
  const settings = useSettingsStore()
  settings.initialize()

  const ss58Prefix = computed(() => settings.ss58Prefix)

  function formatAddress(value: string): string {
    const trimmed = value.trim()
    const publicKeyHex = toPublicKeyHex(trimmed)
    if (!publicKeyHex) {
      return trimmed
    }

    try {
      return encodeAddress(hexToU8a(publicKeyHex), ss58Prefix.value)
    } catch {
      return trimmed
    }
  }

  return {
    ss58Prefix,
    formatAddress,
    // Pure identity comparison — lives in addressUtils so non-Vue modules
    // (e.g. bucket membership) can use it too.
    addressesEqual
  }
}

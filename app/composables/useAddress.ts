import { hexToU8a, u8aToHex } from "@polkadot/util"
import { decodeAddress, encodeAddress } from "@polkadot/util-crypto"
import { computed } from "vue"
import { useSettingsStore } from "../stores/settings"

function toAddressBytes(value: string): Uint8Array | undefined {
  const trimmed = value.trim()
  if (!trimmed) {
    return undefined
  }

  if (/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
    try {
      return hexToU8a(trimmed)
    } catch {
      return undefined
    }
  }

  try {
    return decodeAddress(trimmed)
  } catch {
    return undefined
  }
}

function toPublicKeyHex(value: string): string | undefined {
  const bytes = toAddressBytes(value)
  if (!bytes || bytes.length !== 32) {
    return undefined
  }

  return u8aToHex(bytes).toLowerCase()
}

export function useAddress() {
  const settings = useSettingsStore()
  settings.initialize()

  const ss58Prefix = computed(() => settings.ss58Prefix)

  function formatAddress(value: string): string {
    const trimmed = value.trim()
    const bytes = toAddressBytes(trimmed)
    if (!bytes || bytes.length !== 32) {
      return trimmed
    }

    try {
      return encodeAddress(bytes, ss58Prefix.value)
    } catch {
      return trimmed
    }
  }

  function addressesEqual(left: string, right: string): boolean {
    const leftHex = toPublicKeyHex(left)
    const rightHex = toPublicKeyHex(right)

    if (leftHex && rightHex) {
      return leftHex === rightHex
    }

    return left.trim().toLowerCase() === right.trim().toLowerCase()
  }

  return {
    ss58Prefix,
    formatAddress,
    addressesEqual
  }
}

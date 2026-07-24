<script setup lang="ts">
import { Keyring } from "@polkadot/keyring"
import { hexToU8a, u8aToHex } from "@polkadot/util"
import { cryptoWaitReady, decodeAddress, encodeAddress, mnemonicGenerate } from "@polkadot/util-crypto"
import { base64url } from "jose"
import PageHeader from "../components/common/PageHeader.vue"
import { computed } from "vue"
import { ref } from "vue"
import { useRuntimeConfig } from "nuxt/app"
import { useAddress } from "../composables/useAddress"
import { useSettingsStore } from "../stores/settings"
import { X25519KeyService } from "../services/crypto/x25519KeyService"
import { useOperationsStore } from "../stores/operations"
import { useSessionStore } from "../stores/session"
import type { KeyMaterial } from "../types/keys"

const { ss58Prefix, formatAddress } = useAddress()
const settings = useSettingsStore()
const mnemonic = ref("")
const ss58Address = ref("")
const generatingMnemonic = ref(false)
const mnemonicError = ref<string | null>(null)
const mnemonicCopied = ref(false)
const session = useSessionStore()
const operations = useOperationsStore()
const runtimeConfig = useRuntimeConfig()

const keyService = new X25519KeyService()
const keyMaterial = ref<KeyMaterial | null>(null)
const generatingJwk = ref(false)
const jwkError = ref<string | null>(null)

const jwkJson = computed(() => (keyMaterial.value ? keyService.export(keyMaterial.value) : ""))
const hasJwk = computed(() => Boolean(jwkJson.value))

const didSearchAddress = ref("")
const searchingDid = ref(false)
const didSearchError = ref<string | null>(null)
const didSearchResultJson = ref("")
const didSearchDecodedX25519Json = ref("")

const didCreateDidAddress = ref("")
const didCreateMnemonic = ref("")
const didCreateKeyAgreementX = ref("")
const submittingDidCreate = ref(false)
const didCreateError = ref<string | null>(null)
const didCreateStatus = ref("")
const didCreateTxHash = ref("")
const derivedDidAddress = ref("")

const didCreateFromAccountAuthKey = ref("")
const submittingDidCreateFromAccount = ref(false)
const didCreateFromAccountError = ref<string | null>(null)
const didCreateFromAccountStatus = ref("")
const didCreateFromAccountTxHash = ref("")

const didAddKeyAgreementX = ref("")
const submittingDidAddKeyAgreement = ref(false)
const didAddKeyAgreementError = ref<string | null>(null)
const didAddKeyAgreementStatus = ref("")
const didAddKeyAgreementTxHash = ref("")

const didSignMnemonic = ref("")
const didSignPayloadHex = ref("")
const didSignSignature = ref("")
const didSignError = ref<string | null>(null)
const didSignSignatureCopied = ref(false)
const didSignTxCounter = ref<number | null>(null)
const didSignBlockNumber = ref<number | null>(null)
const didSignSubmitterAddress = ref("")
const didSignKeyRelationship = ref("Authentication")
const didSignPayloadDebug = ref("")

async function signPayload(): Promise<void> {
  didSignError.value = null
  didSignSignature.value = ""
  didSignTxCounter.value = null
  didSignBlockNumber.value = null

  let provider: { disconnect: () => void } | undefined
  let api: any | undefined

  try {
    const payloadHex = didSignPayloadHex.value.trim()
    if (!payloadHex) {
      throw new Error("Payload hex is required")
    }

    await cryptoWaitReady()
    const didKeyring = new Keyring({ type: "sr25519", ss58Format: ss58Prefix.value })
    const didAccount = didKeyring.addFromUri(didSignMnemonic.value.trim())

    const endpoint = session.networkEndpoint || runtimeConfig.public.xcavateWsEndpoint
    const { ApiPromise, WsProvider } = await import("@polkadot/api")

    provider = new WsProvider(endpoint)
    api = await ApiPromise.create({ provider })

    const queryDid = api.query?.did?.did
    if (typeof queryDid !== "function") {
      throw new Error("did.did storage query is not available on this chain")
    }

    const result = await queryDid(didAccount.address)
    const didInfo = result.toJSON() as Record<string, unknown> | null
    
    if (!didInfo) {
      throw new Error("DID not found on chain. Please register it first.")
    }

    const txCounter = Number(didInfo.txCounter ?? didInfo.tx_counter ?? didInfo.nonce ?? 0) + 1

    // Fetch the latest block number from the chain for replay protection
    const blockNumberObj = await api.query.system.number()
    const blockNumber = blockNumberObj.toNumber()

    didSignTxCounter.value = txCounter
    didSignBlockNumber.value = blockNumber

    const submitter = didSignSubmitterAddress.value.trim() || session.accountAddress
    if (!submitter) {
      throw new Error("Submitter address is required")
    }

    let payloadBytes: Uint8Array
    try {
      // Fetch the exact type string for the first argument of `submitDidCall`
      const operationTypeStr = api.tx.did.submitDidCall.meta.args[0].type.toString()
      
      // Rely on the chain's metadata to encode the operation precisely.
      const operationObj = api.registry.createType(operationTypeStr, {
        did: didAccount.address,
        tx_counter: txCounter,
        call: payloadHex,
        block_number: blockNumber,
        submitter: submitter
      })
      const operationBytes = operationObj.toU8a()

      // Dynamically discover the wrapper and enum types from the chain metadata
      const allTypes = Object.keys(api.registry.getClasses())
      const wrapTypeName = allTypes.find(t => t.includes('DidAuthorizedCallOperationWithVerificationRelationship') || t.includes('AuthorizedCallOperationWithVerificationRelationship'))
      const relTypeName = allTypes.find(t => t.includes('DidVerificationKeyRelationship') || t.includes('VerificationKeyRelationship'))

      if (wrapTypeName) {
        // If the wrapper type exists in metadata, use it directly for perfect encoding
        payloadBytes = api.registry.createType(wrapTypeName, {
          operation: operationObj,
          verificationKeyRelationship: didSignKeyRelationship.value
        }).toU8a()
      } else {
        // Otherwise, encode the enum and concatenate
        let relationshipBytes: Uint8Array
        if (relTypeName) {
          relationshipBytes = api.registry.createType(relTypeName, didSignKeyRelationship.value).toU8a()
        } else {
          const map: Record<string, number> = {
            'Authentication': 0,
            'CapabilityDelegation': 1,
            'CapabilityInvocation': 2,
            'AssertionMethod': 3
          }
          relationshipBytes = new Uint8Array([map[didSignKeyRelationship.value] ?? 0])
        }
        payloadBytes = new Uint8Array([...operationBytes, ...relationshipBytes])
      }
    } catch (e) {
      console.error("Payload encoding error:", e)
      throw new Error(`Failed to encode payload: ${e instanceof Error ? e.message : String(e)}`)
    }

    didSignPayloadDebug.value = u8aToHex(payloadBytes)
    const signature = didAccount.sign(payloadBytes)
    didSignSignature.value = u8aToHex(signature)
  } catch (error) {
    didSignError.value = error instanceof Error ? error.message : "Failed to sign payload"
  } finally {
    if (api) await api.disconnect().catch(() => undefined)
    if (provider) provider.disconnect()
  }
}

async function copySignature(): Promise<void> {
  if (!import.meta.client || !didSignSignature.value) return
  try {
    await navigator.clipboard.writeText(didSignSignature.value)
    didSignSignatureCopied.value = true
    setTimeout(() => {
      didSignSignatureCopied.value = false
    }, 1800)
  } catch {
    didSignError.value = "Clipboard copy failed"
  }
}

const isDidCreateFormValid = computed(() => {
  return (
    didCreateDidAddress.value.trim().length > 0 &&
    didCreateMnemonic.value.trim().length > 0 &&
    didCreateKeyAgreementX.value.trim().length > 0
  )
})

async function generateMnemonic(): Promise<void> {
  generatingMnemonic.value = true
  mnemonicError.value = null
  mnemonicCopied.value = false

  try {
    await cryptoWaitReady()
    const nextMnemonic = mnemonicGenerate()
    const keyring = new Keyring({ type: "sr25519", ss58Format: ss58Prefix.value })
    const account = keyring.addFromUri(nextMnemonic)

    mnemonic.value = nextMnemonic
    ss58Address.value = account.address
  } catch (error) {
    mnemonicError.value = error instanceof Error ? error.message : "Failed to generate mnemonic account"
  } finally {
    generatingMnemonic.value = false
  }
}

async function copyMnemonic(): Promise<void> {
  if (!import.meta.client || !mnemonic.value) {
    return
  }

  try {
    await navigator.clipboard.writeText(mnemonic.value)
    mnemonicCopied.value = true
    setTimeout(() => {
      mnemonicCopied.value = false
    }, 1800)
  } catch {
    mnemonicError.value = "Clipboard copy failed"
  }
}

async function generateJwk(): Promise<void> {
  generatingJwk.value = true
  jwkError.value = null

  try {
    keyMaterial.value = await keyService.generate()
  } catch (error) {
    jwkError.value = error instanceof Error ? error.message : "Failed to generate X25519 JWK"
  } finally {
    generatingJwk.value = false
  }
}

function encodeAgreementXToHex(value: string): string {
  const raw = value.trim()
  if (!raw) {
    throw new Error("Agreement key x value is empty")
  }

  const keyBytes = base64url.decode(raw)
  if (keyBytes.length !== 32) {
    throw new Error("Agreement key x must decode to 32 bytes")
  }

  return u8aToHex(keyBytes)
}

function resolveSr25519PublicKeyHex(value: string): string {
  const raw = value.trim()
  if (!raw) {
    throw new Error("authenticationKey is empty")
  }

  if (raw.startsWith("0x") || raw.startsWith("0X")) {
    const normalized = raw.toLowerCase()
    const hexBody = normalized.slice(2)
    if (!/^[0-9a-f]+$/.test(hexBody)) {
      throw new Error("authenticationKey must be valid hex")
    }

    if (hexBody.length !== 64) {
      throw new Error("authenticationKey hex must be 32 bytes (64 hex chars)")
    }

    return normalized
  }

  try {
    const keyBytes = decodeAddress(raw)
    if (keyBytes.length !== 32) {
      throw new Error("authenticationKey SS58 does not decode to 32 bytes")
    }
    return u8aToHex(keyBytes)
  } catch {
    throw new Error("authenticationKey must be a valid SS58 address or 0x 32-byte public key")
  }
}

function formatDispatchError(dispatchError: unknown, api: { registry?: { findMetaError?: unknown } }): string {
  if (!dispatchError || typeof dispatchError !== "object") {
    return "Extrinsic failed"
  }

  const value = dispatchError as Record<string, unknown> & {
    toString?: () => string
  }

  const moduleError = extractModuleDispatchError(value)
  const findMetaError = api.registry?.findMetaError
  const decoded = decodeModuleMetadataError(moduleError, findMetaError)
  if (decoded) {
    return `${decoded.section}.${decoded.name}: ${decoded.docs.join(" ")}`
  }

  return value.toString?.() ?? "Extrinsic failed"
}

function decodeModuleMetadataError(
  moduleError: unknown,
  findMetaError: unknown
): { section: string; name: string; docs: string[] } | undefined {
  if (!moduleError || typeof findMetaError !== "function") {
    return undefined
  }

  const decoder = findMetaError as (value: unknown) => { section: string; name: string; docs: string[] }

  try {
    return decoder(moduleError)
  } catch {
    const normalized = normalizeModuleErrorValue(moduleError)
    if (!normalized) {
      return undefined
    }

    try {
      return decoder(normalized)
    } catch {
      return undefined
    }
  }
}

function extractModuleDispatchError(dispatchError: Record<string, unknown>): unknown {
  if (dispatchError.isModule && "asModule" in dispatchError) {
    return dispatchError.asModule
  }

  if ("module" in dispatchError && dispatchError.module) {
    return dispatchError.module
  }

  if ("Module" in dispatchError && dispatchError.Module) {
    return dispatchError.Module
  }

  const toJSON = dispatchError.toJSON
  if (typeof toJSON === "function") {
    try {
      const encoded = (toJSON as () => unknown)()
      if (encoded && typeof encoded === "object") {
        const value = encoded as Record<string, unknown>
        if ("module" in value && value.module) {
          return value.module
        }
        if ("Module" in value && value.Module) {
          return value.Module
        }
      }
    } catch {
      return undefined
    }
  }

  return undefined
}

function normalizeModuleErrorValue(value: unknown): { index: number; error: Uint8Array } | undefined {
  if (!value || typeof value !== "object") {
    return undefined
  }

  const candidate = value as Record<string, unknown>
  const index = normalizeModuleIndex(candidate.index)
  const error = normalizeModuleErrorBytes(candidate.error)
  if (index === undefined || !error) {
    return undefined
  }

  return { index, error }
}

function normalizeModuleIndex(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    if (Number.isInteger(parsed) && parsed >= 0) {
      return parsed
    }
  }

  return undefined
}

function normalizeModuleErrorBytes(value: unknown): Uint8Array | undefined {
  if (value && typeof value === "object" && "toU8a" in value) {
    const toU8a = (value as { toU8a?: unknown }).toU8a
    if (typeof toU8a === "function") {
      return (toU8a as () => Uint8Array)()
    }
  }

  if (typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value)) {
    const hex = value.slice(2)
    if (hex.length % 2 !== 0) {
      return undefined
    }

    const bytes = new Uint8Array(hex.length / 2)
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16)
    }
    return bytes
  }

  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255) {
    return new Uint8Array([value, 0, 0, 0])
  }

  if (Array.isArray(value) && value.every((item) => typeof item === "number" && item >= 0 && item <= 255)) {
    return Uint8Array.from(value)
  }

  return undefined
}

type TxHashLike = { toHex?: () => string }
type TxStatusLike = {
  isReady?: boolean
  isBroadcast?: boolean
  isInBlock?: boolean
  isFinalized?: boolean
  asInBlock?: TxHashLike
  asFinalized?: TxHashLike
}
type TxResultLike = {
  status?: TxStatusLike
  txHash?: TxHashLike
  dispatchError?: unknown
}
type SubmittableWithWatch = {
  signAndSend: (
    address: string,
    options: { signer: unknown },
    callback: (result: TxResultLike) => void
  ) => Promise<(() => void) | TxHashLike>
}

function asHex(hashLike: TxHashLike | undefined): string {
  return hashLike?.toHex?.() ?? ""
}

async function submitWatchedExtrinsic(options: {
  tx: SubmittableWithWatch
  connectedAddress: string
  signer: unknown
  apiForErrors: { registry?: { findMetaError?: unknown } }
  onTxHash: (txHash: string) => void
  onStatus: (status: string) => void
}): Promise<void> {
  const { tx, connectedAddress, signer, apiForErrors, onTxHash, onStatus } = options

  await new Promise<void>((resolve, reject) => {
    let resolved = false
    let unsubscribe: (() => void) | undefined

    const clean = () => {
      if (unsubscribe) {
        unsubscribe()
        unsubscribe = undefined
      }
    }

    tx.signAndSend(connectedAddress, { signer }, (result) => {
      const txHash = asHex(result.txHash)
      if (txHash) {
        onTxHash(txHash)
      }

      if (result.status?.isReady) {
        onStatus("Extrinsic accepted by node")
      }

      if (result.status?.isBroadcast) {
        onStatus("Extrinsic broadcast to peers")
      }

      if (result.status?.isInBlock) {
        onStatus(`Included in block ${asHex(result.status.asInBlock)}`)
      }

      if (result.dispatchError && !resolved) {
        resolved = true
        clean()
        reject(new Error(formatDispatchError(result.dispatchError, apiForErrors)))
        return
      }

      if (result.status?.isFinalized && !resolved) {
        resolved = true
        onStatus(`Finalized in block ${asHex(result.status.asFinalized)}`)
        clean()
        resolve()
      }
    }).then((value) => {
      if (typeof value === "function") {
        unsubscribe = value
        return
      }

      if (!resolved) {
        resolved = true
        const txHash = asHex(value)
        if (txHash) {
          onTxHash(txHash)
        }
        onStatus("Extrinsic submitted")
        resolve()
      }
    }).catch((error) => {
      if (!resolved) {
        resolved = true
        clean()
        reject(error)
      }
    })
  })
}

function isHex32(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value)
}

function collectX25519JwkEntries(
  value: unknown,
  path = "result",
  parentKey = "",
  output: Array<{ path: string; hex: string; jwk: { kty: "OKP"; crv: "X25519"; x: string } }> = []
): Array<{ path: string; hex: string; jwk: { kty: "OKP"; crv: "X25519"; x: string } }> {
  const lowerPath = path.toLowerCase()
  const lowerParent = parentKey.toLowerCase()
  const contextLooksLikeX25519 = /x25519|keyagreement|encryptionkey/.test(lowerPath) || /x25519|keyagreement|encryptionkey/.test(lowerParent)

  if (typeof value === "string" && contextLooksLikeX25519 && isHex32(value)) {
    const bytes = hexToU8a(value)
    output.push({
      path,
      hex: value,
      jwk: {
        kty: "OKP",
        crv: "X25519",
        x: base64url.encode(bytes)
      }
    })
    return output
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectX25519JwkEntries(item, `${path}[${index}]`, parentKey, output)
    })
    return output
  }

  if (value && typeof value === "object") {
    Object.entries(value as Record<string, unknown>).forEach(([key, nestedValue]) => {
      collectX25519JwkEntries(nestedValue, `${path}.${key}`, key, output)
    })
  }

  return output
}

function mapX25519HexToBase64Url(value: unknown, parentKey = ""): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => mapX25519HexToBase64Url(item, parentKey))
  }

  if (value && typeof value === "object") {
    const mapped: Record<string, unknown> = {}
    Object.entries(value as Record<string, unknown>).forEach(([key, nestedValue]) => {
      mapped[key] = mapX25519HexToBase64Url(nestedValue, key)
    })
    return mapped
  }

  if (typeof value === "string" && isHex32(value)) {
    const keyName = parentKey.toLowerCase()

    if (keyName === "x25519") {
      return base64url.encode(hexToU8a(value))
    }

    if (keyName === "sr25519") {
      try {
        return encodeAddress(hexToU8a(value), ss58Prefix.value)
      } catch {
        return value
      }
    }
  }

  return value
}

async function searchDidByAddress(): Promise<void> {
  didSearchError.value = null
  didSearchResultJson.value = ""
  didSearchDecodedX25519Json.value = ""

  const inputAddress = didSearchAddress.value.trim()
  if (!inputAddress) {
    didSearchError.value = "DID address is required"
    return
  }

  try {
    const decoded = decodeAddress(inputAddress)
    if (decoded.length !== 32) {
      throw new Error("Address must decode to 32 bytes")
    }
  } catch {
    didSearchError.value = "Enter a valid SS58 address"
    return
  }

  searchingDid.value = true

  let provider: { disconnect: () => void } | undefined
  let api:
    | {
      disconnect: () => Promise<void>
      query?: { did?: { did?: (address: string) => Promise<{ toJSON?: () => unknown; toHuman?: () => unknown; toString?: () => string }> } }
    }
    | undefined

  try {
    const endpoint = session.networkEndpoint || runtimeConfig.public.xcavateWsEndpoint
    const { ApiPromise, WsProvider } = await import("@polkadot/api")

    provider = new WsProvider(endpoint)
    api = await ApiPromise.create({ provider })

    const queryDid = api.query?.did?.did
    if (typeof queryDid !== "function") {
      throw new Error("did.did storage query is not available on this chain")
    }

    const result = await queryDid(inputAddress)

    let jsonPayload: unknown
    try {
      jsonPayload = typeof result.toJSON === "function" ? result.toJSON() : undefined
    } catch {
      jsonPayload = undefined
    }

    if (jsonPayload === undefined) {
      try {
        jsonPayload = typeof result.toHuman === "function" ? result.toHuman() : result.toString?.()
      } catch {
        jsonPayload = result.toString?.() ?? null
      }
    }

    const mappedPayload = mapX25519HexToBase64Url(jsonPayload)
    didSearchResultJson.value = JSON.stringify(mappedPayload, null, 2)

    const decodedX25519 = collectX25519JwkEntries(jsonPayload)
    if (decodedX25519.length) {
      didSearchDecodedX25519Json.value = JSON.stringify(decodedX25519, null, 2)
    }

    operations.add("did_read", inputAddress, "success", "DID queried from chain")
  } catch (error) {
    didSearchError.value = error instanceof Error ? error.message : "Failed to query DID by address"
    operations.add("did_read", inputAddress, "error", didSearchError.value)
  } finally {
    searchingDid.value = false

    if (api) {
      await api.disconnect().catch(() => undefined)
    }
    if (provider) {
      provider.disconnect()
    }
  }
}

async function submitDidCreateExtrinsic(): Promise<void> {
  didCreateError.value = null
  didCreateStatus.value = ""
  didCreateTxHash.value = ""

  const connectedAddress = session.accountAddress
  if (!connectedAddress) {
    didCreateError.value = "Connect wallet before submitting did.create extrinsic"
    return
  }

  const mnemonicInput = didCreateMnemonic.value.trim()
  if (!mnemonicInput) {
    didCreateError.value = "DID mnemonic is required to sign did.create details"
    return
  }


  let keyAgreementHex = ""

  try {
    if (didCreateKeyAgreementX.value.trim()) {
      keyAgreementHex = encodeAgreementXToHex(didCreateKeyAgreementX.value)
    }
  } catch (error) {
    didCreateError.value = error instanceof Error ? error.message : "Invalid key input"
    return
  }

  await cryptoWaitReady()
  const didKeyring = new Keyring({ type: "sr25519", ss58Format: ss58Prefix.value })
  
  let didAccount
  try {
    didAccount = didKeyring.addFromUri(mnemonicInput)
  } catch (error) {
    didCreateError.value = "Invalid mnemonic provided"
    return
  }

  const inputDidAddress = didCreateDidAddress.value.trim()
  if (inputDidAddress !== didAccount.address) {
    didCreateError.value = `Mnemonic generates a different address (${didAccount.address}) than the one provided.`
    return
  }

  const didAddress = inputDidAddress
  derivedDidAddress.value = didAddress

  const details = {
    did: didAddress,
    submitter: connectedAddress,
    newKeyAgreementKeys: keyAgreementHex ? [{ X25519: keyAgreementHex }] : [],
    newAttestationKey: null,
    newDelegationKey: null,
    newServiceDetails: null
  }

  submittingDidCreate.value = true

  let provider: { disconnect: () => void } | undefined
  let api: { disconnect: () => Promise<void>; tx?: unknown; registry?: { findMetaError?: unknown } } | undefined

  try {
    const endpoint = session.networkEndpoint || runtimeConfig.public.xcavateWsEndpoint
    const [{ ApiPromise, WsProvider }, { web3FromAddress }] = await Promise.all([
      import("@polkadot/api"),
      import("@polkadot/extension-dapp")
    ])

    provider = new WsProvider(endpoint)
    api = await ApiPromise.create({ provider })

    const didTx = (api.tx as { did?: { create?: (detailsArg: unknown, signatureArg: unknown) => { signAndSend: unknown } } }).did
      ?.create

    if (typeof didTx !== "function") {
      throw new Error("did.create extrinsic is not available on this chain")
    }

    const injector = await web3FromAddress(connectedAddress)
    let detailsBytes: Uint8Array
    try {
      const typedDetails = (api as { registry: { createType: (typeName: string, value: unknown) => { toU8a: () => Uint8Array } } }).registry.createType(
        "DidDidDetailsDidCreationDetails",
        details
      )
      detailsBytes = typedDetails.toU8a()
    } catch {
      // Fallback for runtimes where the concrete named type differs.
      const encoded = new TextEncoder().encode(JSON.stringify(details))
      detailsBytes = encoded
    }

    const rawSignature = didAccount.sign(detailsBytes)
    const signature = {
      Sr25519: u8aToHex(rawSignature)
    }

    const tx = didTx(details, signature)

    didCreateStatus.value = "Submitting extrinsic..."
    operations.add("did_write", didAddress, "info", "Submitting did.create extrinsic")

    await submitWatchedExtrinsic({
      tx: tx as SubmittableWithWatch,
      connectedAddress,
      signer: injector.signer,
      apiForErrors: api ?? {},
      onTxHash: (txHash) => {
        didCreateTxHash.value = txHash
      },
      onStatus: (status) => {
        didCreateStatus.value = status
      }
    })

    operations.add("did_write", didAddress, "success", `did.create finalized${didCreateTxHash.value ? ` (${didCreateTxHash.value})` : ""}`)
  } catch (error) {
    didCreateError.value = error instanceof Error ? error.message : "Unable to submit did.create extrinsic"
    didCreateStatus.value = ""
    operations.add("did_write", didAddress, "error", didCreateError.value)
  } finally {
    submittingDidCreate.value = false

    if (api) {
      await api.disconnect().catch(() => undefined)
    }
    if (provider) {
      provider.disconnect()
    }
  }
}

async function submitDidCreateFromAccountExtrinsic(): Promise<void> {
  didCreateFromAccountError.value = null
  didCreateFromAccountStatus.value = ""
  didCreateFromAccountTxHash.value = ""

  const connectedAddress = session.accountAddress
  if (!connectedAddress) {
    didCreateFromAccountError.value = "Connect wallet before submitting did.createFromAccount extrinsic"
    return
  }

  let authenticationKeyHex = ""
  try {
    if (didCreateFromAccountAuthKey.value.trim()) {
      authenticationKeyHex = resolveSr25519PublicKeyHex(didCreateFromAccountAuthKey.value)
    } else {
      const publicKey = decodeAddress(connectedAddress)
      if (publicKey.length !== 32) {
        throw new Error("Connected account does not decode to a 32-byte public key")
      }
      authenticationKeyHex = u8aToHex(publicKey)
    }
  } catch (error) {
    didCreateFromAccountError.value = error instanceof Error ? error.message : "Invalid authenticationKey"
    return
  }

  const authenticationKey = {
    Sr25519: authenticationKeyHex
  }

  submittingDidCreateFromAccount.value = true

  let provider: { disconnect: () => void } | undefined
  let api: { disconnect: () => Promise<void>; tx?: unknown; registry?: { findMetaError?: unknown } } | undefined

  try {
    const endpoint = session.networkEndpoint || runtimeConfig.public.xcavateWsEndpoint
    const [{ ApiPromise, WsProvider }, { web3FromAddress }] = await Promise.all([
      import("@polkadot/api"),
      import("@polkadot/extension-dapp")
    ])

    provider = new WsProvider(endpoint)
    api = await ApiPromise.create({ provider })

    const didTx = (api.tx as {
      did?: {
        createFromAccount?: (authenticationKeyArg: unknown) => { signAndSend: unknown }
      }
    }).did?.createFromAccount

    if (typeof didTx !== "function") {
      throw new Error("did.createFromAccount extrinsic is not available on this chain")
    }

    const injector = await web3FromAddress(connectedAddress)
    const tx = didTx(authenticationKey)

    didCreateFromAccountStatus.value = "Submitting extrinsic..."
    operations.add("did_write", connectedAddress, "info", "Submitting did.createFromAccount extrinsic")

    await submitWatchedExtrinsic({
      tx: tx as SubmittableWithWatch,
      connectedAddress,
      signer: injector.signer,
      apiForErrors: api ?? {},
      onTxHash: (txHash) => {
        didCreateFromAccountTxHash.value = txHash
      },
      onStatus: (status) => {
        didCreateFromAccountStatus.value = status
      }
    })

    operations.add(
      "did_write",
      connectedAddress,
      "success",
      `did.createFromAccount finalized${didCreateFromAccountTxHash.value ? ` (${didCreateFromAccountTxHash.value})` : ""}`
    )
  } catch (error) {
    didCreateFromAccountError.value = error instanceof Error ? error.message : "Unable to submit did.createFromAccount extrinsic"
    didCreateFromAccountStatus.value = ""
    operations.add("did_write", connectedAddress, "error", didCreateFromAccountError.value)
  } finally {
    submittingDidCreateFromAccount.value = false

    if (api) {
      await api.disconnect().catch(() => undefined)
    }
    if (provider) {
      provider.disconnect()
    }
  }
}

async function submitDidAddKeyAgreementExtrinsic(): Promise<void> {
  didAddKeyAgreementError.value = null
  didAddKeyAgreementStatus.value = ""
  didAddKeyAgreementTxHash.value = ""

  const connectedAddress = session.accountAddress
  if (!connectedAddress) {
    didAddKeyAgreementError.value = "Connect wallet before submitting did.addKeyAgreementKey extrinsic"
    return
  }

  let newKeyHex = ""
  try {
    newKeyHex = encodeAgreementXToHex(didAddKeyAgreementX.value)
  } catch (error) {
    didAddKeyAgreementError.value = error instanceof Error ? error.message : "Invalid key agreement x value"
    return
  }

  const newKey = {
    X25519: newKeyHex
  }

  submittingDidAddKeyAgreement.value = true

  let provider: { disconnect: () => void } | undefined
  let api: { disconnect: () => Promise<void>; tx?: unknown; registry?: { findMetaError?: unknown } } | undefined

  try {
    const endpoint = session.networkEndpoint || runtimeConfig.public.xcavateWsEndpoint || defaultEndpoint
    const [{ ApiPromise, WsProvider }, { web3FromAddress }] = await Promise.all([
      import("@polkadot/api"),
      import("@polkadot/extension-dapp")
    ])

    provider = new WsProvider(endpoint)
    api = await ApiPromise.create({ provider })

    const didTx = (api.tx as {
      did?: {
        addKeyAgreementKey?: (newKeyArg: unknown) => { signAndSend: unknown }
      }
    }).did?.addKeyAgreementKey

    if (typeof didTx !== "function") {
      throw new Error("did.addKeyAgreementKey extrinsic is not available on this chain")
    }

    const injector = await web3FromAddress(connectedAddress)
    const tx = didTx(newKey)

    didAddKeyAgreementStatus.value = "Submitting extrinsic..."
    operations.add("did_write", connectedAddress, "info", "Submitting did.addKeyAgreementKey extrinsic")

    await submitWatchedExtrinsic({
      tx: tx as SubmittableWithWatch,
      connectedAddress,
      signer: injector.signer,
      apiForErrors: api ?? {},
      onTxHash: (txHash) => {
        didAddKeyAgreementTxHash.value = txHash
      },
      onStatus: (status) => {
        didAddKeyAgreementStatus.value = status
      }
    })

    operations.add(
      "did_write",
      connectedAddress,
      "success",
      `did.addKeyAgreementKey finalized${didAddKeyAgreementTxHash.value ? ` (${didAddKeyAgreementTxHash.value})` : ""}`
    )
  } catch (error) {
    didAddKeyAgreementError.value = error instanceof Error ? error.message : "Unable to submit did.addKeyAgreementKey extrinsic"
    didAddKeyAgreementStatus.value = ""
    operations.add("did_write", connectedAddress, "error", didAddKeyAgreementError.value)
  } finally {
    submittingDidAddKeyAgreement.value = false

    if (api) {
      await api.disconnect().catch(() => undefined)
    }
    if (provider) {
      provider.disconnect()
    }
  }
}

function downloadJson(): void {
  if (!import.meta.client || !jwkJson.value) {
    return
  }

  const fileName = `x25519-jwk-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
  const blob = new Blob([jwkJson.value], { type: "application/json" })
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement("a")

  link.href = objectUrl
  link.download = fileName
  link.click()

  URL.revokeObjectURL(objectUrl)
}

const mnemonicWords = computed(() => (mnemonic.value ? mnemonic.value.split(" ").filter(Boolean) : []))
const displayedSs58Address = computed(() => formatAddress(ss58Address.value))
const displayedDerivedDidAddress = computed(() => formatAddress(derivedDidAddress.value))
</script>

<template>
  <main class="container did-page stack">
    <PageHeader title="DID Management" />

    <section class="card stack">
      <div class="row section-header">
        <h4 style="margin: 0; font-size: 16px;">DID Search</h4>
      </div>

      <div class="row">
        <input v-model="didSearchAddress" class="input address-value" style="flex: 1" type="text" placeholder="Enter SS58 Address..." :disabled="searchingDid" />
        <button class="btn btn-primary" type="button" @click="searchDidByAddress" :disabled="searchingDid">
          {{ searchingDid ? "Searching..." : "Search" }}
        </button>
      </div>

      <p v-if="didSearchError" class="error-text">{{ didSearchError }}</p>

      <div v-if="didSearchResultJson" class="address-card">
        <p class="muted" style="margin: 0 0 6px">Returned JSON</p>
        <pre class="address-value" aria-label="DID search result JSON">{{ didSearchResultJson }}</pre>
      </div>
    </section>

    <section class="card stack">
      <div class="row section-header">
        <h4 style="margin: 0; font-size: 16px;">DID (Sr25519) Key</h4>
        <div class="row">
          <button class="btn btn-primary" type="button" @click="generateMnemonic" :disabled="generatingMnemonic">
            {{ generatingMnemonic ? "Generating..." : "Generate Mnemonic" }}
          </button>
          <button class="btn" type="button" @click="copyMnemonic" :disabled="!mnemonic">
            {{ mnemonicCopied ? "Copied" : "Copy Mnemonic" }}
          </button>
        </div>
      </div>

      <p v-if="mnemonicError" class="error-text">{{ mnemonicError }}</p>

      <div v-if="mnemonicWords.length" class="mnemonic-grid" aria-label="Generated mnemonic words">
        <span v-for="(word, index) in mnemonicWords" :key="`${index}-${word}`" class="mnemonic-word">
          {{ index + 1 }}. {{ word }}
        </span>
      </div>

      <div v-if="ss58Address" class="address-card">
        <p class="muted" style="margin: 0">SS58 Address</p>
        <p style="margin: 4px 0 0" class="address-value">{{ displayedSs58Address }}</p>
      </div>
    </section>

    <section class="card stack">
      <div class="row section-header">
        <h4 style="margin: 0; font-size: 16px;">X25519 Key</h4>
        <div class="row">
          <button class="btn btn-primary" type="button" @click="generateJwk" :disabled="generatingJwk">
            {{ generatingJwk ? "Generating..." : "Generate X25519" }}
          </button>
          <button class="btn" type="button" @click="downloadJson" :disabled="!hasJwk">Download JSON</button>
        </div>
      </div>

      <p v-if="jwkError" class="error-text">{{ jwkError }}</p>

      <div v-if="hasJwk" class="address-card">
        <pre v-if="hasJwk" class="address-value" aria-label="Generated JWK JSON">{{ jwkJson }}</pre>
      </div>
    </section>

    <section class="card stack">
      <div class="row section-header">
        <h4 style="margin: 0; font-size: 16px;">Register DID</h4>
      </div>

      <label class="stack field-group">
        <span>DID address</span>
        <input v-model="didCreateDidAddress" class="input address-value" type="text" placeholder="Enter SS58 Address ..." :disabled="submittingDidCreate" />
      </label>

      <label class="stack field-group">
        <span>DID mnemonic (used to sign creation details)</span>
        <textarea
          v-model="didCreateMnemonic"
          class="input mnemonic-input"
          rows="2"
          placeholder="word1 word2 word3 word4 ..."
          :disabled="submittingDidCreate"
        />
      </label>

      <label class="stack field-group">
        <span>Encryption key</span>
        <input
          v-model="didCreateKeyAgreementX"
          class="input address-value"
          type="text"
          placeholder="Enter your X25519 key ..."
          :disabled="submittingDidCreate"
        />
      </label>

      <div class="row section-header" style="justify-content: end">
        <button class="btn btn-primary" type="button" @click="submitDidCreateExtrinsic" :disabled="submittingDidCreate || !isDidCreateFormValid">
          {{ submittingDidCreate ? "Submitting extrinsic ..." : "Submit did.create extrinsic" }}
        </button>
      </div>

      <p v-if="didCreateError" class="error-text">{{ didCreateError }}</p>
    </section>

    <section v-if="settings.showMessageDebug" class="card stack">
      <div class="row section-header">
        <h4 style="margin: 0; font-size: 16px;">DID Signing</h4>
      </div>

      <label class="stack field-group">
        <span>DID mnemonic</span>
        <textarea
          v-model="didSignMnemonic"
          class="input mnemonic-input"
          rows="2"
          placeholder="word1 word2 ..."
        />
      </label>

      <label class="stack field-group">
        <span>Hex encoded data to sign</span>
        <textarea
          v-model="didSignPayloadHex"
          class="input address-value"
          rows="2"
          placeholder="0x..."
        />
      </label>

      <label class="stack field-group">
        <span>Submitter Address (defaults to connected wallet)</span>
        <input v-model="didSignSubmitterAddress" class="input address-value" type="text" placeholder="5F..." />
      </label>

      <label class="stack field-group">
        <span>Verification Key Relationship</span>
        <select v-model="didSignKeyRelationship" class="input">
          <option value="Authentication">Authentication</option>
          <option value="CapabilityDelegation">CapabilityDelegation</option>
          <option value="CapabilityInvocation">CapabilityInvocation</option>
          <option value="AssertionMethod">AssertionMethod</option>
        </select>
      </label>

      <div class="row section-header" style="justify-content: end">
        <button class="btn btn-primary" type="button" @click="signPayload" :disabled="!didSignMnemonic || !didSignPayloadHex">
          Sign Data
        </button>
      </div>

      <p v-if="didSignError" class="error-text">{{ didSignError }}</p>

      <div v-if="didSignSignature" class="address-card stack">
        <div class="row section-header">
          <p class="muted" style="margin: 0">Signature (Sr25519)</p>
          <button class="btn" type="button" @click="copySignature">
            {{ didSignSignatureCopied ? "Copied" : "Copy" }}
          </button>
        </div>
        <div v-if="didSignTxCounter !== null || didSignBlockNumber !== null" class="row">
          <p class="muted" style="margin: 0">
            <strong>txCounter:</strong> {{ didSignTxCounter }}
            <span style="margin: 0 8px">|</span>
            <strong>blockNumber:</strong> {{ didSignBlockNumber }}
          </p>
        </div>
        <p class="address-value" style="margin: 4px 0 0; word-break: break-all;">{{ didSignSignature }}</p>

        <div class="row section-header" style="margin-top: 12px">
          <p class="muted" style="margin: 0">Payload Signed (Debug)</p>
        </div>
        <p class="address-value" style="margin: 4px 0 0; word-break: break-all; font-size: 0.85em; color: #888;">{{ didSignPayloadDebug }}</p>
      </div>
    </section>
  </main>
</template>

<style scoped>
.did-page {
  padding-top: 12px;
  padding-bottom: 24px;
}


.section-header {
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
}

.mnemonic-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 8px;
}

.mnemonic-word {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  border: 1px solid var(--border-default);
  border-radius: 8px;
  padding: 4px 8px;
  background: color-mix(in srgb, var(--surface-bg) 68%, var(--surface-card));
}

.address-card {
  border: 1px solid var(--border-default);
  border-radius: 8px;
  padding: 10px 12px;
  background: color-mix(in srgb, var(--surface-bg) 70%, var(--surface-card));
}

.address-value {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 13px;
  overflow-wrap: anywhere;
}

.jwk-json {
  margin: 0;
  max-height: 360px;
  overflow: auto;
  border: 1px solid var(--border-default);
  border-radius: 8px;
  padding: 12px;
  background: var(--color-gray-900);
  color: var(--color-gray-50);
  font-size: 0.86rem;
  line-height: 1.5;
}

.error-text {
  margin: 0;
  color: var(--status-error);
}

.field-group {
  gap: 6px;
}

.mnemonic-input {
  resize: vertical;
}
</style>

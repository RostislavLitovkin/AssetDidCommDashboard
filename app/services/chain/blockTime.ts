import { hexToU8a } from "@polkadot/util"
import { xxhashAsHex } from "@polkadot/util-crypto"

/** Milliseconds per block on the Xcavate solochain (fixed 6 second block time). */
export const DEFAULT_BLOCK_TIME_MS = 6000

/**
 * Storage key for `pallet_timestamp`'s `Now` value: twox128("Timestamp") ++
 * twox128("Now"). It is identical on every Substrate chain, so it can be
 * precomputed once and reused for `state_getStorage` calls.
 */
export const TIMESTAMP_STORAGE_KEY =
  `${xxhashAsHex("Timestamp", 128)}${xxhashAsHex("Now", 128).slice(2)}`

/**
 * Decodes a SCALE-encoded `u64` moment (little-endian, milliseconds) as returned
 * by `state_getStorage` for {@link TIMESTAMP_STORAGE_KEY}. Returns null for
 * empty, non-hex, or too-short values.
 */
export function parseTimestampU64(value: string | null | undefined): number | null {
  if (!value || !value.startsWith("0x")) return null
  const bytes = hexToU8a(value)
  if (bytes.length < 8) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return Number(view.getBigUint64(0, true))
}

/**
 * Estimates a block's timestamp (ms) from a single known anchor block, assuming a
 * fixed block time. Blocks before the anchor yield earlier timestamps, blocks
 * after it yield later ones. Lets a page fetch one real on-chain timestamp and
 * derive the rest instead of querying every block.
 */
export function deriveBlockTimestampMs(
  anchorBlock: number,
  anchorTimestampMs: number,
  targetBlock: number,
  blockTimeMs: number = DEFAULT_BLOCK_TIME_MS
): number {
  return anchorTimestampMs + (targetBlock - anchorBlock) * blockTimeMs
}

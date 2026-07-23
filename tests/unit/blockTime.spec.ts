import { describe, expect, it } from "vitest"
import {
  DEFAULT_BLOCK_TIME_MS,
  TIMESTAMP_STORAGE_KEY,
  deriveBlockTimestampMs,
  parseTimestampU64
} from "../../app/services/chain/blockTime"

function encodeU64Le(value: number): string {
  const view = new DataView(new ArrayBuffer(8))
  view.setBigUint64(0, BigInt(value), true)
  return `0x${Array.from(new Uint8Array(view.buffer), b => b.toString(16).padStart(2, "0")).join("")}`
}

describe("TIMESTAMP_STORAGE_KEY", () => {
  it("is the well-known twox128(Timestamp) ++ twox128(Now) storage key", () => {
    expect(TIMESTAMP_STORAGE_KEY).toBe(
      "0xf0c365c3cf59d671eb72da0e7a4113c49f1f0515f462cdcf84e0f1d6045dfcbb"
    )
  })
})

describe("parseTimestampU64", () => {
  it("decodes a little-endian u64 moment (milliseconds)", () => {
    const ms = 1_700_000_000_000
    expect(parseTimestampU64(encodeU64Le(ms))).toBe(ms)
  })

  it("returns null for empty, non-hex, or too-short values", () => {
    expect(parseTimestampU64(null)).toBeNull()
    expect(parseTimestampU64(undefined)).toBeNull()
    expect(parseTimestampU64("")).toBeNull()
    expect(parseTimestampU64("0x")).toBeNull()
    expect(parseTimestampU64("0x0102")).toBeNull()
    expect(parseTimestampU64("deadbeef")).toBeNull()
  })
})

describe("deriveBlockTimestampMs", () => {
  const anchorBlock = 100
  const anchorMs = 1_700_000_000_000

  it("returns the anchor timestamp for the anchor block itself", () => {
    expect(deriveBlockTimestampMs(anchorBlock, anchorMs, anchorBlock)).toBe(anchorMs)
  })

  it("subtracts one block time per block for earlier blocks", () => {
    expect(deriveBlockTimestampMs(anchorBlock, anchorMs, anchorBlock - 10))
      .toBe(anchorMs - 10 * DEFAULT_BLOCK_TIME_MS)
  })

  it("adds one block time per block for later blocks", () => {
    expect(deriveBlockTimestampMs(anchorBlock, anchorMs, anchorBlock + 5))
      .toBe(anchorMs + 5 * DEFAULT_BLOCK_TIME_MS)
  })

  it("honours a custom block time", () => {
    expect(deriveBlockTimestampMs(10, 1000, 12, 3000)).toBe(1000 + 2 * 3000)
  })

  it("uses a 6 second default block time", () => {
    expect(DEFAULT_BLOCK_TIME_MS).toBe(6000)
  })
})

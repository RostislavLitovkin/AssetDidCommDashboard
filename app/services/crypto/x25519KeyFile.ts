/**
 * Turns generated X25519 key material into the JSON file the user downloads.
 *
 * The payload deliberately matches `X25519KeyService.export()` — a
 * `{ publicJwk, privateJwk }` envelope — because that is the shape the sidebar's
 * "Load X25519 Key" file picker accepts. A downloaded key therefore imports
 * again as-is.
 */

import type { KeyMaterial } from "../../types/keys"

const FALLBACK_FILE_NAME = "x25519-key.json"

/** Key ids are generated (`<timestamp>-<random>`), but a key can also arrive
 * from a host or a file, so anything that is not filename-safe is dropped. */
function fileNameFor(keyId: string): string {
  return /^[A-Za-z0-9._-]+$/.test(keyId) ? `x25519-key-${keyId}.json` : FALLBACK_FILE_NAME
}

export interface X25519KeyFile {
  fileName: string
  json: string
}

/**
 * Builds the download for `material`. Throws when the private half is missing —
 * a file without it cannot restore the key, so writing one would be a trap.
 */
export function buildX25519KeyFile(material: KeyMaterial): X25519KeyFile {
  if (!material.privateJwk) {
    throw new Error("Cannot export an X25519 key without its private JWK.")
  }

  return {
    fileName: fileNameFor(material.keyId),
    json: JSON.stringify({ publicJwk: material.publicJwk, privateJwk: material.privateJwk }, null, 2)
  }
}

/** Saves `file` to the user's downloads via a transient object URL. */
export function downloadX25519KeyFile(file: X25519KeyFile): void {
  const blob = new Blob([file.json], { type: "application/json" })
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = objectUrl
  link.download = file.fileName
  link.click()
  URL.revokeObjectURL(objectUrl)
}

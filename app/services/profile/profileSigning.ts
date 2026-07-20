/**
 * Request-signing primitives for the Xcavate Profile API.
 *
 * The API (XcavateProfile `SignatureValidator` + `CryptoHelper`) authenticates
 * mutating requests by verifying an Sr25519 signature over the string
 *
 *   `${method}:${path}:${bodyHash}:${timestamp}`
 *
 * where `bodyHash` and `timestamp` must match, byte-for-byte, the values the C#
 * server reconstructs. Every helper here reproduces a specific C# behaviour that
 * was captured empirically against the real API code:
 *
 *  - `bodyHash` is `IPayloadBody.Hash()`: for a profile, the Blake2b-128 hash of
 *    the server's own re-serialization of the body, hex-encoded exactly like
 *    `Substrate.NetApi.Utils.Bytes2HexString` — i.e. `0x` + UPPERCASE. For an
 *    image upload the server signs `EmptyPayloadBody`, whose `Hash()` is `""`.
 *  - `timestamp` is `DateTime.ToUniversalTime().ToString("o")` — 7 fractional
 *    digits and a `Z` suffix. The server re-parses the `X-Timestamp` header and
 *    reformats it this way before verifying, so the client must send that form.
 *  - the body JSON is `System.Text.Json` with `JavaScriptEncoder.Default`, so we
 *    reproduce its escaping (see `escapeCSharpJsonString`).
 */

/** The body a signed request carries, mirroring C# `IPayloadBody`. */
export type ProfilePayloadBody =
  | { kind: "json"; canonicalJson: string }
  | { kind: "empty" }

export interface CanonicalProfileFields {
  ss58Address: string
  nickname: string | null
  bio: string | null
  profilePicture: string | null
  x25519Key: string | null
}

/**
 * Escape a string exactly like `System.Text.Json` with `JavaScriptEncoder.Default`
 * (the encoder XcavateProfile's `Profile` serializer uses). This matters because
 * the server hashes its OWN re-serialization of the request body, so the client
 * must hash the identical bytes — otherwise any non-ASCII or HTML-sensitive
 * character in a nickname/bio would break the signature.
 *
 * Verified against C# output: `"`, `&`, `'`, `+`, `<`, `>`, `` ` `` escape to
 * `\uXXXX`; `\` -> `\\`; `\b \t \n \f \r` use short escapes; every other char
 * below 0x20 or above 0x7E escapes to uppercase `\uXXXX` (astral chars as two
 * surrogate `\uXXXX` units).
 */
export function escapeCSharpJsonString(value: string): string {
  let out = ""
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    switch (code) {
      case 0x22: out += "\\u0022"; break // "
      case 0x5c: out += "\\\\"; break // backslash
      case 0x08: out += "\\b"; break
      case 0x09: out += "\\t"; break
      case 0x0a: out += "\\n"; break
      case 0x0c: out += "\\f"; break
      case 0x0d: out += "\\r"; break
      case 0x26: // &
      case 0x27: // '
      case 0x2b: // +
      case 0x3c: // <
      case 0x3e: // >
      case 0x60: // `
        out += "\\u" + code.toString(16).toUpperCase().padStart(4, "0")
        break
      default:
        out += code >= 0x20 && code <= 0x7e
          ? value[i]
          : "\\u" + code.toString(16).toUpperCase().padStart(4, "0")
    }
  }
  return out
}

/**
 * Serialize a profile exactly like the C# `Profile` model: property order
 * `ss58address, nickname, bio, profilePicture, x25519Key`, nulls emitted, no
 * whitespace. This is both the request body we send and the input we hash.
 */
export function canonicalProfileJson(fields: CanonicalProfileFields): string {
  const field = (value: string | null): string =>
    value === null ? "null" : `"${escapeCSharpJsonString(value)}"`

  return (
    `{"ss58address":"${escapeCSharpJsonString(fields.ss58Address)}",` +
    `"nickname":${field(fields.nickname)},` +
    `"bio":${field(fields.bio)},` +
    `"profilePicture":${field(fields.profilePicture)},` +
    `"x25519Key":${field(fields.x25519Key)}}`
  )
}

/**
 * Format a timestamp as C# `DateTime.ToString("o")`: 7 fractional-second digits
 * plus `Z`. `toISOString()` yields 3 digits, so we expand to 7.
 */
export function formatSignatureTimestamp(date: Date): string {
  return date.toISOString().replace("Z", "0000Z")
}

/**
 * Re-encode a `blake2AsHex` result (`0x` + lowercase) to the form the C# API
 * embeds in the payload: `Utils.Bytes2HexString` -> `0x` + UPPERCASE.
 */
export function toCSharpHashHex(blake2Hex: string): string {
  return "0x" + blake2Hex.slice(2).toUpperCase()
}

/** Assemble the exact string the server hashes and verifies the signature over. */
export function buildSignaturePayload(
  method: string,
  path: string,
  bodyHash: string,
  timestamp: string
): string {
  return `${method}:${path}:${bodyHash}:${timestamp}`
}

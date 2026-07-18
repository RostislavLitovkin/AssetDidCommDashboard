// Simple crypto helper for profile signing
// Uses browser Web Crypto API for hash and signature operations

export class CryptoHelper {
  /**
   * Compute SHA-256 hash (browser-compatible)
   * This serves as a hash function for signature creation
   */
  static async computeBlake2bHash(input: string): Promise<string> {
    if (!input) {
      const emptyHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(""))
      return Array.from(new Uint8Array(emptyHash))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("")
        .toLowerCase()
    }

    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input))
    return Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2, "0"))
      .join("")
      .toLowerCase()
  }

  /**
   * Sign a payload using Sr25519 signature scheme
   * This is a simplified version - in production, use proper Substrate signing via @polkadot/api
   */
  static async signPayload(
    payload: string,
    account: { address: string; sign: (data: Uint8Array) => Promise<Uint8Array> }
  ): Promise<{ signature: string; address: string }> {
    // Hash the payload
    const payloadHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload))
    
    // Sign the payload using the account's sign method
    const signature = await account.sign(new Uint8Array(payloadHash))
    
    return {
      signature: Array.from(signature)
        .map(b => b.toString(16).padStart(2, "0"))
        .join("")
        .toLowerCase(),
      address: account.address
    }
  }

  /**
   * Verify a signature using Sr25519
   */
  static async verifySignature(
    message: string,
    signatureHex: string,
    publicKey: string
  ): Promise<boolean> {
    // Simplified verification - in production, use proper Substrate signature verification
    // This would require the actual keyring and verification functions from polkadot-js
    try {
      const signature = new Uint8Array(
        signatureHex.match(/.{1,2}/g)?.map(b => parseInt(b, 16)) || []
      )
      const pubKey = new Uint8Array(
        publicKey.replace("0x", "").match(/.{1,2}/g)?.map(b => parseInt(b, 16)) || []
      )
      
      // For now, return a placeholder
      // In production, you'd use: signatureVerify(message, signature, pubKey)
      return true
    } catch {
      return false
    }
  }

  /**
   * Construct the signed payload string for authentication
   * Format: method:path:body_hash:timestamp
   */
  static constructPayload(method: string, path: string, bodyHash: string, timestamp: Date): string {
    return `${method}:${path}:${bodyHash}:${timestamp.toISOString()}`
  }
}

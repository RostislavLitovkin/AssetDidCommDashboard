# Contract: X25519 Key Management

## Purpose
Define frontend crypto service interface for key generation, import, export, and validation.

## Methods

### `generateKeyPair(): Promise<KeyMaterial>`
- Behavior:
  - Generates X25519-compatible keypair.
  - Returns normalized key metadata for UI/store consumption.

### `importKeyPair(fileContent: string): Promise<KeyMaterial>`
- Behavior:
  - Parses and validates key material.
  - Rejects malformed/incompatible inputs with explicit error codes.
- Failures:
  - `KEY_PARSE_ERROR`
  - `KEY_VALIDATION_ERROR`
  - `KEY_ALGORITHM_UNSUPPORTED`

### `exportKeyPair(keyId: string): Promise<ExportedKeyFile>`
- Behavior:
  - Produces canonical export payload that can be re-imported.

### `validateKeyMaterial(candidate: unknown): ValidationResult`
- Behavior:
  - Performs strict structural and algorithm checks.

## Contract Rules
- Imported/generated keys MUST be tagged with deterministic local key identifiers.
- Private key material MUST remain session-scoped in v1 unless explicitly exported by user action.
- Error messages MUST be actionable and safe for user display.

# Data Model: Asset DIDComm Admin Dashboard

## 1) AdminSession
- Description: Active admin context derived from wallet extension connection.
- Fields:
  - `sessionId` (string, required)
  - `accountAddress` (string, required)
  - `walletStatus` (enum: `disconnected | connecting | connected | rejected | unavailable`, required)
  - `networkEndpoint` (string, required, default: `wss://xcavate-paseo.api.onfinality.io/public-ws`)
  - `connectedAt` (datetime, optional)
  - `lastAccountChangeAt` (datetime, optional)
- Validation Rules:
  - `accountAddress` required when `walletStatus=connected`.
  - `networkEndpoint` must be valid secure WebSocket URL.

## 2) DidRecord
- Description: DID details and retrieval metadata for an account identity.
- Fields:
  - `didUri` (string, optional)
  - `subjectId` (string, required)
  - `status` (enum: `found | not_found | failed`, required)
  - `source` (enum: `did_pallet | did_lookup | unknown`, required)
  - `details` (object/map, optional)
  - `lastRefreshedAt` (datetime, optional)
  - `errorMessage` (string, optional)
- Validation Rules:
  - `didUri` required only when `status=found`.
  - `source` must be explicit for every read attempt.

## 3) DidOperation
- Description: User-initiated DID write operation lifecycle.
- Fields:
  - `operationId` (string, required)
  - `type` (enum: `register | update`, required)
  - `subjectId` (string, required)
  - `payloadSummary` (object/map, required)
  - `state` (enum: `draft | submitted | pending | succeeded | failed`, required)
  - `submittedAt` (datetime, optional)
  - `completedAt` (datetime, optional)
  - `resultMessage` (string, optional)
- Validation Rules:
  - Transition to `submitted` requires connected wallet.
  - `failed` state must include `resultMessage`.

## 4) KeyMaterial
- Description: X25519 key metadata and safe handling state for admin workflow.
- Fields:
  - `keyId` (string, required)
  - `algorithm` (string, required, fixed family: X25519)
  - `origin` (enum: `generated | imported`, required)
  - `publicJwk` (object, required)
  - `privateJwk` (object, optional; session-scoped)
  - `canExport` (boolean, required)
  - `validationState` (enum: `valid | invalid`, required)
  - `createdAt` (datetime, required)
- Validation Rules:
  - `publicJwk` and `privateJwk` must match the expected key family on validation.
  - `privateJwk` is never required for read-only display operations.

## 5) ActionLogEntry
- Description: Session-visible audit event for operational traceability.
- Fields:
  - `entryId` (string, required)
  - `category` (enum: `wallet | did_read | did_write | key_mgmt`, required)
  - `targetRef` (string, required)
  - `status` (enum: `success | warning | error | info`, required)
  - `message` (string, required)
  - `timestamp` (datetime, required)
- Validation Rules:
  - Every completed DID/key action must produce one log entry.

## Relationships
- `AdminSession` 1 → many `DidOperation`
- `AdminSession` 1 → many `ActionLogEntry`
- `AdminSession` 1 → many `KeyMaterial` (session view)
- `DidRecord` 1 ↔ many `DidOperation` (by `subjectId` / `didUri`)

## State Transitions

### Wallet State
`disconnected -> connecting -> connected`
`connecting -> rejected`
`connecting -> unavailable`
`connected -> disconnected` (manual disconnect or extension/account change)

### DID Operation State
`draft -> submitted -> pending -> succeeded`
`draft -> submitted -> pending -> failed`
`failed -> draft` (user retries with revised input)

### Key Validation State
`invalid -> valid` (after successful parse/validation)
`valid -> invalid` (if data corruption or incompatible import detected)

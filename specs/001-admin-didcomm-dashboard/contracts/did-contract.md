# Contract: DID Service (PAPI-backed)

## Purpose
Define service boundaries for DID read/register/update workflows against chain runtime.

## Methods

### `fetchDid(subjectId: string): Promise<DidFetchResult>`
- Behavior:
  - Queries primary DID source first.
  - Falls back to DID lookup source when primary has no result.
- Output:
  - `status`: `found | not_found | failed`
  - `source`: `did_pallet | did_lookup | unknown`
  - `didRecord`: optional payload when found

### `registerDid(input: DidRegistrationInput): Promise<DidWriteResult>`
- Preconditions:
  - Wallet connected and account identity available.
- Behavior:
  - Submits DID registration operation and reports lifecycle status.

### `updateDid(input: DidUpdateInput): Promise<DidWriteResult>`
- Preconditions:
  - Existing DID record is resolvable.
  - Wallet connected and account identity available.

## Contract Rules
- Service MUST return normalized operation states: `submitted`, `pending`, `succeeded`, `failed`.
- On rejection/failure, service MUST include actionable reason text.
- Service responses MUST be UI-agnostic and domain-focused.

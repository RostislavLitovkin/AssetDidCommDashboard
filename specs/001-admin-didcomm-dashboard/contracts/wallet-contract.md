# Contract: Wallet Integration

## Purpose
Define the frontend-side wallet interface used by composables and stores.

## Methods

### `connect(): Promise<WalletSession>`
- Behavior:
  - Requests connection to supported extension wallet.
  - Resolves with active account and provider metadata.
- Failures:
  - `WALLET_EXTENSION_UNAVAILABLE`
  - `WALLET_CONNECTION_REJECTED`

### `disconnect(): Promise<void>`
- Behavior:
  - Clears active wallet session and listeners.

### `getActiveAccount(): Promise<AccountIdentity | null>`
- Behavior:
  - Returns currently active account identity or `null`.

### `subscribeAccountChanges(handler): Unsubscribe`
- Behavior:
  - Emits account-change events used to invalidate stale DID/key context.

## Contract Rules
- Consumers MUST block DID write actions unless session is connected.
- Provider errors MUST be translated to user-readable states.

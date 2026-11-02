# SPV lawyer vote approval messages

## Intent

Every successful marketplace `vote_on_spv_lawyer` instruction must produce an encrypted chat message whose plaintext is exactly `Approved terms` in the voted candidacy's lawyer-terms bucket. The message contributor is the transaction's voter address. No voter signature is required by the profile API webhook; the existing indexer webhook secret authenticates the server-to-server call.

## Goals and constraints

- Use the indexer's durable, idempotent webhook pipeline so backfills and retries are safe.
- Take the voter from instruction account 0, the candidacy from account 6, and the listing id from the instruction arguments.
- Locate the existing `spv-lawyer-terms` bucket by namespace listing id and the candidacy stored in its properties.
- Use the existing bucket admin key to decrypt the latest key-sharing message and encrypt the approval with the same bucket key protocol as the vote prompt.
- Ensure the voter is a contributor before writing, without adding a new client-side signing flow.
- Return a retryable response while the namespace, terms bucket, or required admin configuration is unavailable.
- Deduplicate by the transaction-scoped message reference so repeated delivery does not duplicate the chat message; separate votes remain separate messages.
- Preserve the dashboard's existing uncommitted election-finalization work.

Non-goals: changing the on-chain vote instruction, adding a new webhook authentication mechanism, or changing election finalization behavior.

## Approaches

1. **Durable `spv_lawyer_vote_cast` webhook (selected).** Add one mapper event and route, one authenticated profile API endpoint, and a tagged encrypted dashboard chat message. This reuses proven retry, backoff, and backfill behavior.
2. Direct HTTP from instruction mapping. Rejected: the mapper is deliberately pure and a failed network call could lose the on-chain event.
3. Client-side write after the vote transaction. Rejected: it would require a wallet signature, would not cover votes from other clients, and could lose the message when the browser closes.

## Implementation

- Indexer: emit `spv_lawyer_vote_cast` with `property_id`, `voter`, `candidacy`, `amount`, listing PDA, cluster, slot, transaction signature, instruction path, block time, and program. Route it with `SPV_LAWYER_VOTE_CAST_WEBHOOK_URL`.
- Profile API: accept `POST /webhooks/spv_lawyer_vote_cast_devnet` under the existing `IndexerWebhookSecret` guard. Validate the payload, find the bucket, decrypt its latest key-sharing payload with `BUCKET_ADMIN_X25519_KEY`, add the voter as contributor through the configured bucket admin, and write compact-JWE plaintext `Approved terms` under tag `lawyer/terms-approved` and reference `lawyer-terms/{candidacy}/approved/{tx_signature}`.
- Dashboard: recognize `lawyer/terms-approved` as a normal encrypted chat message and give its bubble an approval-specific visual treatment while retaining the voter as sender.
- Configuration: document the new route without committing its secret value. Set `INDEXER_WEBHOOK_SECRET` and the secret-bearing indexer route in GitHub repository secrets through `gh`.

## Verification

- Rust mapper tests pin the voter/candidacy/amount payload and transaction-scoped id; configuration tests pin the route.
- Profile API webhook tests post real JSON through the authenticated endpoint, decrypt the stored message, and assert exact plaintext, contributor, bucket, reference, encryption, and redelivery behavior.
- Dashboard unit tests pin the approval-tag behavior; standard typecheck/unit tests cover the existing chat flow.
- Run each repository's standard formatting, build, and test checks before committing directly to its current branch as requested.

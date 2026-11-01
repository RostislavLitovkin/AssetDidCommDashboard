# Lawyer document review

The dashboard's lawyer-review services, `useLawyerReview` composable, and `LawyerReviewPanel` support document review for buckets in the `lawyer-document-review` category. Review authority comes from the two lawyer seats returned by Indexer, not from bucket membership, investor voting power, or chat messages.

## Current integration status

The current worktree integrates the review services, composable, and presentational panel into the existing `/indexed-bucket/[id]` page. The page imports and renders `LawyerReviewPanel` and calls `useLawyerReview`, so the browser chat route now orchestrates the review flow end to end.

The design and implementation plan are in:

- `docs/superpowers/specs/2026-11-01-lawyer-chat-review-design.md`
- `docs/superpowers/plans/2026-11-01-lawyer-chat-review.md`

## Bucket metadata

A valid review bucket has:

- `property_id`: the decimal property/listing identifier. Readers prefer this value and fall back to the legacy `listing_id`; if both are present, they must contain the same decimal value.
- `cluster`: exactly `devnet` or `mainnet`. A missing cluster is accepted only when the caller explicitly enables the legacy devnet compatibility fallback. The dashboard must not guess mainnet or silently switch clusters.
- `spv_lawyer` and `developer_lawyer`: the lawyer wallets recorded when the bucket was created. These are compared with current Indexer seats before actions are enabled.
- Optional `listing` and `property` PDA metadata.

New and redelivered buckets retain `listing_id` for compatibility. Metadata backfill is additive: it does not rotate the bucket encryption key or recreate the four initial messages.

## Chat review experience

The panel presents the property ID, cluster, review attempt, listing status, legal deadline, both lawyer wallets and verdicts, per-seat document hashes, and the current shared document-set hash. It also provides separate Approved, Rejected, and Pending progress meters.

Only the currently assigned SPV and developer lawyer wallets can submit an Approve or Reject verdict. Other viewers receive read-only review state. A verdict submission uses the connected wallet and the current shared hash; it does not create a chat message that pretends to be a chain vote. After submission, the composable reloads Indexer state instead of treating wallet submission alone as final chain state.

Both approvals with the same hash move the review toward the Legal state. The model also represents the first split verdict/second attempt, reset and cancellation states, and pending seats. When Indexer reports Legal status and settlement evidence is available, any connected wallet may execute the deal before the legal deadline. Wallet, simulation, and confirmation failures must be surfaced rather than reported as success.

## Two-seat counts and percentages

Percentages are derived locally from the two Indexer lawyer seats, with each seat worth 50%. They are not investor vote percentages.

| Seats in a verdict bucket | Count | Percentage |
| --- | ---: | ---: |
| 0 | 0 of 2 | 0% |
| 1 | 1 of 2 | 50% |
| 2 | 2 of 2 | 100% |

This calculation is applied independently to Approved, Rejected, and Pending. The panel also handles two error states explicitly: differing hashes on two approved seats disable transactions, and stale lawyer assignments disable transactions as described below.

## Current PDF revisions and document-set hash

Document selection starts with the first two PDF snapshots tagged `lawyer/terms-document`, ordered by message timestamp and then numeric message ID. The first is the SPV document and the second is the developer document.

A later `application/pdf` chat attachment replaces the current revision for a seat only when its contributor is the wallet currently assigned to that seat by Indexer. The latest qualifying revision wins. An assigned lawyer can therefore supply a missing document or revise terms for another attempt. PDFs from other contributors do not replace either seat's current document, and earlier snapshots remain in chat history.

Both current PDFs must be available and their exact bytes must load successfully before verdict submission is enabled. The client computes the shared hash in SPV-first order:

```text
SHA256(
  UTF8("XCAVATE_LEGAL_DOCUMENT_SET_V1")
  || uint64LE(spvByteLength) || spvBytes
  || uint64LE(developerByteLength) || developerBytes
)
```

The displayed `0x`-prefixed SHA-256 hash is shortened in the panel, with the full value available as its tooltip. Missing or unloadable documents make the shared hash unavailable and disable verdict submission. The hash is computed by the client; it is not supplied by the server and is not assumed to equal either assignment-time document hash.

## Stale assignments

On every review load, the dashboard compares the bucket's recorded SPV and developer lawyer wallets with the current seats returned by Indexer. If either seat differs, the bucket is marked stale. The panel explains that lawyer assignments changed, lawyer eligibility is removed, and verdict and settlement transactions are disabled.

A stale bucket is not silently rebound to the new lawyers. Membership re-keying and replacement-bucket lifecycle are outside this feature; reload only after the underlying bucket/assignment lifecycle has been handled explicitly.

## Cluster and Indexer configuration

Devnet uses the built-in devnet Indexer, Solana devnet RPC, `solana:devnet` wallet chain, and devnet explorer links.

Mainnet uses Solana mainnet-beta RPC and the `solana:mainnet` wallet chain. It additionally requires this environment variable before running or building the app:

```dotenv
NUXT_PUBLIC_INDEXER_MAINNET_GRAPHQL_URL=https://your-mainnet-indexer.example/graphql
```

Replace the example with the actual mainnet Indexer GraphQL URL. If the value is missing or blank, mainnet review loading and actions fail with `Mainnet Indexer GraphQL URL is not configured`. There is no devnet fallback.

## Verification boundary

Unit and component tests use mocked Indexer, wallet, document, and transaction interfaces. Running the dashboard test, typecheck, lint, or build commands does not submit a real devnet or mainnet transaction and must not be described as real-chain verification.

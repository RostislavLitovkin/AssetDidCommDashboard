# Lawyer chat review and settlement design

## Intent

Let the assigned SPV and developer lawyers complete their document review without leaving the property's encrypted chat. They need the current two-seat verdict, a shared document-set hash, and safe wallet-signed `lawyer_confirm_documents` and `execute_deal` actions. New review buckets must also identify their numeric property and Solana cluster explicitly.

## Goals

- Store `property_id` and `cluster` (`devnet` or `mainnet`) in every new lawyer-review bucket's metadata, retaining `listing_id` for compatibility.
- Additively backfill those keys when an existing review bucket is redelivered, without changing its encryption key or four initial messages.
- Resolve listing/lawyer/document/settlement state from Indexer rather than trusting chat membership or stale announcements.
- Present an accessible review panel inside the existing indexed chat page, inspired by bucket 39 but using lawyer-confirmation semantics.
- Let only the two assigned lawyer wallets submit approval/rejection with the same deterministic document-set hash.
- Let a connected wallet execute a ready deal using the complete program account layout, with transaction simulation and honest confirmation errors.
- Support devnet/mainnet coherently across program IDs, RPC, wallet chain, indexer endpoint, and explorer links.

## Non-goals and anti-goals

- Do not reuse token-holder voting power, candidacy elections, quorum, or investor share ownership as lawyer-confirmation authority.
- Do not make bucket admins, contributors, viewers, or arbitrary registered lawyers eligible to confirm documents.
- Do not relay private keys or submit transactions through a custodial backend.
- Do not add a second off-chain voting store or treat chat messages as chain authorization.
- Do not silently route mainnet actions to devnet configuration or assume an unavailable mainnet Indexer deployment.
- Lawyer reassignment does not silently reuse a stale bucket. If Indexer seats differ from bucket metadata, show an explicit stale-assignment state and disable transactions. Membership/key rotation and replacement-bucket lifecycle are outside this change.
- No Indexer schema migration or new read model is needed for the two-seat verdict: the existing listing and `pendingFinalizations` queries are sufficient and indexed.

## Approaches

1. **Chain-first two-seat review (selected).** Use the review bucket for property/cluster/document discovery, Indexer for current state, and the existing wallet for exact Solana instructions. This keeps authorization on-chain and minimizes server changes.
2. **Extend investor voting.** Reuse `submitVote`, candidacy power, and quorum calculations. This is rejected because `lawyer_confirm_documents` has two assigned seats and no share-weighted electorate.
3. **Server-authored voting messages and transaction relay.** This could simplify clients but would be custodial and could diverge from chain state. It is rejected.

## Bucket and producer metadata

Add `property_id: args.listing_id` and `cluster: cluster()` to both `spv_lawyer_elected` and `developer_lawyer_assigned` payloads. Keep `listing_id`, event IDs, and all existing fields unchanged. Pass `CLUSTER` through Indexer Compose/deployment so the producer is not silently pinned to its default.

ProfileApi adds optional cluster fields to both payload models, validates the new values for new events, and stores string properties `property_id` (the same decimal value as `listing_id`) and `cluster`. The bucket helper accepts the trigger's cluster. Existing buckets are additively backfilled on redelivery from known payload values, with no key rotation or message duplication. Dashboard readers prefer `property_id` and fall back to `listing_id`; legacy devnet-only buckets may use an explicit devnet compatibility fallback, never a mainnet guess.

Extend both generated bucket-client `GetBucketById` GraphQL selections to include `properties`, and regenerate through the existing build process.

## Chain-derived review state

Use one efficient GraphQL read for `listings(listingId:, active: true, first: 1)` and, when needed, `pendingFinalizations`. The listing supplies the two lawyer seats, per-seat document status/hash, `second_attempt`, status, and legal deadline. Settlement readiness/account evidence comes from `pendingFinalizations.executeDeal` and chain account reads. No candidacy/vote-history pagination or new SQL filter is needed for this feature.

The review model is two seats, not an election:

- Approved/rejected/pending counts are each shown as 0%, 50%, or 100% of the two seats.
- Per-seat wallet, verdict, and current document hash are visible.
- Both approvals with one hash produce `Legal`; two rejections or a second split verdict cancel the sale; the first split verdict starts the displayed second attempt.
- A non-lawyer can inspect state but cannot confirm. Settlement is permissionless only after chain state is `Legal` and before the deadline.
- Poll/reload on chat socket activity and after transaction submission; do not infer finalization from wallet submission alone.

## Shared document hash

Start with the two immutable review-bucket PDF snapshots in role order: SPV first, developer second. A later PDF attachment in the review bucket becomes that seat's current revision only when its contributor is the currently assigned lawyer for that seat; this lets a lawyer supply a missing document or revise terms for a second attempt. Other contributors cannot replace a seat's document. Select the latest qualifying revision per seat and key the review attempt by its resulting hash.

Both current documents must be available before confirmation is enabled. The client downloads their exact bytes and computes:

`SHA256(UTF8("XCAVATE_LEGAL_DOCUMENT_SET_V1") || uint64LE(spvLength) || spvBytes || uint64LE(developerLength) || developerBytes)`

The domain separator and lengths prevent ambiguous concatenation. Display a shortened hash for comparison. Missing documents disable verdict submission and point to the existing fallback chat message or the lawyer's replacement upload action. The hash is not supplied by the server and is not assumed to equal either assignment-time document hash; the Solana program only requires a nonzero value shared by both verdicts.

## Chat UI/UX

Add a focused lawyer-review panel to `/indexed-bucket/[id]` for `lawyer-document-review` buckets, above the message stream but within the chat experience. Reuse bucket 39's card/sheet visual language, not its investor action logic.

- Show property ID, cluster, attempt/status/deadline, both seat states, three native `<progress>` meters, and exact percentages/counts.
- Show a readable loading/error/unavailable state and avoid stale open/closed labels.
- Lawyers use an accessible form with explicit Approve/Reject radio controls, visible labels, hash confirmation, and an actionable submit button. Disable after valid submission to prevent duplicates, expose errors through `aria-live`, and manage sheet focus/Escape/return focus.
- Non-lawyers see read-only state. A connected wallet sees Execute deal only when ready; preparation/submission progress and actual signature links use the bucket cluster.
- Use the existing generic wallet bridge and responsive chat styling, with accessible 48px controls and native semantics. Keep chain eligibility in services/page state, not in the presentational card.

## Solana transactions

`lawyer_confirm_documents(listing_id:u64, approve:bool, documents_hash:[u8;32])` uses exactly three accounts: lawyer signer, lawyer-role PDA `[role, lawyer, [3]]`, and writable listing PDA `[listing, listingIdLE]`. Precheck the connected wallet against the assigned seat, then simulate and submit through the existing wallet bridge.

`execute_deal(listing_id:u64)` uses the 13 fixed accounts from the deployed program and exactly seven remaining accounts per collected mint, preserving on-chain collected order: mint, listing-vault ATA, developer, developer lawyer, SPV lawyer, region owner, and treasury token accounts. Derive listing-vault ATAs with the mint's actual token program and `allowOwnerOffCurve`. Use valid payee token accounts, preparing missing associated token accounts in a separate transaction when necessary rather than allowing settlement to fail for absent accounts.

Fetch mint/config/region data needed for token-program and owner decisions; do not infer them from bucket properties. Simulate every transaction and surface simulation/wallet/confirmation errors. Do not return success for `value.err`, swallowed confirmation failures, or an unconfirmed deal.

Use legacy transactions only when they fit Solana's packet limit. Multi-mint/account-preparation flows that exceed it require wallet-compatible versioned transactions and an address lookup table; implement and test that path rather than silently dropping accounts or claiming an invalid submission succeeded. No new dependency is assumed: use the dashboard's existing `@solana/web3.js` primitives or explicitly justify any additional library.

## Cluster configuration

Centralize marketplace/whitelist/regions IDs, token/associated-token/system IDs, RPC, wallet chain, Indexer GraphQL, and explorer cluster per bucket cluster. `devnet` maps to `solana:devnet` and existing devnet endpoints; `mainnet` maps to `solana:mainnet`, mainnet-beta RPC, and explicit mainnet indexer configuration. Program IDs come from the deployed program/IDL sources, not stale `Anchor.toml` aliases. Missing mainnet indexer configuration is an explicit unavailable state, never a devnet fallback.

## Verification

- Indexer mapper tests pin additive `property_id` and exact cluster values alongside existing payloads.
- ProfileApi tests pin property/cluster metadata, legacy backfill without key/message changes, and both SDK selections.
- Dashboard unit tests pin metadata parsing, hash bytes, two-seat state/percentages, role gating, PDA/account order/flags, Borsh arguments, multi-mint remaining accounts, ATA preparation, packet strategy, cluster config, and confirmation errors.
- Component/integration tests exercise lawyer/non-lawyer rendering, approve/reject flows, missing PDFs, split/reset states, settlement gating, and accessible feedback.
- Run both repositories' existing gates plus Dashboard lint/typecheck/unit/integration/build and available browser E2E. Do not submit real devnet/mainnet transactions during verification.

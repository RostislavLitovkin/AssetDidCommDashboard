# Lawyer Chat Review and Settlement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add property/cluster metadata to lawyer-review buckets and let assigned lawyers review verdicts, approve/reject documents, and execute ready deals inside chat.

**Architecture:** Indexer events carry additive property/cluster evidence; ProfileApi stores/backfills it. Dashboard resolves current two-seat state from Indexer, selects current PDF revisions from chat, hashes them deterministically, and submits exact Solana instructions through the existing wallet. A dedicated chat panel replaces investor voting semantics rather than altering them.

**Tech Stack:** Rust/Carbon, ASP.NET Core/EF Core, Nuxt 4/Vue 3/TypeScript, `@solana/web3.js`, NUnit, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-01-lawyer-chat-review-design.md`

## Global Constraints

- Preserve `listing_id`; add `property_id` with the same decimal value and `cluster` as exactly `devnet` or `mainnet`.
- Do not use investor voting power, bucket roles, or chat messages as lawyer authorization.
- Current documents are initial admin snapshots superseded only by the currently assigned lawyer's PDF attachments; both are hashed SPV-first with the spec's domain-separated length-prefix format.
- Do not change the existing four initial messages or rotate keys during metadata backfill.
- No Indexer schema migration or candidacy/vote-history filter work: existing listing and `pendingFinalizations` reads are sufficient.
- Do not submit real blockchain transactions during verification, add custodial signing, or silently fall back between clusters.
- If assigned lawyers change, show stale-assignment state and disable actions; membership re-keying is outside scope.
- Keep all changes uncommitted and preserve existing worktree changes.

## Review Focus

- Missing or revised PDFs must produce the correct current document-set hash or a disabled action; pin with document revision/hash tests in Task 2.
- A changed lawyer seat must fail closed rather than authorize the old/new wallet against stale metadata; pin with stale-assignment tests in Tasks 2 and 4.
- First split/reset, second split, approvals, rejections, and pending states must render distinctly; pin with reducer and panel tests in Tasks 2 and 4.
- Multi-mint settlement must retain exact account order and packet limits; pin with remaining-account, ATA, versioned/ALT, and simulation tests in Task 3.
- Mainnet/devnet configuration and confirmation errors must never silently cross clusters or report false success; pin with cluster and submission tests in Tasks 3 and 4.

---

### Task 1: Property and cluster metadata end to end

**Files:**
- Modify: `/home/rosta/Indexer/.worktrees/lawyer-review/crates/indexer/src/mapping/marketplace.rs`
- Modify: `/home/rosta/Indexer/.worktrees/lawyer-review/crates/indexer/src/mapping/sibling_tests.rs`
- Modify: `/home/rosta/Indexer/.worktrees/lawyer-review/docker-compose.yml`
- Modify: `/home/rosta/Indexer/.worktrees/lawyer-review/.github/workflows/deploy.yml`
- Modify: `/home/rosta/Indexer/.worktrees/lawyer-review/{RUNBOOK.md,DECISIONS.md,MIGRATION_LOG.md}`
- Modify: `/home/rosta/XcavateProfileApi/.worktrees/lawyer-review/src/XcavateProfileApi/Controllers/WebhooksController.cs`
- Modify: `/home/rosta/XcavateProfileApi/.worktrees/lawyer-review/src/{XcavateProfileApiClient,XcavateProfileApiSolanaClient}/Buckets/Operations.graphql`
- Test: `/home/rosta/XcavateProfileApi/.worktrees/lawyer-review/tests/XcavateBuckets.Tests/LawyerReviewBucketWebhookTests.cs`

**Interfaces:**
- Produces webhook fields `property_id` and `cluster` on both lawyer triggers while preserving every existing field.
- Produces bucket properties `property_id` and `cluster`, with legacy redelivery backfill and `properties` selected by both `GetBucketById` operations.

- [ ] Extend mapper tests first for both events; run them RED, add the additive fields, then run GREEN.
- [ ] Extend bucket tests for exact devnet/mainnet metadata and legacy backfill with unchanged key/message count; run RED before changing the helper/payloads.
- [ ] Implement payload propagation, additive metadata/backfill, SDK selections, and `CLUSTER` deployment passthrough. Update operator docs.
- [ ] Run focused mapper/Profile tests and both full .NET suites.

### Task 2: Dashboard cluster, metadata, documents, and review-state services

**Files:**
- Create: `/home/rosta/AssetDidCommDashboard/.worktrees/lawyer-chat-review/app/services/lawyer/{types.ts,cluster.ts,reviewBucket.ts,documentSet.ts,reviewState.ts,indexerLegalClient.ts}`
- Modify: dashboard bucket/voting service files only where their public API must be reused.
- Test: `/home/rosta/AssetDidCommDashboard/.worktrees/lawyer-chat-review/tests/unit/lawyerReview*.spec.ts`

**Interfaces:**
- Produces `SolanaCluster = 'devnet' | 'mainnet'`, coherent `LegalClusterConfig`, and `parseLawyerReviewBucket` with `property_id` fallback and lawyer/PDA metadata.
- Produces `selectCurrentLawyerDocuments` and `computeDocumentSetHash` implementing the spec's revision and byte rules.
- Produces `loadLawyerReviewState` returning seat verdicts/hashes, attempt, status/deadline, stale-assignment flag, and settlement readiness; percentages are derived, not fetched from investor votes.

- [ ] Write failing tests for metadata/fallback/cluster mismatch, latest qualifying PDF revisions, exact hash vectors, 0/50/100 states, split/reset/cancel/legal, missing documents, and stale seats.
- [ ] Implement small focused services using existing repository/GraphQL patterns and no new dependency.
- [ ] Run new unit tests plus existing voting/indexer/realxmarket suites.

### Task 3: Wallet-safe Solana legal transactions

**Files:**
- Create: `/home/rosta/AssetDidCommDashboard/.worktrees/lawyer-chat-review/app/services/lawyer/solanaLegal.ts`
- Modify: `/home/rosta/AssetDidCommDashboard/.worktrees/lawyer-chat-review/app/services/voting/solanaVote.ts` only for generic, backward-compatible confirmation/submission correctness.
- Test: `/home/rosta/AssetDidCommDashboard/.worktrees/lawyer-chat-review/tests/unit/solanaLegal.spec.ts`

**Interfaces:**
- Consumes Task 2 cluster config, listing ID, hash, settlement evidence, and current signer.
- Produces `buildLawyerConfirmDocumentsTransaction` with exact args/accounts and `prepareExecuteDealTransactions` with fixed/remaining accounts, ATA preparation, packet strategy, simulation, and honest confirmation results.

- [ ] Write known-answer tests for discriminators, u64/bool/hash encoding, lawyer-role/listing PDAs, all 13 fixed accounts, seven-per-mint order, missing ATA preparation, multi-mint packet/versioned strategy, cluster config, and `value.err`/simulation failures.
- [ ] Implement exact builders using the deployed source layouts and existing `@solana/web3.js`; no custodial or real-chain submission.
- [ ] Implement safe signing/submission reuse, ensuring connected-account and cluster checks and no false success.
- [ ] Run new and existing Solana/wallet tests.

### Task 4: Accessible lawyer review panel in chat

**Files:**
- Create: `/home/rosta/AssetDidCommDashboard/.worktrees/lawyer-chat-review/app/components/lawyer/LawyerReviewPanel.vue`
- Modify: `/home/rosta/AssetDidCommDashboard/.worktrees/lawyer-chat-review/app/pages/indexed-bucket/[id]/index.vue`
- Test: `/home/rosta/AssetDidCommDashboard/.worktrees/lawyer-chat-review/tests/{unit,integration,e2e}/` lawyer-review tests

**Interfaces:**
- Consumes Tasks 1–3 metadata/state/hash/transaction APIs and the existing session/wallet bridge.
- Produces a review-bucket-only panel above the chat stream, leaving existing investor voting unchanged.

- [ ] Write failing component/integration tests for read-only holders, eligible lawyers, missing PDFs, revised hash, verdict percentages, stale seats, split/reset, settlement readiness, submission errors, and cluster links.
- [ ] Implement the presentational panel and page orchestration with native `<progress>`, accessible forms/dialogs, focus/Escape handling, 48px targets, live status, and no chain logic in the card.
- [ ] Wire approve/reject and settlement actions with post-transaction Indexer refresh; never write a fake chain vote message.
- [ ] Run component/integration tests, lint/typecheck, and available Playwright checks without real transactions.

### Task 5: Whole-change verification and review

**Files:**
- Update relevant operator/design documentation and the Dashboard README only if behavior/configuration changes require it.

**Interfaces:**
- Consumes all prior task outputs; produces an uncommitted, tested cross-repository deliverable.

- [ ] Run Indexer formatting/clippy/build/tests/sqlx/migration checks and devnet verification where available.
- [ ] Run both .NET suites, Dashboard unit/integration/lint/typecheck/build, and available browser E2E.
- [ ] Inspect final diffs for secret leakage, stale comments, unintended generated files, and exact metadata/hash/account contracts.
- [ ] Obtain one fresh whole-change review; fix Critical/Important findings with RED→GREEN proof and report any remaining environment or operational limitations explicitly.

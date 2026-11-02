# SPV Lawyer Vote Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn every indexed `vote_on_spv_lawyer` instruction into an encrypted `Approved terms` chat message authored by the voter in the voted lawyer-terms bucket.

**Architecture:** The Rust mapper records a durable `spv_lawyer_vote_cast` webhook. The profile API authenticates it with the existing webhook secret, resolves and decrypts the candidacy bucket key, and writes an encrypted approval as the voter. The dashboard gives the tagged message an approval-specific chat treatment.

**Tech Stack:** Rust/Carbon/serde_json, ASP.NET Core/EF Core/NUnit, Nuxt/Vue/TypeScript/Vitest.

**Spec:** `docs/superpowers/specs/2026-11-02-spv-lawyer-vote-approval-design.md`

## Global Constraints

- Plaintext is exactly `Approved terms`; contributor is instruction account 0 (`voter`), target candidacy is account 6.
- No voter signature is added; the existing `INDEXER_WEBHOOK_SECRET` protects the server-to-server endpoint.
- No generated decoder, legacy SubQuery, or applied migration edits; never run `cargo fmt --all`.
- Preserve all pre-existing dashboard changes and commit directly on current branches without worktrees or pushes.
- Secret values must not be committed to source, tests, documentation, logs, or final summaries.

## Review Focus

- Revotes and multiple instructions in one transaction: references include the full instruction path as well as the transaction signature, so distinct votes remain distinct.
- Redelivery: the same event reference returns `ignored` without another message or tag-count increment.
- Wrong candidacy or bucket: return 404 before writing so indexer retry can deliver after bucket creation.
- Encrypted content: decrypt the stored compact JWE in tests and assert exact plaintext rather than only checking ciphertext presence.
- Missing admin configuration or malformed payload: fail without a message or membership side effect.

---

### Task 1: Indexer vote event and route

**Files:**
- Modify: `/home/rosta/Indexer/crates/indexer/src/mapping/marketplace.rs`
- Modify: `/home/rosta/Indexer/crates/indexer/src/mapping/mod.rs`
- Modify: `/home/rosta/Indexer/crates/indexer/src/mapping/sibling_tests.rs`
- Modify: `/home/rosta/Indexer/crates/indexer/src/config.rs`
- Modify: `/home/rosta/Indexer/.env.example`, `docker-compose.yml`, `RUNBOOK.md`, `docs/deployment.md`, `DECISIONS.md`, `MIGRATION_LOG.md`

**Interfaces:**
- Produces: event type `spv_lawyer_vote_cast` and route variable `SPV_LAWYER_VOTE_CAST_WEBHOOK_URL`.
- Produces JSON fields: `event`, `property_id`, `voter`, `candidacy`, `amount`, `listing`, `cluster`, `slot`, `tx_signature`, `instruction_path`, `block_time`, `program`.
- Event id: `spv_lawyer_vote_cast:{tx_signature}:{instruction_path}`.

- [ ] **Step 1: Write failing mapper and route tests.** Add a `VoteOnSpvLawyer` mapping fixture with distinct voter/payer/candidacy keys. Assert every payload field, account 0 versus account 1, amount, event id including instruction path, and the environment route mapping.
- [ ] **Step 2: Run focused tests and confirm failure.** Run `cargo test -p indexer vote_on_spv_lawyer -- --nocapture`; expect missing event/constant behavior.
- [ ] **Step 3: Implement the event and route.** Add the constant, mapper arm, and config entry using the existing `FinalizeSpvElection` transaction-scoped pattern. Do not edit generated decoder files.
- [ ] **Step 4: Document and run the focused tests.** Add the webhook route to compose/env documentation and record the design/ops/shipped-change entries required by `AGENTS.md`. Re-run Step 2 and expect PASS.
- [ ] **Step 5: Verify and commit Indexer.** Run `cargo fmt`, `cargo fmt --check`, focused clippy/build/tests, migration lint, and devnet verification available in the environment. Stage only the listed files and commit `feat: announce SPV lawyer votes`.

### Task 2: Profile API encrypted voter message

**Files:**
- Modify: `/home/rosta/XcavateProfileApi/src/XcavateProfileApi/Controllers/WebhooksController.cs`
- Modify: `/home/rosta/XcavateProfileApi/src/XcavateProfileApi/Services/LawyerTermsBucketProtocol.cs`
- Test: `/home/rosta/XcavateProfileApi/tests/XcavateBuckets.Tests/LawyerTermsBucketWebhookTests.cs`

**Interfaces:**
- Consumes: Task 1 event and JSON fields.
- Produces: `POST /webhooks/spv_lawyer_vote_cast_devnet` accepting `SpvLawyerVoteCastPayload`.
- Produces: tag `lawyer/terms-approved`, content type `text/plain;charset=utf-8`, reference `lawyer-terms/{candidacy}/approved/{tx_signature}:{instruction_path}`, and decrypted body `Approved terms`.

- [ ] **Step 1: Write failing webhook tests.** Seed a real terms bucket through the existing claim webhook, post a vote event, then decrypt the newest approval using the bucket key. Assert contributor equals voter, exact plaintext, tag/reference/content type/hash, and voter membership. Assert redelivery is ignored, a second instruction path posts separately, missing bucket returns 404, and invalid input/missing admin config has no side effects.
- [ ] **Step 2: Run focused tests and confirm failure.** Run `dotnet test tests/XcavateBuckets.Tests/XcavateBuckets.Tests.csproj --filter 'FullyQualifiedName~Spv_lawyer_vote'`; expect 404 because the route does not exist.
- [ ] **Step 3: Implement the endpoint.** Validate event/listing/voter/candidacy/signature/path, resolve namespace and bucket by candidacy metadata, obtain admin configuration, decrypt the latest key-sharing message, encrypt `Approved terms`, add the voter contributor as admin, and write inside a transaction. Check duplicate reference before writing.
- [ ] **Step 4: Run focused tests and confirm PASS.** Re-run Step 2, then run the full `LawyerTermsBucketWebhookTests` fixture to detect regressions.
- [ ] **Step 5: Verify and commit Profile API.** Run the repository build and relevant test suite, inspect generated files, stage only intended source/tests, and commit `feat: post SPV lawyer vote approvals`.

### Task 3: Dashboard approval presentation

**Files:**
- Create or Modify: `/home/rosta/AssetDidCommDashboard/app/services/buckets/lawyerTerms.ts` (only if an existing suitable tag module is absent; otherwise use the existing voting service)
- Modify: `/home/rosta/AssetDidCommDashboard/app/components/common/ChatMessageEntry.vue`
- Test: `/home/rosta/AssetDidCommDashboard/tests/unit/`
- Include: this plan and its design document; preserve all existing modified files.

**Interfaces:**
- Consumes: encrypted API message tagged `lawyer/terms-approved` whose decrypted body is `Approved terms`.
- Produces: exported `LAWYER_TERMS_APPROVED_TAG` constant and an approval-specific chat bubble class without changing sender attribution.

- [ ] **Step 1: Write a failing unit test.** Assert the approval tag constant and display predicate accept only `lawyer/terms-approved`, not the vote prompt/document tags.
- [ ] **Step 2: Run the focused Vitest test and confirm failure.** Expect the export/predicate to be absent.
- [ ] **Step 3: Implement the tag and minimal chat treatment.** Add the constant/predicate and bind an approval class from the existing message tag; retain the voter sender label and exact decrypted text. Avoid restructuring existing voting code.
- [ ] **Step 4: Run dashboard verification.** Run the focused test, standard unit suite, typecheck/build and lint scripts available in `package.json`.
- [ ] **Step 5: Commit Dashboard.** Review the full diff to separate pre-existing work from this feature, stage only this feature's files plus design/plan docs, and commit `feat: display SPV lawyer vote approvals`.

### Task 4: GitHub secrets and final cross-repository check

**Files:** no source files; use authenticated `gh` commands only.

- [ ] **Step 1: Confirm repository access and current secret names.** Run `gh auth status` and `gh secret list` for `XcavateBlockchain/Indexer` and `XcavateBlockchain/XcavateProfileApi` without printing values.
- [ ] **Step 2: Set the supplied secret.** Set `INDEXER_WEBHOOK_SECRET` in the profile API repository and any indexer repository workflow that consumes it. Set `SPV_LAWYER_VOTE_CAST_WEBHOOK_URL` to the deployed devnet endpoint with the supplied secret query value if the existing route-secret convention requires it.
- [ ] **Step 3: Verify names, not values.** Re-run `gh secret list` and confirm the new names and update timestamps; never echo secret values.
- [ ] **Step 4: Inspect final repositories.** Confirm intended commits and clean feature paths in all three `git status`/`git log` outputs. Leave unrelated pre-existing dashboard modifications untouched and uncommitted, and report them.

# SPV Election Finalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Approve terms with Finalize SPV election for ended, unfinalized rounds and submit the correct confirmed Solana transaction.

**Architecture:** Reuse the Indexer's pending-finalization evidence and the dashboard's existing voting wallet bridge. Add one Anchor transaction builder, then wire its evidence into the existing governance banner without altering active voting.

**Tech Stack:** Nuxt 4, Vue 3, TypeScript, Solana web3.js, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-02-spv-election-finalization-design.md`

## Global Constraints

- Do not modify the Solana program or Indexer unless verification exposes a missing requirement.
- Preserve the existing active-vote path and all other governance lanes.
- Use the existing devnet program ids, PDA seeds, wallet bridge, and confirmation helper.
- Do not add dependencies or commit/push unless the user explicitly requests it.

## Review Focus

- Incomplete Indexer evidence must not enable a transaction that the chain will reject; Task 1 checks round/count agreement and Task 3 checks no evidence means no finalize button.
- A tied election has no winner registry; Task 2 checks the program-id `None` sentinel while retaining all candidates.
- Account order and writability must match the on-chain helper; Task 2 pins every fixed and remaining account.
- Expired elections currently disappear; Task 3 starts expired and proves the banner remains only with finalization evidence.
- Double clicks and failures must not create duplicate sends or false success; Task 3 checks disabled/busy behavior and error visibility.

---

### Task 1: Read SPV finalization evidence

**Files:**
- Modify: `app/services/voting/indexerClient.ts`
- Test: `tests/unit/indexerClient.spec.ts`

**Interfaces:**
- Produces: `IndexerSpvElectionFinalization { winner: string | null; round: number; candidates: string[] }` and optional `IndexerSpvElection.finalization`.

- [ ] **Step 1: Write the failing test**
  Extend `fetchSpvElection` coverage with `pendingFinalizations.spvElection`, assert the parsed evidence, and assert the GraphQL query requests it with both ids set to `listingId`. Add malformed/stale evidence cases that must omit `finalization`.
- [ ] **Step 2: Verify red**
  Run `npx vitest run tests/unit/indexerClient.spec.ts`; expect the finalization assertions to fail.
- [ ] **Step 3: Implement the parser and query**
  Query `pendingFinalizations(assetId: $listingId, listingId: $listingId) { spvElection { winner round candidates } }`. Parse nonempty candidate strings and nullable winner, and attach evidence only for the listing's current round and expected candidate count.
- [ ] **Step 4: Verify green**
  Re-run `npx vitest run tests/unit/indexerClient.spec.ts`; expect all tests to pass.

### Task 2: Build finalize_spv_election

**Files:**
- Modify: `app/services/voting/solanaVote.ts`
- Test: `tests/unit/solanaVote.spec.ts`

**Interfaces:**
- Produces: `buildFinalizeSpvElectionTransaction(request: { listingId: string | number | bigint; round: number | bigint; winner: string | null; candidates: readonly string[]; cranker: string }): Transaction`.

- [ ] **Step 1: Write the failing tests**
  Assert discriminator `[2,249,39,73,224,169,145,100]` plus `listingId` u64le; cranker/listing/property/winner-registry account order and flags; candidate PDAs in input order; and null-winner `None` sentinel behavior. Pin property PDA `EYzsprEpwDcAQ4tCPQaMGqP4L2k2acWirrtkhzMWM3Nz` and winner registry PDA `4HkFdbVSoKpYQGnfzY8aAtiz1uoYQNcn1X93EXdN2LQ1` for listing 42 and the existing test lawyer.
- [ ] **Step 2: Verify red**
  Run `npx vitest run tests/unit/solanaVote.spec.ts`; expect failure because the builder is absent.
- [ ] **Step 3: Implement the builder**
  Add property and lawyer-registry PDA helpers, the discriminator, and the transaction builder. Use writable listing and winner registry, readonly property, writable remaining candidacies, and the marketplace program id for a null winner.
- [ ] **Step 4: Verify green**
  Re-run `npx vitest run tests/unit/solanaVote.spec.ts`; expect all tests to pass.

### Task 3: Wire banner finalization end to end

**Files:**
- Modify: `app/pages/indexed-bucket/[id]/index.vue`
- Test: `tests/e2e/lawyer-review.spec.ts`

**Interfaces:**
- Consumes: `IndexerSpvElection.finalization`, `buildFinalizeSpvElectionTransaction`, `castVoteOnChain`, and the existing `VoteTransactionBridge`.

- [ ] **Step 1: Write the failing end-to-end test**
  Mock an expired open terms announcement and `spvElection { winner round candidates }`. Install a sign-and-send wallet and successful RPC. Assert Finalize SPV election replaces Approve terms, click it, capture the wallet transaction, and assert its discriminator plus success notice. Add cases for no evidence, tied winner, submission failure, and preventing duplicate sends.
- [ ] **Step 2: Verify red**
  Run `npx playwright test tests/e2e/lawyer-review.spec.ts --grep "finalizes an ended SPV election"`; expect no finalize button because expired votes are hidden.
- [ ] **Step 3: Implement the UI flow**
  Include expired terms votes in `actionableVote` only with finalization evidence. Render the finalize button conditionally, submit directly with busy guarding, show errors outside the sheet, set a success notice, and schedule Indexer refresh after confirmation.
- [ ] **Step 4: Verify green**
  Re-run the targeted Playwright test, then the full `tests/e2e/lawyer-review.spec.ts` suite.

### Task 4: Full verification

**Files:**
- Review all modified files and repository status.

- [ ] **Step 1: Run project checks**
  Run `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build`; require exit code zero.
- [ ] **Step 2: Cross-check chain accounts**
  Compare the builder against `realxmarket-solana/programs/marketplace/src/instructions/election.rs` and `programs/marketplace/tests/common/mod.rs`; confirm no Indexer changes were necessary.
- [ ] **Step 3: Inspect final diff and artifacts**
  Run `git status --short`; remove only artifacts created by this task that are not required deliverables, and report any pre-existing warnings or unverified live-chain behavior plainly.

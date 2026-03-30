# Tasks: Asset DIDComm Admin Dashboard

**Input**: Design documents from `/specs/001-admin-didcomm-dashboard/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/

**Tests**: Included. Test coverage is required by the plan and constitution gates (unit, integration, E2E).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project setup, styling system, and baseline delivery/test tooling.

- [ ] T001 Configure project scripts for dev, lint, typecheck, unit/integration/e2e tests in package.json
- [ ] T002 Configure static deployment and runtime defaults in nuxt.config.ts
- [ ] T003 [P] Define design tokens (white/black/gray + #57a0c5) in app/assets/styles/tokens.css
- [ ] T004 [P] Establish global base styles and shared state styles in app/assets/styles/globals.css
- [ ] T005 [P] Configure ESLint rules for Vue and TypeScript in eslint.config.mjs
- [ ] T006 [P] Configure Vitest defaults for unit/integration suites in vitest.config.ts
- [ ] T007 [P] Configure Playwright for end-to-end workflows in playwright.config.ts
- [ ] T008 Add CI quality gates for lint, typecheck, and tests in .github/workflows/ci.yml
- [ ] T009 Add GitHub Pages deployment workflow for Nuxt static output in .github/workflows/deploy-pages.yml

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared architecture required before any user story work.

**CRITICAL**: Complete this phase before starting user stories.

- [ ] T010 Define DID domain types and operation payloads in app/types/did.ts
- [ ] T011 [P] Define key material and key validation types in app/types/keys.ts
- [ ] T012 [P] Define operation lifecycle and audit log types in app/types/operations.ts
- [ ] T013 Implement PAPI client bootstrap and endpoint config in app/services/papi/client.ts
- [ ] T014 [P] Implement wallet extension provider contract and error mapping in app/services/wallet/extensionProvider.ts
- [ ] T015 [P] Implement DID repository contract (read/register/update) in app/services/papi/didRepository.ts
- [ ] T016 [P] Implement DIDComm repository base methods in app/services/papi/didCommRepository.ts
- [ ] T017 [P] Implement X25519 crypto service contract in app/services/crypto/x25519KeyService.ts
- [ ] T018 Register PAPI plugin initialization for app runtime in app/plugins/papi.client.ts
- [ ] T019 Implement session store for account and wallet state in app/stores/session.ts
- [ ] T020 [P] Implement operations store for submitted/pending/success/failed states in app/stores/operations.ts
- [ ] T021 [P] Implement notifications store for actionable user feedback in app/stores/notifications.ts
- [ ] T022 Create shared app shell and layout slots in app/components/layout/AppShell.vue
- [ ] T023 [P] Create shared operation status badge component in app/components/common/OperationStatusBadge.vue
- [ ] T024 [P] Create shared notification center component in app/components/common/NotificationCenter.vue

**Checkpoint**: Foundation complete; user stories can start.

---

## Phase 3: User Story 1 - Connect Wallet and View DID (Priority: P1) MVP

**Goal**: Connect wallet and fetch DID details with primary-source then fallback-source behavior.

**Independent Test**: Connect a supported wallet, fetch DID for connected account, and verify found/not_found/failed status plus source indicator.

### Tests for User Story 1

- [ ] T025 [P] [US1] Add wallet composable behavior tests in tests/unit/useWallet.spec.ts
- [ ] T026 [P] [US1] Add DID fallback read integration tests in tests/integration/didRepository.spec.ts
- [ ] T027 [P] [US1] Add wallet-connect and DID-read end-to-end test in tests/e2e/us1-wallet-did.spec.ts

### Implementation for User Story 1

- [ ] T028 [P] [US1] Implement wallet connect/disconnect/account-change flow in app/composables/useWallet.ts
- [ ] T029 [P] [US1] Implement DID fetch with primary/fallback logic in app/composables/useDid.ts
- [ ] T030 [US1] Build wallet connection card UI states in app/components/common/WalletConnectionCard.vue
- [ ] T031 [US1] Build DID lookup panel for status/source/refresh time in app/components/did/DidLookupPanel.vue
- [ ] T032 [US1] Integrate wallet and DID lookup modules into dashboard route in app/pages/index.vue
- [ ] T033 [US1] Persist DID read and wallet events in operation timeline state in app/stores/operations.ts

**Checkpoint**: User Story 1 works independently.

---

## Phase 4: User Story 2 - Manage Encryption Keys (Priority: P2)

**Goal**: Generate, import, validate, and export X25519 keys with actionable feedback.

**Independent Test**: Generate keypair, export key, re-import exported key, and reject malformed input with clear error reason.

### Tests for User Story 2

- [ ] T034 [P] [US2] Add X25519 key service unit tests for generate/import/export in tests/unit/x25519KeyService.spec.ts
- [ ] T035 [P] [US2] Add key lifecycle integration tests for composable and repository boundaries in tests/integration/keyManagement.spec.ts
- [ ] T036 [P] [US2] Add key lifecycle end-to-end workflow test in tests/e2e/us2-key-lifecycle.spec.ts

### Implementation for User Story 2

- [ ] T037 [P] [US2] Implement key lifecycle composable and validation state handling in app/composables/useKeys.ts
- [ ] T038 [US2] Build key management panel for generate/import/export actions in app/components/keys/KeyManagementPanel.vue
- [ ] T039 [US2] Integrate key management panel into dashboard route in app/pages/index.vue
- [ ] T040 [US2] Record key management outcomes and validation errors in app/stores/operations.ts

**Checkpoint**: User Stories 1 and 2 each work independently.

---

## Phase 5: User Story 3 - Register and Update DID Details (Priority: P3)

**Goal**: Register missing DID and update existing DID details with explicit lifecycle and confirmations.

**Independent Test**: Register DID for an account with no DID, update existing DID details, and verify lifecycle transitions and failure handling.

### Tests for User Story 3

- [ ] T041 [P] [US3] Add DID register/update integration tests for operation lifecycle in tests/integration/didOperations.spec.ts
- [ ] T042 [P] [US3] Add DID write form validation unit tests in tests/unit/didOperationForm.spec.ts
- [ ] T043 [P] [US3] Add DID write end-to-end workflow test in tests/e2e/us3-did-write.spec.ts

### Implementation for User Story 3

- [ ] T044 [P] [US3] Implement register/update submission and lifecycle orchestration in app/composables/useDid.ts
- [ ] T045 [US3] Build DID registration form with explicit confirmation step in app/components/did/DidRegistrationForm.vue
- [ ] T046 [US3] Build DID update form with validation and confirmation in app/components/did/DidUpdateForm.vue
- [ ] T047 [US3] Build DID operation timeline visualization in app/components/did/DidOperationTimeline.vue
- [ ] T048 [US3] Integrate DID register/update panels into DID route in app/pages/did.vue

**Checkpoint**: All user stories work independently.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Hardening, consistency, accessibility, and documentation.

- [ ] T049 [P] Add accessibility and keyboard-flow refinements for shared action components in app/components/common/WalletConnectionCard.vue
- [ ] T050 [P] Add accessibility and keyboard-flow refinements for key workflows in app/components/keys/KeyManagementPanel.vue
- [ ] T051 [P] Align DID and key feedback language and visual states in app/components/common/OperationStatusBadge.vue
- [ ] T052 [P] Validate quickstart walkthrough commands and expected outcomes in specs/001-admin-didcomm-dashboard/quickstart.md
- [ ] T053 Update implementation notes and deployment usage documentation in README.md

---

## Dependencies & Execution Order

### Phase Dependencies

- Phase 1 (Setup): No dependencies.
- Phase 2 (Foundational): Depends on Phase 1 and blocks all user stories.
- Phase 3 (US1): Depends on Phase 2.
- Phase 4 (US2): Depends on Phase 2.
- Phase 5 (US3): Depends on Phase 2.
- Phase 6 (Polish): Depends on completion of desired user stories.

### User Story Dependencies

- US1 (P1): No dependency on other user stories after Foundation.
- US2 (P2): No dependency on US1; shares only foundational services/stores.
- US3 (P3): No dependency on US2; uses shared DID service/composable foundation.

### Within Each User Story

- Tests first, then implementation.
- Composables/services before component integration.
- Component integration before route/page integration.
- Timeline/logging before story sign-off.

---

## Parallel Opportunities

- Setup: T003, T004, T005, T006, T007 can run in parallel.
- Foundation: T011, T012, T014, T015, T016, T017, T020, T021, T023, T024 can run in parallel.
- US1 tests: T025, T026, T027 can run in parallel.
- US2 tests: T034, T035, T036 can run in parallel.
- US3 tests: T041, T042, T043 can run in parallel.
- Polish: T049, T050, T051, T052 can run in parallel.

---

## Parallel Example: User Story 1

```bash
Task: "T025 [US1] Add wallet composable behavior tests in tests/unit/useWallet.spec.ts"
Task: "T026 [US1] Add DID fallback read integration tests in tests/integration/didRepository.spec.ts"
Task: "T027 [US1] Add wallet-connect and DID-read end-to-end test in tests/e2e/us1-wallet-did.spec.ts"
```

## Parallel Example: User Story 2

```bash
Task: "T034 [US2] Add X25519 key service unit tests for generate/import/export in tests/unit/x25519KeyService.spec.ts"
Task: "T035 [US2] Add key lifecycle integration tests for composable and repository boundaries in tests/integration/keyManagement.spec.ts"
Task: "T036 [US2] Add key lifecycle end-to-end workflow test in tests/e2e/us2-key-lifecycle.spec.ts"
```

## Parallel Example: User Story 3

```bash
Task: "T041 [US3] Add DID register/update integration tests for operation lifecycle in tests/integration/didOperations.spec.ts"
Task: "T042 [US3] Add DID write form validation unit tests in tests/unit/didOperationForm.spec.ts"
Task: "T043 [US3] Add DID write end-to-end workflow test in tests/e2e/us3-did-write.spec.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (Setup).
2. Complete Phase 2 (Foundational).
3. Complete Phase 3 (US1).
4. Validate US1 independently before moving on.

### Incremental Delivery

1. Setup + Foundation.
2. Deliver US1 and validate.
3. Deliver US2 and validate.
4. Deliver US3 and validate.
5. Run polish tasks and final quality gates.

### Parallel Team Strategy

1. Team completes Setup + Foundation together.
2. After Foundation:
   - Developer A: US1
   - Developer B: US2
   - Developer C: US3
3. Merge on shared quality gates in CI.

---

## Notes

- All tasks follow the required checklist format: `- [ ] [TaskID] [P?] [Story?] Description with file path`.
- Story labels appear only on user-story tasks.
- Every user story includes explicit independent test criteria and executable test tasks.

# Research: Asset DIDComm Admin Dashboard

## Decision 1: Nuxt rendering/deployment mode
- Decision: Use Nuxt static output suitable for GitHub Pages hosting with CI-based build and publish.
- Rationale: GitHub Pages is static-first; this avoids server runtime requirements while supporting admin dashboard UX.
- Alternatives considered:
  - Nuxt server rendering with Node host: rejected because GitHub Pages cannot host Node runtime.
  - Pure Vue + Vite without Nuxt: rejected because Nuxt conventions and ecosystem were explicitly requested.

## Decision 2: Blockchain integration strategy with PAPI
- Decision: Implement a dedicated PAPI service layer (`client`, DID repository, DIDComm repository) and consume it through composables.
- Rationale: Separates chain interaction from UI components, improves testability, and supports modular reuse.
- Alternatives considered:
  - Calling PAPI directly inside components: rejected due to tight coupling and poor testability.
  - Custom ad-hoc RPC wrappers without PAPI: rejected due to explicit requirement to use PAPI.

## Decision 3: Wallet integration behavior
- Decision: Use extension-provider abstraction for connect/disconnect/account-change handling and expose reactive session state via store/composables.
- Rationale: Wallet state changes are cross-cutting concerns and need centralized management to prevent inconsistent UI state.
- Alternatives considered:
  - Per-view wallet handling: rejected because it duplicates logic and risks drift.

## Decision 4: DID source fallback behavior
- Decision: Query DID pallet first; if no result or unsupported path, fallback to didLookup path and surface source status to users.
- Rationale: Matches feature request and increases reliability across runtime variations.
- Alternatives considered:
  - DID-only single source query: rejected because fallback capability is explicitly required.

## Decision 5: X25519 key lifecycle handling
- Decision: Support generate/import/export for X25519 keys through a crypto service and strict validation pipeline, with session-scoped key state.
- Rationale: Aligns with required admin workflows while avoiding insecure persistent storage of sensitive key material in v1.
- Alternatives considered:
  - Persist private keys by default in browser storage: rejected due to security risk.
  - Support additional key curves in v1: rejected to keep scope focused and testable.

## Decision 6: Visual system and iconography
- Decision: Establish tokenized theme palette limited to white/black/gray + primary `#57a0c5` and standardize icon usage with Lucide.
- Rationale: Satisfies explicit UX/design constraints and keeps consistency across modular components.
- Alternatives considered:
  - Full custom palette: rejected due to requirement constraints.
  - Mixed icon libraries: rejected to avoid inconsistent visual language.

## Decision 7: Testing strategy and release gating
- Decision: Use layered tests (unit + integration + E2E) with CI gates for lint/typecheck/tests before deployment workflow.
- Rationale: Required by constitution and ensures reliability for chain-interaction and key-management critical paths.
- Alternatives considered:
  - Unit tests only: rejected because key user journeys cross component and service boundaries.
  - Manual QA only: rejected as non-repeatable and insufficient for release gates.

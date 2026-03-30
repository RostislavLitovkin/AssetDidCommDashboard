# Implementation Plan: Asset DIDComm Admin Dashboard

**Branch**: `001-admin-didcomm-dashboard` | **Date**: 2026-03-25 | **Spec**: `specs/001-admin-didcomm-dashboard/spec.md`
**Input**: Feature specification from `/specs/001-admin-didcomm-dashboard/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Build an admin-facing Asset DIDComm dashboard as a Nuxt web application that connects to the Xcavate Substrate endpoint via PAPI, supports Polkadot extension wallet connection, manages X25519 key lifecycle (generate/import/export), and supports DID read/register/update flows with clear operation states. The implementation emphasizes modular reusable components, consistent monochrome + primary accent design tokens, and automated deployment to GitHub Pages via GitHub Actions.

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: TypeScript (ES2022), Vue 3 / Nuxt 3  
**Primary Dependencies**: Nuxt 3, PAPI (Polkadot API), polkadot{.js} extension integration, JOSE (X25519 JWK), Lucide icons, Pinia (state management), Vitest + Vue Test Utils + Playwright  
**Storage**: Browser local storage (non-sensitive UI/session state), in-memory key/session state, blockchain as source of truth for DID and DIDComm-related records  
**Testing**: Vitest (unit), integration tests for service layers and composables, Playwright E2E for wallet/DID/key workflows  
**Target Platform**: Modern desktop browsers (Chromium, Firefox) with extension support
**Project Type**: Frontend web application (Nuxt SPA/static deployment)
**Performance Goals**: Dashboard first meaningful content <2s on broadband; DID lookup status visible <60s in 95% of attempts; interaction response <200ms for local UI actions
**Constraints**: GitHub Pages static hosting, wallet-extension-dependent flows, endpoint default fixed to `wss://xcavate-paseo.api.onfinality.io/public-ws`, theme palette restricted to white/black/gray + `#57a0c5`
**Scale/Scope**: Admin-focused MVP; single-tenant operator interface; initial release includes wallet connect, DID read/register/update, key generate/import/export, and action timeline

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Gate 1 – Code Quality First**: PASS
  - Plan enforces modular architecture (`components`, `features`, `composables`, `services`) with clear boundaries and reusable UI primitives.
- **Gate 2 – Test Coverage as Release Gate**: PASS
  - Testing strategy includes unit, integration, and E2E for each primary story; CI will block merges on test/lint/typecheck failures.
- **Gate 3 – User Experience Consistency**: PASS
  - Shared UI patterns for loading/success/error and standardized operation lifecycle states are included across DID and key workflows.
- **Gate 4 – Design System Consistency**: PASS
  - Theme tokens are constrained to white/black/gray + primary accent `#57a0c5`; Lucide icon set is standardized.
- **Gate 5 – Small, Reviewable, Verifiable Changes**: PASS
  - Plan decomposes implementation into independently testable slices matching prioritized user stories.

**Post-Design Re-Check (after Phase 1 artifacts)**: PASS
- Phase 0/1 outputs preserve all constitutional gates with no unresolved exceptions.

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```text
app/
├── assets/
│   └── styles/
│       ├── tokens.css
│       └── globals.css
├── components/
│   ├── common/
│   ├── layout/
│   ├── did/
│   └── keys/
├── composables/
│   ├── useWallet.ts
│   ├── useDid.ts
│   └── useKeys.ts
├── pages/
│   └── index.vue
├── services/
│   ├── papi/
│   │   ├── client.ts
│   │   ├── didRepository.ts
│   │   └── didCommRepository.ts
│   ├── wallet/
│   │   └── extensionProvider.ts
│   └── crypto/
│       └── x25519KeyService.ts
├── stores/
│   ├── session.ts
│   └── operations.ts
├── types/
│   ├── did.ts
│   ├── keys.ts
│   └── operations.ts
└── plugins/
  └── papi.client.ts

tests/
├── unit/
├── integration/
└── e2e/

.github/
└── workflows/
  ├── ci.yml
  └── deploy-pages.yml
```

**Structure Decision**: Nuxt web-application structure selected. Feature logic is grouped by domain (`did`, `keys`, `wallet`) and shared via composables/services to satisfy modular-reuse goals and constitutional quality gates.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |

## Phase 0: Research & Decisions

- Decision outputs captured in `research.md` with resolved technical choices for Nuxt static deployment, PAPI integration pattern, wallet interoperability, key lifecycle handling, and theme/icon standards.

## Phase 1: Design & Contracts

- Data model captured in `data-model.md`.
- External/feature interface contracts captured under `contracts/`.
- Execution and validation flow captured in `quickstart.md`.

## Phase 2: Task Planning Approach

- Tasks will be generated to align with prioritized stories:
  - P1: Wallet + DID lookup
  - P2: X25519 key lifecycle
  - P3: DID register/update operations
- Each task bundle must include associated unit/integration/E2E validations and UX consistency checks.

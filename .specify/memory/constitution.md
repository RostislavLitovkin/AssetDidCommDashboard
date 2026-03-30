# Asset DID Communication Dashboard Constitution

## Core Principles

### I. Code Quality First
All production code MUST be readable, modular, and maintainable. Changes MUST follow existing project conventions, avoid unnecessary complexity, and include clear names and cohesive structure. Quick fixes that increase long-term maintenance cost are not acceptable.

### II. Test Coverage as a Release Gate
Every functional change MUST include automated tests at the appropriate level (unit, integration, or end-to-end). Bug fixes MUST include a regression test that fails before the fix and passes after. No feature is complete until tests pass in CI.

### III. User Experience Consistency
User-facing behavior MUST remain predictable across screens and flows. Similar actions MUST produce similar feedback, loading states, error states, and success messaging. UX decisions should optimize clarity, reduce friction, and preserve accessibility.

### IV. Design System Consistency
UI implementation MUST use established design tokens, shared components, and approved interaction patterns. New visual styles should only be introduced when existing primitives cannot meet requirements, and any exception MUST be documented.

### V. Small, Reviewable, and Verifiable Changes
Work should be delivered in focused increments that are easy to review and validate. Each change MUST include enough context (description, rationale, and impact) for reviewers to assess code quality, testing completeness, and UX/design consistency.

## Quality Standards

- Definition of Done includes: code quality checks pass, required tests pass, and user-facing behavior has been verified.
- Linting, type checks, and formatting are mandatory for merge readiness.
- New dependencies or architectural patterns require explicit justification in the change description.
- Accessibility regressions (keyboard navigation, semantics, contrast, or focus visibility) are considered quality defects.

## Workflow and Review Policy

- Pull requests MUST state what changed, why it changed, how it was tested, and any UX/design implications.
- Reviewers MUST block merge when principles are violated, even if functionality appears correct.
- UX and design-impacting changes SHOULD include screenshots or recordings when applicable.
- Significant deviations from existing patterns require team alignment before implementation.

## Governance

This constitution is the baseline for implementation and review decisions in this repository. In case of conflict, this document takes precedence over informal practices. Amendments require documented rationale, team approval, and update of affected templates or guidance.

**Version**: 1.0.0 | **Ratified**: 2026-03-25 | **Last Amended**: 2026-03-25

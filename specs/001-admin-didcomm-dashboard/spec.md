# Feature Specification: Asset DIDComm Admin Dashboard

**Feature Branch**: `001-admin-didcomm-dashboard`  
**Created**: 2026-03-25  
**Status**: Draft  
**Input**: User description: "Build an admin dashboard for AssetDidComm connected to the Xcavate chain, with wallet connection, X25519 key management, DID lookup/registration, and DID detail updates."

## User Scenarios & Testing *(mandatory)*

<!--
  IMPORTANT: User stories should be PRIORITIZED as user journeys ordered by importance.
  Each user story/journey must be INDEPENDENTLY TESTABLE - meaning if you implement just ONE of them,
  you should still have a viable MVP (Minimum Viable Product) that delivers value.
  
  Assign priorities (P1, P2, P3, etc.) to each story, where P1 is the most critical.
  Think of each story as a standalone slice of functionality that can be:
  - Developed independently
  - Tested independently
  - Deployed independently
  - Demonstrated to users independently
-->

### User Story 1 - Connect Wallet and View DID (Priority: P1)

As an AssetDidComm admin, I can connect my supported wallet and view DID details tied to my identity so I can verify current on-chain status before taking any administrative action.

**Why this priority**: Without identity connection and DID visibility, no other admin workflows can be performed safely or confidently.

**Independent Test**: Can be fully tested by connecting a wallet, loading DID records for that identity, and confirming displayed DID details match chain state.

**Acceptance Scenarios**:

1. **Given** an admin with a supported wallet extension installed, **When** they connect the wallet, **Then** the dashboard shows a connected state and the active account identity.
2. **Given** a connected admin account with a registered DID, **When** DID data is requested, **Then** the dashboard displays DID details from the primary DID source and shows when the data was last refreshed.
3. **Given** a connected admin account where the primary DID source has no result, **When** DID data is requested, **Then** the dashboard attempts the fallback DID lookup source and reports the final status clearly.

---

### User Story 2 - Manage Encryption Keys (Priority: P2)

As an AssetDidComm admin, I can generate, import, and export X25519 keys so I can manage secure communication and key material lifecycle in a consistent admin workflow.

**Why this priority**: Key operations are core to secure communication workflows and are required for operational readiness.

**Independent Test**: Can be fully tested by generating a keypair, importing a valid keypair, exporting key data, and confirming integrity checks and user feedback for each operation.

**Acceptance Scenarios**:

1. **Given** a connected admin, **When** they generate a new X25519 keypair, **Then** the system provides a usable keypair with distinct public/private material and confirms success.
2. **Given** a valid X25519 key file, **When** the admin imports it, **Then** the system validates the format and loads it into the active session.
3. **Given** an existing key in the dashboard, **When** the admin exports it, **Then** the exported file is complete, readable by re-import flow, and clearly labeled.
4. **Given** malformed or incompatible key data, **When** import is attempted, **Then** the operation is rejected with actionable error feedback and no partial state is saved.

---

### User Story 3 - Register and Update DID Details (Priority: P3)

As an AssetDidComm admin, I can register a DID when missing and update DID details when needed so chain identity records stay correct and usable by downstream DIDComm workflows.

**Why this priority**: This extends from visibility to full DID lifecycle control, enabling new onboarding and maintenance use cases.

**Independent Test**: Can be fully tested by registering an unregistered DID, updating existing DID details, and verifying chain state reflects the changes after confirmation.

**Acceptance Scenarios**:

1. **Given** a connected admin account without an existing DID, **When** they submit registration details, **Then** the DID is registered and visible in subsequent lookups.
2. **Given** a connected admin account with an existing DID, **When** they submit valid detail updates, **Then** the updated DID data is persisted and displayed after confirmation.
3. **Given** an on-chain rejection or validation failure, **When** a register or update action is submitted, **Then** the dashboard preserves user input where possible and provides a clear failure reason.

---

### Edge Cases

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right edge cases.
-->

- Wallet extension is not installed, locked, or user rejects connection.
- Connected account changes during an active DID/key operation.
- Network endpoint is unavailable, slow, or temporarily inconsistent between reads.
- DID exists in fallback source but not primary source (or vice versa).
- Duplicate DID registration is attempted for an already registered identity.
- DID update is attempted while another pending update exists.
- Key import file is valid JSON but missing required key fields.
- Key export requested when no key is loaded in the current session.

## Requirements *(mandatory)*

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right functional requirements.
-->

### Functional Requirements

- **FR-001**: System MUST allow admins to connect and disconnect a supported Polkadot extension wallet.
- **FR-002**: System MUST display active wallet/account identity and connection state at all times.
- **FR-003**: System MUST retrieve DID details from the primary DID registry source and use a fallback DID lookup source when the primary source returns no result.
- **FR-004**: System MUST present DID retrieval outcomes as one of: found, not found, or failed, with user-readable detail.
- **FR-005**: System MUST allow admins to initiate DID registration for an identity that has no existing DID record.
- **FR-006**: System MUST allow admins to update DID details for an identity with an existing DID record.
- **FR-007**: System MUST require explicit admin confirmation before submitting DID registration or DID update operations.
- **FR-008**: System MUST show operation lifecycle states for DID actions (submitted, pending confirmation, success, failed).
- **FR-009**: System MUST allow admins to generate an X25519 encryption keypair within the dashboard workflow.
- **FR-010**: System MUST allow admins to import X25519 key material from a file and validate compatibility before accepting it.
- **FR-011**: System MUST allow admins to export loaded/generated X25519 key material in a format that can be re-imported.
- **FR-012**: System MUST reject malformed, incomplete, or incompatible key material with actionable error messages.
- **FR-013**: System MUST prevent submission of DID write actions when wallet is disconnected or account identity is unavailable.
- **FR-014**: System MUST provide consistent feedback for all admin actions, including loading, success, warning, and error states.
- **FR-015**: System MUST record a user-visible audit trail of completed admin actions in the current session (action type, target DID, timestamp, final status).
- **FR-016**: System MUST include a network configuration for the Xcavate endpoint `wss://xcavate-paseo.api.onfinality.io/public-ws` as the default target.

### Key Entities *(include if feature involves data)*

- **Admin Session**: Represents an authenticated dashboard session for a connected wallet account; includes account identity, connection state, selected network, and recent action history.
- **DID Record**: Represents identity data associated with an account; includes DID identifier, registration status, details payload, source status (primary/fallback), and last refresh timestamp.
- **DID Operation**: Represents a submitted DID state-changing action; includes operation type (register/update), initiating account, request payload summary, submission time, and final outcome.
- **Key Material**: Represents X25519 key information in admin workflow; includes key identifier, key type, origin (generated/imported), export metadata, and validation status.
- **Action Log Entry**: Represents one user-visible operation event for traceability; includes action category, target entity, timestamp, and status.

## Success Criteria *(mandatory)*

<!--
  ACTION REQUIRED: Define measurable success criteria.
  These must be technology-agnostic and measurable.
-->

### Measurable Outcomes

- **SC-001**: 95% of admins successfully connect a supported wallet and view DID lookup status within 60 seconds of opening the dashboard.
- **SC-002**: 95% of valid DID register/update submissions receive a final success or failure result visible to the admin within 120 seconds.
- **SC-003**: 99% of malformed key imports are rejected before action completion with an actionable error message.
- **SC-004**: At least 90% of test users complete the key lifecycle flow (generate or import, then export and re-import) on first attempt without assistance.
- **SC-005**: Support requests related to “unknown DID action status” are reduced by 50% within the first release cycle after rollout.

## Assumptions

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right assumptions based on reasonable defaults
  chosen when the feature description did not specify certain details.
-->

- Target users are administrative operators, not general end users.
- Dashboard scope is desktop-first web usage for v1; mobile-specific UX is out of scope.
- Wallet extension connection is the primary identity mechanism; no separate username/password flow is introduced in this feature.
- DID data and DID state changes depend on availability and consistency of the target chain endpoint.
- DID read paths can use both a primary DID source and fallback lookup source.
- Key generation/import/export is required for admin operations but secure external key escrow/storage management is out of scope for v1.

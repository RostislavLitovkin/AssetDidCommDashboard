# Quickstart: Asset DIDComm Admin Dashboard

## 1. Prerequisites
- Node.js LTS and npm available.
- Supported browser with Polkadot extension wallet installed.
- Access to network endpoint: `wss://xcavate-paseo.api.onfinality.io/public-ws`.

## 2. Install and Run
1. Run `npm install`.
2. Run `npm run dev`.
3. Open `http://localhost:3000` and confirm initial dashboard load.

## 3. Validate Core User Journeys

### P1: Wallet + DID Read
1. Connect wallet from dashboard.
2. Confirm connected account appears.
3. Trigger DID fetch.
4. Confirm status shows found/not found/failed and source indicator behavior.

### P2: Key Lifecycle
1. Generate X25519 keypair.
2. Export generated key.
3. Re-import exported key file.
4. Confirm validation success and consistent key metadata.
5. Try malformed import and confirm actionable error.

### P3: DID Register/Update
1. For identity without DID, submit registration.
2. Confirm operation state transitions from submitted/pending to final status.
3. For existing DID, submit update and verify refreshed DID view.

## 4. Test Commands
- `npm run test:unit`
- `npm run test:integration`
- `npm run test:e2e`
- `npm run lint`
- `npm run typecheck`

## 5. Deployment Validation (GitHub Pages)
1. Trigger `.github/workflows/deploy-pages.yml` via push or workflow dispatch.
2. Verify build artifact is static output.
3. Open deployed page and repeat smoke checks for P1 DID read and key generation UI path.

## 6. UX/Design Validation
- Confirm only white/black/gray + `#57a0c5` is used.
- Confirm Lucide icon set usage is consistent.
- Confirm loading/success/error messaging style is consistent across DID and key flows.

# Asset DIDComm Admin Dashboard

Admin dashboard for Asset DIDComm workflows on Xcavate Substrate.

## Stack
- Nuxt 3 + Vue 3 + TypeScript
- PAPI for blockchain interaction boundaries
- Polkadot extension wallet integration
- JOSE for X25519 key lifecycle
- Lucide icons
- Pinia stores

## Run
- `npm install`
- `npm run dev`

## Environment
- Set `NUXT_PUBLIC_XCAVATE_WS_ENDPOINT` in `.env` for local development.
- In GitHub Actions, set repository secret `NUXT_PUBLIC_XCAVATE_WS_ENDPOINT` so workflows can generate `.env` during CI and deploy.

## Quality Gates
- `npm run lint`
- `npm run typecheck`
- `npm run test:unit`
- `npm run test:integration`
- `npm run test:e2e`

## Deployment
GitHub Pages deployment is configured in `.github/workflows/deploy-pages.yml`.

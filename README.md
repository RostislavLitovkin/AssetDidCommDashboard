# realXmessage Dashboard

realXmessage dashboard for Asset DIDComm workflows on Xcavate Substrate.

- deployed at https://realxmessage.xcavate.io/

## Screenshots
<img width="2559" height="1534" alt="image" src="https://github.com/user-attachments/assets/08cf656a-7721-44dd-9494-0a0bf7596ffd" />

<img width="2551" height="1476" alt="image" src="https://github.com/user-attachments/assets/fe53e1e4-6dac-4300-82b4-7adece06b90a" />

## Stack
- Nuxt 3 + Vue 3 + TypeScript
- PAPI for blockchain interactions
- Polkadot extension wallet integration
- JOSE for X25519 key
- Pinata for IPFS storage
- Github pages

## Run
- `npm install`
- `npm run dev`

## Environment
- Set `.env` for local development.

## Quality Gates
- `npm run lint`
- `npm run typecheck`
- `npm run test:unit`
- `npm run test:integration`
- `npm run test:e2e`

## Deployment
GitHub Pages deployment is configured in `.github/workflows/deploy-pages.yml`.

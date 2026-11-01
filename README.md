# realXmessage Dashboard

realXmessage dashboard for Asset DIDComm workflows on Xcavate Substrate.

- deployed at https://realxmessage.xcavate.io/

## Screenshots
<img width="2559" height="1534" alt="image" src="https://github.com/user-attachments/assets/08cf656a-7721-44dd-9494-0a0bf7596ffd" />

<img width="2551" height="1476" alt="image" src="https://github.com/user-attachments/assets/fe53e1e4-6dac-4300-82b4-7adece06b90a" />

## Stack
- Nuxt 3 + Vue 3 + TypeScript
- XcavateProfile GraphQL/REST API (profile-api.xcavate.io) for namespaces, buckets, messages, and profiles
- Polkadot extension wallet integration
- JOSE for X25519 key
- Pinata for IPFS storage
- Github pages

## Run
- `npm install`
- `npm run dev`

## Environment
- Set `.env` for local development.
- Mainnet lawyer review requires `NUXT_PUBLIC_INDEXER_MAINNET_GRAPHQL_URL` to be set to the mainnet Indexer GraphQL endpoint before running or building the app. Missing configuration makes mainnet review unavailable; it never falls back to the devnet Indexer. Devnet uses the built-in devnet endpoint.

## Lawyer document review

The lawyer-review composable, services, and panel support `lawyer-document-review` buckets with property/cluster metadata, chain-derived two-seat verdicts, deterministic PDF revision hashing, stale-assignment protection, and wallet-signed review/settlement actions. See [the lawyer document review guide](./docs/lawyer-document-review.md) for the chat behavior, document hash format, configuration, and current integration status.

## Native host key injection
Native shells (e.g. .NET MAUI `HybridWebView`) can inject the user's X25519
secret JWK via `window.assetDidComm.injectX25519Key(...)` instead of manual
entry. See [csharp-injection-guide.md](./csharp-injection-guide.md) for the
full C# integration guide.

## Quality Gates
- `npm run lint`
- `npm run typecheck`
- `npm run test:unit`
- `npm run test:integration`
- `npm run test:e2e`

## Deployment
GitHub Pages deployment is configured in `.github/workflows/deploy-pages.yml`.

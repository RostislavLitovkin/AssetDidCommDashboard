# IPFS Integration TODO

1. Verify Pinata auth mode in runtime.
- Prefer JWT auth and confirm fallback API key/secret headers are accepted.

2. Add retry/backoff for Pinata upload.
- Handle temporary gateway errors (`429`, `5xx`) with exponential backoff.

3. Confirm configurable Pinata endpoint/gateway via Nuxt runtime config.
- Validate Pinata V3 `/v3/files` endpoint and gateway overrides from env.

4. Add read-path resolution for CID references.
- In message rendering, detect CID reference and fetch content from IPFS gateway.

5. Add fallback behavior when IPFS upload fails.
- Option A: hard-fail write with clear error.
- Option B: fallback to direct on-chain bytes for non-key-sharing messages.

6. Add secure observability.
- Keep CID logs, but avoid logging full encrypted payload in production.

7. Add tests for storage adapter.
- Unit tests for JWT/API-key auth header selection and upload response parsing.
- Integration tests for `createMessage` write path with mocked Pinata endpoints.

8. Add operational docs.
- Document Pinata token scopes, rate limits, and gateway availability behavior.

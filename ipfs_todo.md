# IPFS Integration TODO

1. Verify Crust auth flow with your wallet signer in browser runtime.
- Confirm `signRaw` output format is accepted by both upload and pin APIs.

2. Add retry/backoff for Crust upload and pin.
- Handle temporary gateway errors (`429`, `5xx`) with exponential backoff.

3. Add configurable Crust endpoints via Nuxt runtime config.
- Wire `uploadGateway`, `pinningEndpoint`, and `publicGateway` to environment variables.

4. Add read-path resolution for CID references.
- In message rendering, detect CID reference and fetch content from IPFS gateway.

5. Add fallback behavior when IPFS upload fails.
- Option A: hard-fail write with clear error.
- Option B: fallback to direct on-chain bytes for non-key-sharing messages.

6. Add secure observability.
- Keep CID logs, but avoid logging full encrypted payload in production.

7. Add tests for storage adapter.
- Unit tests for auth header creation, upload response parsing, pinning request shape.
- Integration tests for `createMessage` write path with mocked Crust endpoints.

8. Add operational docs.
- Document Crust account requirements, rate limits, and expected pin persistence behavior.

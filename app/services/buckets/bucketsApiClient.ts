/**
 * GraphQL transport for the XcavateProfile buckets API.
 *
 * Queries are anonymous. Mutations are authenticated with the same Sr25519
 * header scheme as the profile REST API, except the body hash covers the RAW
 * request body bytes — so the string handed to `sign` must be byte-identical
 * to the string sent as the HTTP body. This class serializes once and uses
 * that single string for both.
 */

export class BucketsApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = "BucketsApiError"
  }
}

export type GraphqlSignFn = (rawBody: string) => Promise<HeadersInit>

interface GraphqlEnvelope<T> {
  data?: T
  errors?: Array<{ message?: string }>
}

export class BucketsGraphqlClient {
  constructor(
    private readonly apiUrl: string,
    private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis)
  ) {}

  private endpoint(): string {
    return `${this.apiUrl.replace(/\/$/, "")}/graphql`
  }

  private async send<T>(rawBody: string, headers: HeadersInit): Promise<T> {
    const response = await this.fetcher(this.endpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: rawBody
    })

    if (response.status === 401) {
      throw new BucketsApiError(
        "Signature rejected by the API — check the wallet account and your system clock",
        401
      )
    }
    if (!response.ok) {
      throw new BucketsApiError(`Buckets API HTTP ${response.status}`, response.status)
    }

    const envelope = (await response.json()) as GraphqlEnvelope<T>
    if (envelope.errors?.length) {
      throw new BucketsApiError(
        envelope.errors.map((e) => e.message || "Unknown API error").join("; ")
      )
    }
    if (!envelope.data) {
      throw new BucketsApiError("Buckets API returned no data")
    }
    return envelope.data
  }

  async query<T>(document: string, variables?: Record<string, unknown>): Promise<T> {
    const rawBody = JSON.stringify(variables ? { query: document, variables } : { query: document })
    return this.send<T>(rawBody, {})
  }

  async mutate<T>(
    document: string,
    variables: Record<string, unknown> | undefined,
    sign: GraphqlSignFn
  ): Promise<T> {
    const rawBody = JSON.stringify(variables ? { query: document, variables } : { query: document })
    const headers = await sign(rawBody)
    return this.send<T>(rawBody, headers)
  }
}

import { BucketsGraphqlClient } from "./bucketsApiClient"
import type {
  ApiNamespace,
  BucketsRepositoryOptions,
  OperationUpdateHandler
} from "./types"

interface ConnectionPage<T> {
  nodes: T[]
  pageInfo: { hasNextPage: boolean; endCursor: string | null }
}

const NAMESPACE_FIELDS = "id namespaceId name schemaUri properties creator createdAt"

export class BucketsRepository {
  protected readonly client: BucketsGraphqlClient
  protected readonly options: BucketsRepositoryOptions

  constructor(options: BucketsRepositoryOptions) {
    this.options = options
    this.client = new BucketsGraphqlClient(options.apiUrl, options.fetcher)
  }

  /** Loop a cursor connection to exhaustion. `field` is the root field name. */
  protected async fetchAllPages<T>(
    field: string,
    document: string,
    variables: Record<string, unknown>
  ): Promise<T[]> {
    const all: T[] = []
    let after: string | null = null

    for (;;) {
      const vars: Record<string, unknown> = { ...variables }
      if (after) vars.after = after
      const data = await this.client.query<Record<string, ConnectionPage<T>>>(document, vars)
      const page = data[field]
      if (!page) throw new Error(`Buckets API response missing '${field}'`)
      all.push(...page.nodes)
      if (!page.pageInfo.hasNextPage || !page.pageInfo.endCursor) return all
      after = page.pageInfo.endCursor
    }
  }

  /** Filter values use the Long scalar — numbers on the wire. */
  protected asLong(id: string, label: string): number {
    const value = Number(id.trim())
    if (!Number.isFinite(value)) {
      throw new Error(`${label} must be numeric`)
    }
    return value
  }

  async fetchNamespaces(): Promise<ApiNamespace[]> {
    return this.fetchAllPages<ApiNamespace>(
      "namespaces",
      `query Namespaces($after: String) {
        namespaces(first: 50, after: $after, order: [{ createdAt: ASC }]) {
          nodes { ${NAMESPACE_FIELDS} }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      {}
    )
  }

  async fetchNamespaceById(namespaceId: string): Promise<ApiNamespace | null> {
    const data = await this.client.query<{ namespace: ApiNamespace | null }>(
      `query NamespaceById($id: ID!) {
        namespace(id: $id) { ${NAMESPACE_FIELDS} }
      }`,
      { id: namespaceId.trim() }
    )
    return data.namespace
  }

  async fetchNamespacesByCreator(address: string): Promise<ApiNamespace[]> {
    return this.fetchAllPages<ApiNamespace>(
      "namespaces",
      `query NamespacesByCreator($address: String!, $after: String) {
        namespaces(first: 50, after: $after, where: { creator: { eq: $address } }, order: [{ createdAt: ASC }]) {
          nodes { ${NAMESPACE_FIELDS} }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { address: address.trim() }
    )
  }

  async fetchNamespaceManagers(namespaceId: string): Promise<string[]> {
    const nodes = await this.fetchAllPages<{ manager: string }>(
      "namespaceManagers",
      `query NamespaceManagers($namespaceId: Long!, $after: String) {
        namespaceManagers(first: 50, after: $after, where: { namespaceId: { eq: $namespaceId } }, order: [{ addedAt: ASC }]) {
          nodes { manager }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { namespaceId: this.asLong(namespaceId, "Namespace id") }
    )
    return nodes.map((n) => n.manager)
  }
}

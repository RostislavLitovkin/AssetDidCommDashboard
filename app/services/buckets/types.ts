export interface ApiNamespace {
  id: string; namespaceId: string; name: string | null; schemaUri: string | null
  properties: string | null; creator: string | null; createdAt: string
}
export interface ApiBucket {
  id: string; bucketId: string; namespaceId: string | null; creator: string | null
  name: string | null; category: string | null; isWritable: boolean
  encryptionKey: string | null; createdAt: string; updatedAt: string
}
export interface ApiBucketWithMembers extends ApiBucket {
  admins: string[]; contributors: string[]
}
export interface ApiMessage {
  id: string; messageId: string; bucketId: string; contributor: string
  reference: string | null; tag: string | null; description: string | null
  contentType: string | null; contentHash: string | null
  ipfsContent: string | null; createdAt: string
}
export interface BucketDetail {
  bucket: ApiBucket; admins: string[]; contributors: string[]
  viewers: string[]; messages: ApiMessage[]
}
export interface MessagePage { nodes: ApiMessage[]; hasNextPage: boolean; endCursor: string | null }
export interface MyBucketSummary {
  id: string; bucketId: string; namespaceId: string | null; name: string | null
  isAdmin: boolean; isContributor: boolean; isViewer: boolean; isCreator: boolean
}
export interface OperationUpdate { stage: "signing" | "submitting" | "success" | "error"; message: string }
export type OperationUpdateHandler = (update: OperationUpdate) => void
export interface MutationResult { id: string; method: string }
export type BucketMemberRole = "admin" | "contributor" | "viewer"
export interface PinataConfig {
  jwt?: string; apiKey?: string; apiSecret?: string; publicGateway?: string
}
export interface BucketsRepositoryOptions {
  apiUrl: string
  pinataConfig?: PinataConfig
  /** Signs a raw GraphQL body for `address`. Wire via resolveWalletProvider(...).signApiRequest. */
  sign?: (address: string, rawBody: string) => Promise<HeadersInit>
  fetcher?: typeof fetch
}

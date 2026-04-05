import { describe, expect, it } from "vitest"
import { DidCommRepository } from "../../app/services/papi/didCommRepository"

describe("DidCommRepository", () => {
  it("loads namespaces from buckets.namespaces storage entries", async () => {
    const client = {
      rpc: async () => [] as unknown[],
      getEndpoint: () => "wss://example-chain"
    }

    const readNamespaceStorage = async (endpoint: string) => {
      expect(endpoint).toBe("wss://example-chain")
      return [{ id: "ns-1", name: "Namespace One" }, { namespaceId: "ns-2", namespace: "0x4e616d6573706163652054776f" }]
    }

    const repository = new DidCommRepository(
      client,
      async () => "0xignored",
      async () => "0xignored-bucket",
      readNamespaceStorage
    )
    const namespaces = await repository.fetchNamespaces()

    expect(namespaces).toHaveLength(2)
    expect(namespaces[0]).toMatchObject({ id: "ns-1", name: "Namespace One" })
    expect(namespaces[1]).toMatchObject({ id: "ns-2", name: "Namespace Two" })
  })

  it("fails when endpoint is unavailable for storage query", async () => {
    const client = {
      rpc: async () => [] as unknown[]
    }

    const repository = new DidCommRepository(client)

    await expect(repository.fetchNamespaces()).rejects.toThrow(
      "Unable to resolve chain endpoint for buckets.namespaces storage query"
    )
  })

  it("loads and filters buckets for a namespace from buckets.buckets storage", async () => {
    const client = {
      rpc: async () => [] as unknown[],
      getEndpoint: () => "wss://example-chain"
    }

    const readBucketsStorage = async (endpoint: string) => {
      expect(endpoint).toBe("wss://example-chain")
      return [
        { id: "bucket-1", namespaceId: "ns-1", name: "0x4275636b6574204f6e65" },
        { id: "bucket-2", namespaceId: "ns-2", name: "Bucket Two" },
        { id: "bucket-3", namespaceId: "ns-1", metadata: { name: "0x4275636b6574205468726565" } }
      ]
    }

    const repository = new DidCommRepository(
      client,
      async () => "0xignored",
      async () => "0xignored-bucket",
      async () => [],
      readBucketsStorage,
      async () => []
    )

    const buckets = await repository.fetchBuckets("ns-1")

    expect(buckets).toHaveLength(2)
    expect(buckets[0]).toMatchObject({ id: "bucket-1", namespaceId: "ns-1", name: "Bucket One" })
    expect(buckets[1]).toMatchObject({ id: "bucket-3", namespaceId: "ns-1", name: "Bucket Three" })
  })

  it("loads and filters messages for a bucket from buckets.messages storage", async () => {
    const client = {
      rpc: async () => [] as unknown[],
      getEndpoint: () => "wss://example-chain"
    }

    const readMessagesStorage = async (endpoint: string) => {
      expect(endpoint).toBe("wss://example-chain")
      return [
        { id: "message-1", bucketId: "bucket-1", summary: "0x48656c6c6f" },
        { id: "message-2", bucketId: "bucket-2", summary: "Other" }
      ]
    }

    const repository = new DidCommRepository(
      client,
      async () => "0xignored",
      async () => "0xignored-bucket",
      async () => [],
      async () => [],
      readMessagesStorage
    )

    const messages = await repository.fetchMessages("bucket-1")

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ id: "message-1", bucketId: "bucket-1", summary: "Hello" })
  })

  it("submits buckets.createNamespace extrinsic", async () => {
    const repository = new DidCommRepository(
      {
        rpc: async () => [] as unknown[],
        getEndpoint: () => "wss://example-chain"
      },
      async (endpoint, namespaceName, ownerAddress) => {
        expect(endpoint).toBe("wss://example-chain")
        expect(namespaceName).toBe("asset-messages")
        expect(ownerAddress).toBe("5F3sa2TJ...owner")
        return "0xabc123"
      },
      async () => "0xignored-bucket"
    )

    const result = await repository.createNamespace("asset-messages", "5F3sa2TJ...owner")

    expect(result.method).toBe("buckets.createNamespace")
    expect(result.txHash).toBe("0xabc123")
  })

  it("rejects namespace creation when name is empty", async () => {
    const repository = new DidCommRepository(
      { rpc: async () => "0xignored", getEndpoint: () => "wss://example-chain" },
      async () => "0xignored",
      async () => "0xignored-bucket"
    )

    await expect(repository.createNamespace("   ")).rejects.toThrow("Namespace name is required")
  })

  it("requires wallet address for namespace extrinsic", async () => {
    const repository = new DidCommRepository(
      { rpc: async () => "0xignored", getEndpoint: () => "wss://example-chain" },
      async () => "0xignored",
      async () => "0xignored-bucket"
    )

    await expect(repository.createNamespace("asset-messages")).rejects.toThrow(
      "Wallet must be connected to submit buckets.createNamespace extrinsic"
    )
  })

  it("requires endpoint for namespace extrinsic", async () => {
    const repository = new DidCommRepository(
      { rpc: async () => "0xignored" },
      async () => "0xignored",
      async () => "0xignored-bucket"
    )

    await expect(repository.createNamespace("asset-messages", "5F3sa2TJ...owner")).rejects.toThrow(
      "Unable to resolve chain endpoint for extrinsic submission"
    )
  })

  it("submits buckets.createBucket extrinsic", async () => {
    const repository = new DidCommRepository(
      {
        rpc: async () => [] as unknown[],
        getEndpoint: () => "wss://example-chain"
      },
      async () => "0xignored",
      async (endpoint, namespaceId, bucketName, ownerAddress) => {
        expect(endpoint).toBe("wss://example-chain")
        expect(namespaceId).toBe("ns-7")
        expect(bucketName).toBe("primary-bucket")
        expect(ownerAddress).toBe("5F3sa2TJ...owner")
        return "0xdef456"
      }
    )

    const result = await repository.createBucket("ns-7", "primary-bucket", "5F3sa2TJ...owner")

    expect(result.method).toBe("buckets.createBucket")
    expect(result.txHash).toBe("0xdef456")
  })

  it("rejects bucket creation when namespace id is empty", async () => {
    const repository = new DidCommRepository(
      { rpc: async () => "0xignored", getEndpoint: () => "wss://example-chain" },
      async () => "0xignored",
      async () => "0xignored-bucket"
    )

    await expect(repository.createBucket("   ", "primary-bucket", "5F3sa2TJ...owner")).rejects.toThrow(
      "Namespace id is required"
    )
  })

  it("rejects bucket creation when name is empty", async () => {
    const repository = new DidCommRepository(
      { rpc: async () => "0xignored", getEndpoint: () => "wss://example-chain" },
      async () => "0xignored",
      async () => "0xignored-bucket"
    )

    await expect(repository.createBucket("ns-7", "   ", "5F3sa2TJ...owner")).rejects.toThrow("Bucket name is required")
  })

  it("submits buckets.addMessage extrinsic", async () => {
    const repository = new DidCommRepository(
      {
        rpc: async () => [] as unknown[],
        getEndpoint: () => "wss://example-chain"
      },
      async () => "0xignored",
      async () => "0xignored-bucket",
      async () => [],
      async () => [],
      async () => [],
      async (endpoint, bucketId, message, ownerAddress) => {
        expect(endpoint).toBe("wss://example-chain")
        expect(bucketId).toBe("bucket-7")
        expect(message).toBe("hello world")
        expect(ownerAddress).toBe("5F3sa2TJ...owner")
        return "0xmsg789"
      }
    )

    const result = await repository.createMessage("bucket-7", "hello world", "5F3sa2TJ...owner")

    expect(result.method).toBe("buckets.addMessage")
    expect(result.txHash).toBe("0xmsg789")
  })

  it("rejects message creation when bucket id is empty", async () => {
    const repository = new DidCommRepository(
      { rpc: async () => "0xignored", getEndpoint: () => "wss://example-chain" },
      async () => "0xignored",
      async () => "0xignored-bucket"
    )

    await expect(repository.createMessage("   ", "hello", "5F3sa2TJ...owner")).rejects.toThrow("Bucket id is required")
  })

  it("rejects message creation when payload is empty", async () => {
    const repository = new DidCommRepository(
      { rpc: async () => "0xignored", getEndpoint: () => "wss://example-chain" },
      async () => "0xignored",
      async () => "0xignored-bucket"
    )

    await expect(repository.createMessage("bucket-7", "   ", "5F3sa2TJ...owner")).rejects.toThrow("Message is required")
  })

  it("requires wallet address for message extrinsic", async () => {
    const repository = new DidCommRepository(
      { rpc: async () => "0xignored", getEndpoint: () => "wss://example-chain" },
      async () => "0xignored",
      async () => "0xignored-bucket"
    )

    await expect(repository.createMessage("bucket-7", "hello world")).rejects.toThrow(
      "Wallet must be connected to submit buckets.addMessage extrinsic"
    )
  })

  it("submits buckets.addAdmin extrinsic", async () => {
    const repository = new DidCommRepository(
      {
        rpc: async () => [] as unknown[],
        getEndpoint: () => "wss://example-chain"
      },
      async () => "0xignored",
      async () => "0xignored-bucket",
      async () => [],
      async () => [],
      async () => [],
      async () => "0xignored-message",
      async (endpoint, namespaceId, bucketId, memberAddress, ownerAddress) => {
        expect(endpoint).toBe("wss://example-chain")
        expect(namespaceId).toBe("7")
        expect(bucketId).toBe("bucket-7")
        expect(memberAddress).toBe("5F3sa2TJ...member")
        expect(ownerAddress).toBe("5F3sa2TJ...owner")
        return "0xadmin123"
      }
    )

    const result = await repository.addBucketAdmin("7", "bucket-7", "5F3sa2TJ...member", "5F3sa2TJ...owner")

    expect(result.method).toBe("buckets.addAdmin")
    expect(result.txHash).toBe("0xadmin123")
  })

  it("submits buckets.addContributor extrinsic", async () => {
    const repository = new DidCommRepository(
      {
        rpc: async () => [] as unknown[],
        getEndpoint: () => "wss://example-chain"
      },
      async () => "0xignored",
      async () => "0xignored-bucket",
      async () => [],
      async () => [],
      async () => [],
      async () => "0xignored-message",
      async () => "0xignored-admin",
      async (endpoint, namespaceId, bucketId, memberAddress, ownerAddress) => {
        expect(endpoint).toBe("wss://example-chain")
        expect(namespaceId).toBe("7")
        expect(bucketId).toBe("bucket-7")
        expect(memberAddress).toBe("5F3sa2TJ...member")
        expect(ownerAddress).toBe("5F3sa2TJ...owner")
        return "0xcontrib456"
      }
    )

    const result = await repository.addBucketContributor("7", "bucket-7", "5F3sa2TJ...member", "5F3sa2TJ...owner")

    expect(result.method).toBe("buckets.addContributor")
    expect(result.txHash).toBe("0xcontrib456")
  })

  it("submits buckets.removeAdmin extrinsic", async () => {
    const repository = new DidCommRepository(
      {
        rpc: async () => [] as unknown[],
        getEndpoint: () => "wss://example-chain"
      },
      async () => "0xignored",
      async () => "0xignored-bucket",
      async () => [],
      async () => [],
      async () => [],
      async () => "0xignored-message",
      async () => "0xignored-admin",
      async () => "0xignored-contributor",
      async (endpoint, namespaceId, bucketId, memberAddress, ownerAddress) => {
        expect(endpoint).toBe("wss://example-chain")
        expect(namespaceId).toBe("7")
        expect(bucketId).toBe("bucket-7")
        expect(memberAddress).toBe("5F3sa2TJ...member")
        expect(ownerAddress).toBe("5F3sa2TJ...owner")
        return "0xremove-admin"
      }
    )

    const result = await repository.removeBucketAdmin("7", "bucket-7", "5F3sa2TJ...member", "5F3sa2TJ...owner")

    expect(result.method).toBe("buckets.removeAdmin")
    expect(result.txHash).toBe("0xremove-admin")
  })

  it("submits buckets.removeContributor extrinsic", async () => {
    const repository = new DidCommRepository(
      {
        rpc: async () => [] as unknown[],
        getEndpoint: () => "wss://example-chain"
      },
      async () => "0xignored",
      async () => "0xignored-bucket",
      async () => [],
      async () => [],
      async () => [],
      async () => "0xignored-message",
      async () => "0xignored-admin",
      async () => "0xignored-contributor",
      async () => "0xignored-remove-admin",
      async (endpoint, namespaceId, bucketId, memberAddress, ownerAddress) => {
        expect(endpoint).toBe("wss://example-chain")
        expect(namespaceId).toBe("7")
        expect(bucketId).toBe("bucket-7")
        expect(memberAddress).toBe("5F3sa2TJ...member")
        expect(ownerAddress).toBe("5F3sa2TJ...owner")
        return "0xremove-contributor"
      }
    )

    const result = await repository.removeBucketContributor("7", "bucket-7", "5F3sa2TJ...member", "5F3sa2TJ...owner")

    expect(result.method).toBe("buckets.removeContributor")
    expect(result.txHash).toBe("0xremove-contributor")
  })

  it("rejects add-admin when namespace id is empty", async () => {
    const repository = new DidCommRepository(
      { rpc: async () => "0xignored", getEndpoint: () => "wss://example-chain" },
      async () => "0xignored",
      async () => "0xignored-bucket"
    )

    await expect(repository.addBucketAdmin("   ", "bucket-7", "5F3sa2TJ...member", "5F3sa2TJ...owner")).rejects.toThrow(
      "Namespace id is required"
    )
  })
})

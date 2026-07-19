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

  it("submits buckets.write extrinsic", async () => {
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

    expect(result.method).toBe("buckets.write")
    expect(result.txHash).toBe("0xmsg789")
  })

  it("passes contentType override through to the message submitter", async () => {
    let receivedContentType: string | undefined = "unset"
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
      async (_endpoint, _bucketId, _message, _ownerAddress, _onUpdate, _tag, _pinataConfig, contentType) => {
        receivedContentType = contentType
        return "0xmsg790"
      }
    )

    await repository.createMessage("bucket-7", "bafy-file-cid", "5F3sa2TJ...owner", undefined, undefined, "image/png")

    expect(receivedContentType).toBe("image/png")
  })

  it("passes no contentType to the message submitter when none is given", async () => {
    let receivedContentType: string | undefined = "unset"
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
      async (_endpoint, _bucketId, _message, _ownerAddress, _onUpdate, _tag, _pinataConfig, contentType) => {
        receivedContentType = contentType
        return "0xmsg791"
      }
    )

    await repository.createMessage("bucket-7", "hello world", "5F3sa2TJ...owner")

    expect(receivedContentType).toBeUndefined()
  })

  it("submits the file JWE as the message content with the file's real content type", async () => {
    const submitted: { message?: string; tag?: string; contentType?: string } = {}
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
      async (_endpoint, _bucketId, message, _ownerAddress, _onUpdate, tag, _pinataConfig, contentType) => {
        submitted.message = message
        submitted.tag = tag
        submitted.contentType = contentType
        return "0xfile123"
      }
    )

    const result = await repository.createFileMessage(
      "bucket-7",
      "eyJhbGciOiJFQ0RILUVTK0EyNTZLVyJ9.a.b.c.d",
      "image/png",
      "5F3sa2TJ...owner"
    )

    expect(result.method).toBe("buckets.write")
    expect(result.txHash).toBe("0xfile123")
    expect(submitted.message).toBe("eyJhbGciOiJFQ0RILUVTK0EyNTZLVyJ9.a.b.c.d")
    expect(submitted.contentType).toBe("image/png")
    expect(submitted.tag).toBeUndefined()
  })

  it("falls back to application/octet-stream when the file content type is blank", async () => {
    let receivedContentType: string | undefined
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
      async (_endpoint, _bucketId, _message, _ownerAddress, _onUpdate, _tag, _pinataConfig, contentType) => {
        receivedContentType = contentType
        return "0xfile124"
      }
    )

    await repository.createFileMessage("bucket-7", "eyJhbGciOi.a.b.c.d", "   ", "5F3sa2TJ...owner")

    expect(receivedContentType).toBe("application/octet-stream")
  })

  it("rejects createFileMessage when the file payload is empty", async () => {
    const repository = new DidCommRepository(
      { rpc: async () => "0xignored", getEndpoint: () => "wss://example-chain" },
      async () => "0xignored",
      async () => "0xignored-bucket"
    )

    await expect(
      repository.createFileMessage("bucket-7", "   ", "image/png", "5F3sa2TJ...owner")
    ).rejects.toThrow("File payload is required")
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
      "Wallet must be connected to submit buckets.write extrinsic"
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
      undefined,
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
      undefined,
      undefined,
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

  it("submits a utility.batchAll removing every role a member holds", async () => {
    const calls: unknown[] = []
    const repository = new DidCommRepository(
      {
        rpc: async () => [] as unknown[],
        getEndpoint: () => "wss://example-chain"
      },
      undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined,
      async (endpoint, namespaceId, bucketId, memberAddress, roles, viewerKey, ownerAddress) => {
        calls.push({ endpoint, namespaceId, bucketId, memberAddress, roles, viewerKey, ownerAddress })
        return "0xremove-batch"
      }
    )

    // Roles supplied out of order and with a duplicate; the repository normalizes them.
    const result = await repository.removeBucketMemberRoles(
      "7",
      "bucket-7",
      "5F3sa2TJ...member",
      ["viewer", "admin", "admin"],
      "0xviewer-x25519-key",
      "5F3sa2TJ...owner"
    )

    expect(result.method).toBe("utility.batchAll")
    expect(result.txHash).toBe("0xremove-batch")
    expect(calls).toEqual([
      {
        endpoint: "wss://example-chain",
        namespaceId: "7",
        bucketId: "bucket-7",
        memberAddress: "5F3sa2TJ...member",
        roles: ["admin", "viewer"],
        viewerKey: "0xviewer-x25519-key",
        ownerAddress: "5F3sa2TJ...owner"
      }
    ])
  })

  it("rejects remove-member-roles when no roles are provided", async () => {
    const repository = new DidCommRepository(
      { rpc: async () => "0xignored", getEndpoint: () => "wss://example-chain" }
    )

    await expect(
      repository.removeBucketMemberRoles("7", "bucket-7", "5F3sa2TJ...member", [], undefined, "5F3sa2TJ...owner")
    ).rejects.toThrow("At least one role is required to remove a member")
  })

  it("rejects remove-member-roles when a viewer role has no viewer key", async () => {
    const repository = new DidCommRepository(
      { rpc: async () => "0xignored", getEndpoint: () => "wss://example-chain" }
    )

    await expect(
      repository.removeBucketMemberRoles("7", "bucket-7", "5F3sa2TJ...member", ["viewer"], undefined, "5F3sa2TJ...owner")
    ).rejects.toThrow("Viewer key is required to remove a viewer")
  })

  it("submits a utility.batchAll adding admin, contributor and viewer for the admin role", async () => {
    const calls: unknown[] = []
    const repository = new DidCommRepository(
      {
        rpc: async () => [] as unknown[],
        getEndpoint: () => "wss://example-chain"
      },
      undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined,
      async () => {
        throw new Error("addViewer should not be called directly for the admin role")
      },
      undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined,
      async (endpoint, role, namespaceId, bucketId, ss58Address, x25519Key, ownerAddress) => {
        calls.push({ endpoint, role, namespaceId, bucketId, ss58Address, x25519Key, ownerAddress })
        return "0xbatch-admin"
      }
    )

    const result = await repository.addBucketMemberWithRole(
      "admin",
      "9",
      "bucket-9",
      "5F3sa2TJ...member",
      // base64url JWK "x" value (43 chars) as stored on a profile
      "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA",
      "5F3sa2TJ...owner"
    )

    expect(result.method).toBe("utility.batchAll")
    expect(result.txHash).toBe("0xbatch-admin")
    expect(calls).toEqual([
      {
        endpoint: "wss://example-chain",
        role: "admin",
        namespaceId: "9",
        bucketId: "bucket-9",
        ss58Address: "5F3sa2TJ...member",
        // decoded to a fixed 32-byte hex string for the chain's [u8;32] viewer field
        x25519Key: "0x0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20",
        ownerAddress: "5F3sa2TJ...owner"
      }
    ])
  })

  it("submits a utility.batchAll adding contributor and viewer for the contributor role", async () => {
    let observedRole = ""
    let observedKey = ""
    const repository = new DidCommRepository(
      {
        rpc: async () => [] as unknown[],
        getEndpoint: () => "wss://example-chain"
      },
      undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined,
      async (_endpoint, role, _namespaceId, _bucketId, _ss58Address, x25519Key) => {
        observedRole = role
        observedKey = x25519Key
        return "0xbatch-contributor"
      }
    )

    const result = await repository.addBucketMemberWithRole(
      "contributor",
      "9",
      "bucket-9",
      "5F3sa2TJ...member",
      "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA",
      "5F3sa2TJ...owner"
    )

    expect(observedRole).toBe("contributor")
    expect(observedKey).toBe("0x0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20")
    expect(result.method).toBe("utility.batchAll")
    expect(result.txHash).toBe("0xbatch-contributor")
  })

  it("submits a direct buckets.addViewer using the x25519 key for the viewer role", async () => {
    let viewerMemberArg = ""
    const repository = new DidCommRepository(
      {
        rpc: async () => [] as unknown[],
        getEndpoint: () => "wss://example-chain"
      },
      undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined,
      async (endpoint, namespaceId, bucketId, memberAddress, ownerAddress) => {
        expect(endpoint).toBe("wss://example-chain")
        expect(namespaceId).toBe("9")
        expect(bucketId).toBe("bucket-9")
        expect(ownerAddress).toBe("5F3sa2TJ...owner")
        viewerMemberArg = memberAddress
        return "0xviewer-only"
      },
      undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined,
      async () => {
        throw new Error("batch submitter should not be called for the viewer role")
      }
    )

    const result = await repository.addBucketMemberWithRole(
      "viewer",
      "9",
      "bucket-9",
      "5F3sa2TJ...member",
      "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA",
      "5F3sa2TJ...owner"
    )

    expect(viewerMemberArg).toBe("0x0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20")
    expect(result.method).toBe("buckets.addViewer")
    expect(result.txHash).toBe("0xviewer-only")
  })

  it("rejects add-member-with-role when the x25519 key is empty", async () => {
    const repository = new DidCommRepository(
      { rpc: async () => "0xignored", getEndpoint: () => "wss://example-chain" }
    )

    await expect(
      repository.addBucketMemberWithRole("admin", "9", "bucket-9", "5F3sa2TJ...member", "   ", "5F3sa2TJ...owner")
    ).rejects.toThrow("X25519 key is required")
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

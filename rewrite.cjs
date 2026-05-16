const fs = require('fs');
const path = 'app/pages/indexed-bucket/[id]/index.vue';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(
  'import { hexToU8a } from "@polkadot/util"',
  'import { hexToU8a } from "@polkadot/util"\nimport { xxhashAsHex } from "@polkadot/util-crypto"'
);

const replacements = `
const blockTimestampByNumber = ref<Record<number, number>>({})
const timestampStorageKey = \`\${xxhashAsHex("Timestamp", 128)}\${xxhashAsHex("Now", 128).slice(2)}\`

function parseU64FromHex(value: string): number | null {
  if (!value || !value.startsWith("0x")) return null
  const bytes = hexToU8a(value)
  if (bytes.length < 8) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return Number(view.getBigUint64(0, true))
}

async function fetchTimestampForBlock(blockNumber: number): Promise<number | null> {
  try {
    const blockHash = await ($papiClient as any).rpc("chain_getBlockHash", [blockNumber])
    const storage = await ($papiClient as any).rpc("state_getStorage", [timestampStorageKey, blockHash])
    if (!storage) return null
    return parseU64FromHex(storage)
  } catch {
    return null
  }
}

async function loadBlockTimestamps(blockNumbers: number[]): Promise<void> {
  const unique = Array.from(new Set(blockNumbers)).filter(
    (value) => Number.isFinite(value) && value > 0 && blockTimestampByNumber.value[value] === undefined
  )
  if (!unique.length) return
  const updates = await Promise.all(
    unique.map(async (blockNumber) => ({
      blockNumber,
      timestamp: await fetchTimestampForBlock(blockNumber)
    }))
  )
  const next = { ...blockTimestampByNumber.value }
  for (const update of updates) {
    if (update.timestamp !== null) next[update.blockNumber] = update.timestamp
  }
  blockTimestampByNumber.value = next
}

function resolveIndexerUrl(): string {
  const url = runtimeConfig.public.subqueryIndexerUrl
  if (typeof url === "string" && url.trim()) return url.trim()
  throw new Error("Subquery indexer URL is not configured")
}

async function loadIndexerData() {
  bucketError.value = ""
  bucketLoading.value = true
  messagesError.value = ""
  messagesLoading.value = true
  membersError.value = ""

  try {
    const response = await fetch(resolveIndexerUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: \`
          query IndexedBucketDetail($bucketId: String!) {
            buckets(filter: { bucketId: { equalTo: $bucketId } }, first: 1) {
              nodes {
                id
                namespaceId
                bucketId
                creator
                name
                category
                isWritable
                encryptionKey
                createdBlock
                contributors {
                  nodes {
                    contributor
                  }
                }
                admins {
                  nodes {
                    admin
                  }
                }
                messages(orderBy: [CREATED_BLOCK_ASC]) {
                  nodes {
                    id
                    bucketId
                    messageId
                    contributor
                    reference
                    tag
                    description
                    contentType
                    contentHash
                    createdBlock
                    ipfsContent
                  }
                }
              }
            }
          }
        \`,
        variables: {
          bucketId: bucketId.value
        }
      })
    })

    const payload = await response.json()
    const indexerBucket = payload.data?.buckets?.nodes?.[0]
    if (!indexerBucket) {
      bucket.value = null
      bucketError.value = "Unable to find bucket in indexer"
      return
    }

    bucket.value = {
      id: String(indexerBucket.bucketId),
      name: indexerBucket.name,
      namespaceId: String(indexerBucket.namespaceId),
      raw: indexerBucket
    } as any

    const admins = indexerBucket.admins?.nodes?.map((n: any) => n.admin) || []
    const contributors = indexerBucket.contributors?.nodes?.map((n: any) => n.contributor) || []
    bucketAdmins.value = admins
    bucketContributors.value = contributors

    const loadedMessages = (indexerBucket.messages?.nodes || []).map((m: any) => {
      return {
        id: String(m.messageId),
        summary: m.description,
        raw: {
          tag: m.tag,
          sender: m.contributor,
          createdAt: m.createdBlock,
          reference: m.reference,
          contentType: m.contentType,
        }
      } as any
    })
    
    const uniqueBlocks = Array.from(new Set(loadedMessages.map((m: any) => m.raw.createdAt).filter((b: any) => typeof b === "number" && b > 0)))
    await loadBlockTimestamps(uniqueBlocks as number[])
    
    loadedMessages.forEach((m: any) => {
      const block = m.raw.createdAt
      if (typeof block === "number" && blockTimestampByNumber.value[block]) {
        m.raw.createdAt = blockTimestampByNumber.value[block]
      } else {
        m.raw.createdAt = undefined
      }
    })

    messages.value = loadedMessages

    await Promise.all([
      loadContributorX25519Keys(contributors),
      (async () => {
        await hydrateMessagePayloads(loadedMessages)
        await decryptLatestKeySharingPayload()
        await decryptReceivedMessages(loadedMessages)
      })()
    ])

  } catch (error) {
    bucket.value = null
    bucketError.value = error instanceof Error ? error.message : "Unable to load bucket metadata"
  } finally {
    bucketLoading.value = false
    messagesLoading.value = false
  }
}

async function loadMessages() {
  await loadIndexerData()
}

async function loadBucket() {
  // handled by loadIndexerData
}

async function loadBucketMembers() {
  // handled by loadIndexerData
}

async function loadBucketPage() {
  await loadIndexerData()
}
`;

// Replace loadMessages
const loadMessagesRegex = /async function loadMessages\(\) \{[\s\S]*?(?=function parseJsonSafely)/;
content = content.replace(loadMessagesRegex, replacements + "\n\n");

// Remove loadBucket
const loadBucketRegex = /async function loadBucket\(\) \{[\s\S]*?(?=async function loadBucketMembers)/;
content = content.replace(loadBucketRegex, "");

// Remove loadBucketMembers
const loadBucketMembersRegex = /async function loadBucketMembers\(\) \{[\s\S]*?(?=function isHex32)/;
content = content.replace(loadBucketMembersRegex, "");

// Remove loadBucketPage
const loadBucketPageRegex = /async function loadBucketPage\(\) \{[\s\S]*?(?=function formatTimestamp)/;
content = content.replace(loadBucketPageRegex, "");

// Update NuxtLink to Info page
content = content.replace(
  'to="\`/messages/bucket/${encodeURIComponent(bucketId)}/info\`"',
  'to="\`/indexed-bucket/${encodeURIComponent(bucketId)}/info\`"'
);

fs.writeFileSync(path, content);
console.log("Done");

<script setup lang="ts">
import LoadingBar from "../../components/common/LoadingBar.vue"
import SkeletonCard from "../../components/common/SkeletonCard.vue"
import WalletConnectPrompt from "../../components/common/WalletConnectPrompt.vue"
import { computed, onMounted, ref, watch } from "vue"
import { useNuxtApp, useRuntimeConfig } from "nuxt/app"
import { useSessionStore } from "../../stores/session"
import { useSettingsStore } from "../../stores/settings"
import { hexToU8a } from "@polkadot/util"
import { decodeAddress, encodeAddress, xxhashAsHex } from "@polkadot/util-crypto"

interface BucketConnectionNode {
  id: string
  bucketId: number
  namespaceId: number
  name?: string | null
  admins: { totalCount: number }
  contributors: { totalCount: number }
  messages: { nodes: Array<{ createdBlock: number }> }
}

const runtimeConfig = useRuntimeConfig()
const { $papiClient } = useNuxtApp()
const session = useSessionStore()
const settings = useSettingsStore()

const pageSize = 20
const buckets = ref<BucketConnectionNode[]>([])
const totalCount = ref(0)
const offset = ref(0)
const loading = ref(true)
const loadingMore = ref(false)
const error = ref("")
const blockTimestampByNumber = ref<Record<number, number>>({})
const sentinelElement = ref<HTMLElement | null>(null)

const isWalletConnected = computed(() => session.walletStatus === "connected" && Boolean(session.accountAddress))
const showDebug = computed(() => settings.showMessageDebug)
const hasMoreData = computed(() => offset.value + buckets.value.length < totalCount.value)


const timestampStorageKey = `${xxhashAsHex("Timestamp", 128)}${xxhashAsHex("Now", 128).slice(2)}`

function parseU64FromHex(value: string): number | null {
  if (!value || !value.startsWith("0x")) {
    return null
  }

  const bytes = hexToU8a(value)
  if (bytes.length < 8) {
    return null
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const raw = view.getBigUint64(0, true)
  return Number(raw)
}

async function fetchTimestampForBlock(blockNumber: number): Promise<number | null> {
  try {
    const blockHash = await ($papiClient as { rpc(method: string, params?: unknown[]): Promise<string> }).rpc(
      "chain_getBlockHash",
      [blockNumber]
    )

    const storage = await ($papiClient as { rpc(method: string, params?: unknown[]): Promise<string | null> }).rpc(
      "state_getStorage",
      [timestampStorageKey, blockHash]
    )

    if (!storage) {
      return null
    }

    return parseU64FromHex(storage)
  } catch {
    return null
  }
}

async function loadBlockTimestamps(blockNumbers: number[]): Promise<void> {
  const unique = Array.from(new Set(blockNumbers)).filter(
    (value) => Number.isFinite(value) && value > 0 && blockTimestampByNumber.value[value] === undefined
  )

  if (!unique.length) {
    return
  }

  const updates = await Promise.all(
    unique.map(async (blockNumber) => ({
      blockNumber,
      timestamp: await fetchTimestampForBlock(blockNumber)
    }))
  )

  const next = { ...blockTimestampByNumber.value }
  for (const update of updates) {
    if (update.timestamp !== null) {
      next[update.blockNumber] = update.timestamp
    }
  }

  blockTimestampByNumber.value = next
}

function resolveIndexerUrl(): string {
  const url = runtimeConfig.public.subqueryIndexerUrl
  if (typeof url === "string" && url.trim()) {
    return url.trim()
  }

  throw new Error("Subquery indexer URL is not configured")
}

function resolveDisplayName(bucket: BucketConnectionNode): string {
  const name = typeof bucket.name === "string" ? bucket.name.trim() : ""
  if (name) {
    return name
  }

  return `Bucket ${bucket.bucketId}`
}

function resolveIndexerAddress(address: string): string {
  const trimmed = address.trim()
  if (!trimmed) {
    return trimmed
  }

  try {
    const decoded = decodeAddress(trimmed)
    return encodeAddress(decoded, 0)
  } catch {
    return trimmed
  }
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })
  const units: Array<{ unit: Intl.RelativeTimeFormatUnit; secs: number }> = [
    { unit: "year", secs: 31536000 },
    { unit: "month", secs: 2592000 },
    { unit: "day", secs: 86400 },
    { unit: "hour", secs: 3600 },
    { unit: "minute", secs: 60 },
    { unit: "second", secs: 1 }
  ]

  for (const u of units) {
    if (seconds >= u.secs || u.unit === "second") {
      const value = Math.round(seconds / u.secs)
      return rtf.format(-value, u.unit)
    }
  }

  return "just now"
}

function formatLastMessage(bucket: BucketConnectionNode): string {
  const createdBlock = bucket.messages.nodes[0]?.createdBlock
  if (createdBlock === undefined || createdBlock === null) {
    return "No messages yet"
  }

  const timestamp = blockTimestampByNumber.value[createdBlock]
  if (!timestamp) {
    return showDebug.value ? `Block ${createdBlock}` : "..."
  }

  const relative = timeAgo(timestamp)
  if (showDebug.value) {
    const formatted = new Date(timestamp).toLocaleString()
    return `${relative} (${formatted} · block ${createdBlock})`
  }

  return relative
}

async function loadBuckets(): Promise<void> {
  error.value = ""

  if (!isWalletConnected.value || !session.accountAddress) {
    buckets.value = []
    totalCount.value = 0
    offset.value = 0
    return
  }

  if (offset.value === 0) {
    loading.value = true
  } else {
    loadingMore.value = true
  }

  try {
    const response = await fetch(resolveIndexerUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `
          query MyBuckets($address: String!, $first: Int!, $offset: Int!) {
            buckets(
              first: $first
              offset: $offset
              orderBy: [NAME_ASC]
              filter: {
                or: [
                  { admins: { some: { subjectId: { equalToInsensitive: $address } } } }
                  { contributors: { some: { subjectId: { equalToInsensitive: $address } } } }
                ]
              }
            ) {
              totalCount
              nodes {
                id
                bucketId
                namespaceId
                name
                admins(filter: { subjectId: { equalToInsensitive: $address } }) {
                  totalCount
                }
                contributors(filter: { subjectId: { equalToInsensitive: $address } }) {
                  totalCount
                }
                messages(first: 1, orderBy: [CREATED_BLOCK_DESC]) {
                  nodes {
                    createdBlock
                  }
                }
              }
            }
          }
        `,
        variables: {
          address: resolveIndexerAddress(session.accountAddress),
          first: pageSize,
          offset: offset.value
        }
      })
    })

    const payload = (await response.json()) as {
      data?: { buckets?: { totalCount?: number; nodes?: BucketConnectionNode[] } }
      errors?: Array<{ message?: string }>
    }

    if (!response.ok || payload.errors?.length) {
      const message = payload.errors?.[0]?.message || `Indexer request failed (${response.status})`
      throw new Error(message)
    }

    const newBuckets = payload.data?.buckets?.nodes ?? []
    totalCount.value = payload.data?.buckets?.totalCount ?? 0

    if (offset.value === 0) {
      buckets.value = newBuckets
    } else {
      buckets.value.push(...newBuckets)
    }

    offset.value += newBuckets.length

    await loadBlockTimestamps(
      newBuckets
        .map((bucket) => bucket.messages.nodes[0]?.createdBlock)
        .filter((value): value is number => typeof value === "number")
    )
  } catch (fetchError) {
    error.value = fetchError instanceof Error ? fetchError.message : "Unable to load buckets"
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

function setupIntersectionObserver(): void {
  if (!import.meta.client || !sentinelElement.value) {
    return
  }

  const observer = new IntersectionObserver(
    (entries) => {
      const entry = entries[0]
      if (entry?.isIntersecting && hasMoreData.value && !loading.value && !loadingMore.value) {
        void loadBuckets()
      }
    },
    { rootMargin: "100px" }
  )

  observer.observe(sentinelElement.value)
}

watch(
  () => session.accountAddress,
  () => {
    offset.value = 0
    void loadBuckets()
  }
)

onMounted(() => {
  settings.initialize()
  setupIntersectionObserver()
  if (isWalletConnected.value) {
    void loadBuckets()
  }
})
</script>

<template>
  <div class="chat-custom-page">
    <div class="info-content-scroll stack">
    <section class="stack" aria-live="polite">
      <div class="row buckets-header" style="justify-content: space-between; align-items: center">
        <div class="stack" style="gap: 4px">
          <h3 style="margin: 0">My messages</h3>
        </div>
        <div class="row" style="gap: 8px">
          <NuxtLink class="btn" :to="`/messages/bucket/create/${runtimeConfig.public.publicFreeCommunicationBucket}`">Add Bucket</NuxtLink>
        </div>
      </div>

      <WalletConnectPrompt
        v-if="!isWalletConnected"
        title="Connect Your Wallet"
        description="Connect your wallet to view and manage the buckets you contribute to or administer."
      />

      <template v-else>
        <p v-if="error" style="margin: 0; color: var(--status-error)">{{ error }}</p>
        <p v-else-if="!buckets.length && !loading" class="muted" style="margin: 0">
          No buckets found for this wallet.
        </p>

        <div v-else-if="buckets.length" class="stack" style="gap: 12px">
        <NuxtLink
          v-for="bucket in buckets"
          :key="bucket.id"
          :to="`/indexed-bucket/${encodeURIComponent(bucket.id)}`"
          class="card bucket-card"
          style="padding: 16px; text-decoration: none; color: inherit; display: block"
        >
          <div class="row" style="justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap">
            <div class="stack" style="gap: 6px">
              <strong style="font-size: 16px">{{ resolveDisplayName(bucket) }}</strong>
              <p v-if="showDebug" class="muted" style="margin: 0">Bucket ID: {{ bucket.bucketId }} · Namespace: {{ bucket.namespaceId }}</p>
              <p class="muted" style="margin: 0">Last message: {{ formatLastMessage(bucket) }}</p>
            </div>

            <div class="row" style="gap: 6px; flex-wrap: wrap">
              <span v-if="bucket.admins.totalCount > 0"
                style="padding: 6px 12px; border-radius: 999px; font-size: 12px; background: var(--color-primary); color: white; font-weight: 500">
                Admin
              </span>
              <span v-if="bucket.contributors.totalCount > 0"
                style="padding: 6px 12px; border-radius: 999px; font-size: 12px; background: var(--color-primary); color: white; font-weight: 500">
                Contributor
              </span>
              <span v-if="bucket.admins.totalCount === 0 && bucket.contributors.totalCount === 0"
                style="padding: 4px 10px; border-radius: 999px; font-size: 12px; background: var(--surface-muted)">
                Viewer
              </span>
            </div>
          </div>
        </NuxtLink>

        <!-- Loading skeleton cards -->
        <article v-for="index in 3" v-show="loadingMore && hasMoreData" :key="`skeleton-${index}`" class="card"
          style="padding: 16px; opacity: 0.6">
          <div class="row" style="justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap">
            <div class="stack" style="gap: 6px; flex: 1">
              <div style="height: 16px; width: 60%; background: var(--surface-muted); border-radius: 4px"></div>
              <div style="height: 14px; width: 80%; background: var(--surface-muted); border-radius: 4px"></div>
              <div style="height: 14px; width: 70%; background: var(--surface-muted); border-radius: 4px"></div>
            </div>
            <div class="row" style="gap: 6px; flex-wrap: wrap">
              <div style="height: 24px; width: 60px; background: var(--surface-muted); border-radius: 999px"></div>
            </div>
          </div>
        </article>



        <!-- Sentinel element for infinite scroll -->
        <div ref="sentinelElement" style="height: 1px; visibility: hidden"></div>
      </div>

        <SkeletonCard v-else-if="loading" :count="3" :lines="2" />
      </template>
    </section>
    </div>
  </div>
</template>
<style scoped>
.chat-custom-page {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 48px);
  margin: -24px;
  background: #f7f8fa;
  overflow: hidden;
}

.info-content-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  overscroll-behavior: contain;
}

@media (max-width: 960px) {
  .chat-custom-page {
    height: calc(100vh - 56px);
    margin: -16px;
  }
  .info-content-scroll {
    padding: 16px;
  }
}

.bucket-card {
  transition: transform 150ms ease, box-shadow 150ms ease, border-color 150ms ease;
}

.bucket-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  border-color: var(--color-primary);
}
</style>

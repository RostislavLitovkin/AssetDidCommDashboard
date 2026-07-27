<script setup lang="ts">
import SkeletonCard from "../../components/common/SkeletonCard.vue"
import WalletConnectPrompt from "../../components/common/WalletConnectPrompt.vue"
import PageHeader from "../../components/common/PageHeader.vue"
import type { MyBucketSummary } from "../../services/buckets/types"
import { computed, onMounted, ref, watch } from "vue"
import { useRuntimeConfig } from "nuxt/app"
import { useSessionStore } from "../../stores/session"
import { useSettingsStore } from "../../stores/settings"
import { normalizeApiAddress } from "../../services/wallet/addressUtils"
import { base64url } from "jose"

const runtimeConfig = useRuntimeConfig()
const session = useSessionStore()
const settings = useSettingsStore()
const bucketsRepository = useBucketsRepository()

const pageSize = 20
const buckets = ref<MyBucketSummary[]>([])
const totalCount = ref(0)
const loading = ref(true)
const loadingMore = ref(false)
const error = ref("")
const sentinelElement = ref<HTMLElement | null>(null)

const endCursor = ref<string | null>(null)
const hasNextPage = ref(false)
const lastMessageAtByBucket = ref<Record<string, string>>({})

const isWalletConnected = computed(() => session.walletStatus === "connected" && Boolean(session.accountAddress))
const showDebug = computed(() => settings.showMessageDebug)
const hasMoreData = computed(() => hasNextPage.value)

function resolveDisplayName(bucket: MyBucketSummary): string {
  const name = typeof bucket.name === "string" ? bucket.name.trim() : ""
  if (name) {
    return name
  }

  return `Bucket ${bucket.bucketId}`
}

// Viewers are keyed on-chain by their X25519 public key, stored by the indexer as 0x-hex.
function resolveViewerKeyHex(): string {
  const x = settings.x25519SecretJwk?.x
  if (typeof x !== "string" || !x.trim()) {
    return ""
  }

  try {
    const bytes = base64url.decode(x.trim())
    let hex = "0x"
    for (const value of bytes) {
      hex += value.toString(16).padStart(2, "0")
    }
    return hex
  } catch {
    return ""
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

function formatLastMessage(bucket: MyBucketSummary): string {
  const iso = lastMessageAtByBucket.value[bucket.bucketId]
  if (!iso) {
    return "No messages yet"
  }

  const timestamp = Date.parse(iso)
  if (Number.isNaN(timestamp)) {
    return "No messages yet"
  }

  const relative = timeAgo(timestamp)
  if (showDebug.value) {
    const formatted = new Date(timestamp).toLocaleString()
    return `${relative} (${formatted})`
  }

  return relative
}

async function loadBuckets(reset = false): Promise<void> {
  error.value = ""
  if (!isWalletConnected.value || !session.accountAddress) {
    buckets.value = []
    totalCount.value = 0
    endCursor.value = null
    hasNextPage.value = false
    return
  }

  if (reset) {
    endCursor.value = null
    buckets.value = []
    lastMessageAtByBucket.value = {}
    loading.value = true
  } else {
    loadingMore.value = true
  }

  try {
    const page = await bucketsRepository.fetchMyBuckets(
      normalizeApiAddress(session.accountAddress),
      resolveViewerKeyHex(),
      { first: pageSize, after: reset ? null : endCursor.value }
    )

    totalCount.value = page.totalCount
    hasNextPage.value = page.hasNextPage
    endCursor.value = page.endCursor
    buckets.value = reset ? page.nodes : [...buckets.value, ...page.nodes]

    const times = await bucketsRepository.fetchLatestMessageTimes(page.nodes.map((b) => b.bucketId))
    lastMessageAtByBucket.value = { ...lastMessageAtByBucket.value, ...times }
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
        void loadBuckets(false)
      }
    },
    { rootMargin: "100px" }
  )

  observer.observe(sentinelElement.value)
}

watch(
  () => session.accountAddress,
  () => {
    void loadBuckets(true)
  }
)

watch(
  () => settings.x25519SecretJwk?.x,
  () => {
    void loadBuckets(true)
  }
)

onMounted(() => {
  settings.initialize()
  setupIntersectionObserver()
  if (isWalletConnected.value) {
    void loadBuckets(true)
  }
})
</script>

<template>
  <div class="chat-custom-page">
    <div class="info-content-scroll stack">
    <section class="stack" aria-live="polite">
      <PageHeader title="My messages">
        <template #actions>
          <NuxtLink class="btn" :to="`/messages/bucket/create/${runtimeConfig.public.publicFreeCommunicationBucket}`">Add Bucket</NuxtLink>
        </template>
      </PageHeader>

      <WalletConnectPrompt
        v-if="!isWalletConnected"
        title="Connect Your Wallet"
        description="Connect your wallet to view and manage the buckets you contribute to or administer."
      />

      <template v-else>
        <p v-if="error" style="margin: 0; color: var(--status-error)">{{ error }}</p>
        <p v-else-if="!buckets.length && !loading" class="muted" style="margin: 0; min-height: 228px; display: flex; align-items: center; justify-content: center;">
          You do not have access to any buckets.
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
              <span v-if="bucket.isAdmin"
                style="padding: 6px 12px; border-radius: 999px; font-size: 12px; background: var(--color-primary); color: white; font-weight: 500">
                Admin
              </span>
              <span v-if="bucket.isContributor"
                style="padding: 6px 12px; border-radius: 999px; font-size: 12px; background: var(--color-primary); color: white; font-weight: 500">
                Contributor
              </span>
              <span v-if="bucket.isViewer"
                style="padding: 6px 12px; border-radius: 999px; font-size: 12px; background: var(--color-primary); color: white; font-weight: 500">
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

<script setup lang="ts">
import { DidCommRepository, type BucketRecord } from "../../../services/papi/didCommRepository"
import LoadingBar from "../../../components/common/LoadingBar.vue"
import WalletConnectPrompt from "../../../components/common/WalletConnectPrompt.vue"
import { computed, onMounted, ref } from "vue"
import { useNuxtApp, useRoute } from "nuxt/app"
import { useSessionStore } from "../../../stores/session"

const route = useRoute()
const { $papiClient } = useNuxtApp()
const session = useSessionStore()
const didCommRepository = new DidCommRepository(
  $papiClient as { rpc(method: string, params?: unknown[]): Promise<unknown>; getEndpoint?(): string }
)

const namespaceId = computed(() => {
  const rawId = route.params.namespaceId
  const value = Array.isArray(rawId) ? (rawId[0] ?? "") : (rawId ?? "")

  try {
    return decodeURIComponent(String(value))
  } catch {
    return String(value)
  }
})

const buckets = ref<BucketRecord[]>([])
const bucketsLoading = ref(false)
const bucketsError = ref("")
const namespaceName = ref("")

const namespaceDisplayName = computed(() => namespaceName.value || `Namespace id: ${namespaceId.value}`)
const isWalletConnected = computed(() => session.walletStatus === "connected" && Boolean(session.accountAddress))

function resolveDisplayName(bucket: BucketRecord): string {
  const name = typeof bucket.name === "string" ? bucket.name.trim() : ""
  if (name) {
    return name
  }

  return `Bucket ${bucket.id}`
}

async function loadBuckets() {
  bucketsError.value = ""
  bucketsLoading.value = true

  try {
    buckets.value = await didCommRepository.fetchBuckets(namespaceId.value)
  } catch (error) {
    bucketsError.value = error instanceof Error ? error.message : "Unable to load buckets"
  } finally {
    bucketsLoading.value = false
  }
}

function normalizeNamespaceId(value: string): string {
  return value.trim().toLowerCase()
}

async function loadNamespaceName() {
  namespaceName.value = ""

  try {
    const namespaces = await didCommRepository.fetchNamespaces()
    const matched = namespaces.find(
      (namespace) => normalizeNamespaceId(namespace.id) === normalizeNamespaceId(namespaceId.value)
    )

    namespaceName.value = matched?.name?.trim() ?? ""
  } catch {
    namespaceName.value = ""
  }
}

onMounted(async () => {
  await loadNamespaceName()
  await loadBuckets()
})
</script>

<template>
  <div class="stack">
    <section class="stack" aria-live="polite">
      <div class="row buckets-header" style="justify-content: space-between; align-items: center">
        <div class="stack" style="gap: 4px">
          <h3 style="margin: 0">{{ namespaceDisplayName }}</h3>
        </div>
        <div v-if="isWalletConnected" class="row" style="gap: 8px">
          <NuxtLink class="btn" :to="`/messages/bucket/create/${encodeURIComponent(namespaceId)}`">Add Bucket</NuxtLink>
        </div>
      </div>

      <LoadingBar v-if="bucketsLoading" label="Loading buckets..." />

      <p v-if="bucketsError" style="margin: 0; color: var(--status-error)">{{ bucketsError }}</p>
      <div v-else class="stack" style="gap: 12px">
        <p v-if="!buckets.length && !bucketsLoading" class="muted" style="margin: 0">
          No buckets found for this namespace.
        </p>

        <div v-if="buckets.length" class="stack" style="gap: 12px">
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
                <p class="muted" style="margin: 0">Bucket ID: {{ bucket.id }}</p>
              </div>
            </div>
          </NuxtLink>
        </div>
      </div>
    </section>
  </div>
</template>

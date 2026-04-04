<script setup lang="ts">
import { DidCommRepository, type BucketRecord } from "../../../services/papi/didCommRepository"
import LoadingBar from "../../../components/common/LoadingBar.vue"
import { computed, onMounted, ref } from "vue"
import { useNuxtApp, useRoute } from "nuxt/app"

const route = useRoute()
const { $papiClient } = useNuxtApp()
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

onMounted(async () => {
  await loadBuckets()
})
</script>

<template>
  <div class="stack">
    <header class="card">
      <h2 style="margin: 0">Namespace {{ namespaceId }}</h2>
      <p class="muted" style="margin: 8px 0 0">Buckets from buckets.buckets storage.</p>
    </header>

    <section class="card stack" aria-live="polite">
      <div class="row" style="justify-content: space-between; align-items: center">
        <h3 style="margin: 0">Buckets</h3>
        <div class="row" style="gap: 8px">
          <NuxtLink class="btn" :to="`/messages/namespace/${encodeURIComponent(namespaceId)}/buckets/new`">Add Bucket</NuxtLink>
          <NuxtLink class="btn" to="/messages">Back</NuxtLink>
          <button class="btn" type="button" :disabled="bucketsLoading" @click="loadBuckets">
            {{ bucketsLoading ? "Loading..." : "Reload" }}
          </button>
        </div>
      </div>

      <LoadingBar v-if="bucketsLoading" label="Loading buckets..." />

      <p v-if="bucketsError" style="margin: 0; color: var(--status-error)">{{ bucketsError }}</p>
      <p v-else-if="!buckets.length && !bucketsLoading" class="muted" style="margin: 0">
        No buckets found for this namespace.
      </p>
      <ul v-else style="margin: 0; padding-left: 18px">
        <li v-for="bucket in buckets" :key="bucket.id">
          <NuxtLink :to="`/messages/bucket/${encodeURIComponent(bucket.id)}`">
            <strong>{{ bucket.name }}</strong>
            <span class="muted"> ({{ bucket.id }})</span>
          </NuxtLink>
        </li>
      </ul>
    </section>
  </div>
</template>

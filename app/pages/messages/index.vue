<script setup lang="ts">
import { fetchIndexedNamespaces, type IndexedNamespace } from "../../services/indexer/subqueryClient"
import SkeletonCard from "../../components/common/SkeletonCard.vue"
import PageHeader from "../../components/common/PageHeader.vue"
import { useRuntimeConfig } from "nuxt/app"
import { useKeys } from "../../composables/useKeys"
import { useOperationsStore } from "../../stores/operations"
import { useSessionStore } from "../../stores/session"
import { computed, onMounted, ref } from "vue"

const config = useRuntimeConfig()
const keys = useKeys()
const operations = useOperationsStore()
const session = useSessionStore()

interface NamespaceListItem {
  id: string
  name: string
  raw: IndexedNamespace
}

const isWalletConnected = computed(() => session.walletStatus === "connected" && Boolean(session.accountAddress))
const namespaces = ref<NamespaceListItem[]>([])
const namespaceError = ref("")
const namespacesLoading = ref(true)

function resolveIndexerUrl(): string {
  const url = config.public.subqueryIndexerUrl
  if (typeof url === "string" && url.trim()) {
    return url.trim()
  }

  throw new Error("Subquery indexer URL is not configured")
}

async function loadNamespaces() {
  namespaceError.value = ""
  namespacesLoading.value = true

  try {
    const indexed = await fetchIndexedNamespaces(resolveIndexerUrl(), "CREATED_AT_ASC")
    namespaces.value = indexed.map((namespace) => ({
      id: namespace.id,
      name: namespace.name?.trim() || `Namespace ${namespace.namespaceId}`,
      raw: namespace
    }))
  } catch (error) {
    namespaceError.value = error instanceof Error ? error.message : "Unable to load namespaces"
  } finally {
    namespacesLoading.value = false
  }
}

function exportCurrentKey() {
  try {
    const exported = keys.exportKey()
    const blob = new Blob([exported], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = "x25519-key.json"
    anchor.click()
    URL.revokeObjectURL(url)
  } catch (error) {
    operations.add("key_mgmt", "export", "error", error instanceof Error ? error.message : "Key export failed")
  }
}

function importKey(payload: string) {
  try {
    keys.importKey(payload)
  } catch {
  }
}

onMounted(async () => {
  await loadNamespaces()
})
</script>

<template>
  <div class="stack">
    <section class="stack" aria-live="polite">
      <PageHeader title="Namespaces">
        <template #actions>
          <NuxtLink v-if="isWalletConnected" class="btn" to="/messages/namespaces/new">Add Namespace</NuxtLink>
          <button class="btn" type="button" :disabled="namespacesLoading" @click="loadNamespaces">
            {{ namespacesLoading ? "Loading..." : "Reload" }}
          </button>
        </template>
      </PageHeader>

      <div v-if="namespacesLoading" class="stack" style="gap: 12px">
        <SkeletonCard :count="3" :lines="2" />
      </div>

      <p v-else-if="namespaceError" style="margin: 0; color: var(--status-error)">{{ namespaceError }}</p>
      <p v-else-if="!namespaces.length" class="muted" style="margin: 0; min-height: 228px; display: flex; align-items: center; justify-content: center;">
        No namespaces found.
      </p>

      <div v-else class="stack" style="gap: 12px">
        <NuxtLink
          v-for="namespace in namespaces"
          :key="namespace.id"
          :to="`/messages/namespace/${encodeURIComponent(namespace.id)}`"
          class="card bucket-card"
          style="padding: 16px; text-decoration: none; color: inherit; display: block"
        >
          <div class="row" style="justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap">
            <div class="stack" style="gap: 6px">
              <strong style="font-size: 16px">{{ namespace.name }}</strong>
              <p class="muted" style="margin: 0">Namespace ID: {{ namespace.id }}</p>
            </div>
          </div>
        </NuxtLink>
      </div>
    </section>

    <KeyManagementPanel
      :active-key="keys.activeKey"
      @generate="keys.generate"
      @import="importKey"
      @export="exportCurrentKey"
    />
  </div>
</template>

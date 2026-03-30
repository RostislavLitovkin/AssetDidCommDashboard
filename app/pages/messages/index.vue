<script setup lang="ts">
import { DidCommRepository, type BucketNamespace } from "../../services/papi/didCommRepository"
import { onMounted, ref } from "vue"
import { useNuxtApp } from "nuxt/app"
import { useKeys } from "../../composables/useKeys"
import { useOperationsStore } from "../../stores/operations"

const { $papiClient } = useNuxtApp()
const keys = useKeys()
const operations = useOperationsStore()
const didCommRepository = new DidCommRepository(
  $papiClient as { rpc(method: string, params?: unknown[]): Promise<unknown>; getEndpoint?(): string }
)
const namespaces = ref<BucketNamespace[]>([])
const namespaceError = ref("")
const namespacesLoading = ref(false)

async function loadNamespaces() {
  namespaceError.value = ""
  namespacesLoading.value = true

  try {
    namespaces.value = await didCommRepository.fetchNamespaces()
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
    <header class="card">
      <h2 style="margin: 0">Asset DIDComm Management</h2>
      <p class="muted" style="margin: 8px 0 0">Manage key material and message-related operations.</p>
    </header>

    <section class="card stack" aria-live="polite">
      <div class="row" style="justify-content: space-between; align-items: center">
        <h3 style="margin: 0">Buckets Namespaces</h3>
        <div class="row" style="gap: 8px">
          <NuxtLink class="btn" to="/messages/namespaces/new">Add Namespace</NuxtLink>
          <button class="btn" type="button" :disabled="namespacesLoading" @click="loadNamespaces">
            {{ namespacesLoading ? "Loading..." : "Reload" }}
          </button>
        </div>
      </div>
      <LoadingBar v-if="namespacesLoading" label="Loading namespaces..." />
      <p v-if="namespaceError" style="margin: 0; color: var(--status-error)">{{ namespaceError }}</p>
      <p v-else-if="!namespaces.length && !namespacesLoading" class="muted" style="margin: 0">
        No namespaces found.
      </p>
      <ul v-else style="margin: 0; padding-left: 18px">
        <li v-for="namespace in namespaces" :key="namespace.id">
          <NuxtLink :to="`/messages/namespace/${encodeURIComponent(namespace.id)}`">
            <strong>{{ namespace.name }}</strong>
            <span class="muted"> ({{ namespace.id }})</span>
          </NuxtLink>
        </li>
      </ul>
    </section>

    <KeyManagementPanel
      :active-key="keys.activeKey"
      @generate="keys.generate"
      @import="importKey"
      @export="exportCurrentKey"
    />

    <DidOperationTimeline :entries="operations.entries" />
  </div>
</template>

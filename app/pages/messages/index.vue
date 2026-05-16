<script setup lang="ts">
import { DidCommRepository, type BucketNamespace } from "../../services/papi/didCommRepository"
import LoadingBar from "../../components/common/LoadingBar.vue"
import { useNuxtApp } from "nuxt/app"
import { useKeys } from "../../composables/useKeys"
import { useOperationsStore } from "../../stores/operations"
import { useSessionStore } from "../../stores/session"
import { computed, onMounted, ref } from "vue"

const { $papiClient } = useNuxtApp()
const keys = useKeys()
const operations = useOperationsStore()
const session = useSessionStore()
const didCommRepository = new DidCommRepository(
  $papiClient as { rpc(method: string, params?: unknown[]): Promise<unknown>; getEndpoint?(): string }
)
const isWalletConnected = computed(() => session.walletStatus === "connected" && Boolean(session.accountAddress))
const namespaces = ref<BucketNamespace[]>([])
const namespaceError = ref("")
const namespacesLoading = ref(true)

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
    <section class="stack" aria-live="polite">
      <div class="row buckets-header" style="justify-content: space-between; align-items: center">
        <h3 style="margin: 0">Namespaces</h3>
        <div class="row" style="gap: 8px">
          <NuxtLink v-if="isWalletConnected" class="btn" to="/messages/namespaces/new">Add Namespace</NuxtLink>
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

      <div v-else-if="namespaces.length" class="stack" style="gap: 12px">
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

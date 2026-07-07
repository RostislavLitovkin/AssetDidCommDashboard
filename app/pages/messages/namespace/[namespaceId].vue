<script setup lang="ts">
import { DidCommRepository, type BucketRecord } from "../../../services/papi/didCommRepository"
import LoadingBar from "../../../components/common/LoadingBar.vue"
import SkeletonCard from "../../../components/common/SkeletonCard.vue"
import WalletConnectPrompt from "../../../components/common/WalletConnectPrompt.vue"
import { Trash2, UserPlus, Users } from "lucide-vue-next"
import { useAddress } from "../../../composables/useAddress"
import { computed, onMounted, ref } from "vue"
import { useNuxtApp, useRoute } from "nuxt/app"
import { useSessionStore } from "../../../stores/session"

const route = useRoute()
const { $papiClient } = useNuxtApp()
const config = useRuntimeConfig()
const session = useSessionStore()
const asOptionalString = (value: unknown): string | undefined => {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}
const { formatAddress, addressesEqual } = useAddress()
const didCommRepository = new DidCommRepository(
  $papiClient as { rpc(method: string, params?: unknown[]): Promise<unknown>; getEndpoint?(): string },
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  {
    jwt: asOptionalString(config.public.pinataJwt),
    apiKey: asOptionalString(config.public.pinataApiKey),
    apiSecret: asOptionalString(config.public.pinataApiSecret),
    publicGateway: asOptionalString(config.public.pinataGateway)
  },
  undefined,
  undefined,
  undefined,
  String(config.public.subqueryIndexerUrl || "")
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
const bucketsLoading = ref(true)
const bucketsError = ref("")
const namespaceName = ref("")
const managers = ref<string[]>([])
const managersLoading = ref(true)
const managersError = ref("")
const removingManagerAddress = ref("")

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

async function loadManagers() {
  managersError.value = ""
  managersLoading.value = true

  try {
    managers.value = await didCommRepository.fetchNamespaceManagers(namespaceId.value)
  } catch (error) {
    managersError.value = error instanceof Error ? error.message : "Unable to load managers"
  } finally {
    managersLoading.value = false
  }
}

async function removeManager(address: string) {
  managersError.value = ""
  if (!session.accountAddress) {
    managersError.value = "Connect wallet before removing managers"
    return
  }

  removingManagerAddress.value = address
  try {
    await didCommRepository.removeNamespaceManager(
      namespaceId.value,
      address,
      session.accountAddress
    )
    await loadManagers()
  } catch (error) {
    managersError.value = error instanceof Error ? error.message : "Unable to remove manager"
  } finally {
    removingManagerAddress.value = ""
  }
}

onMounted(async () => {
  await loadNamespaceName()
  await loadBuckets()
  await loadManagers()
})
</script>

<template>
  <div class="stack">
    <section class="stack" aria-live="polite">
      <div class="row buckets-header" style="justify-content: space-between; align-items: center">
        <div class="stack" style="gap: 4px">
          <h3 style="margin: 0">{{ namespaceDisplayName }}</h3>
        </div>
        <div class="row" style="gap: 8px">
          <NuxtLink class="btn" :to="`/messages/namespace/managers/${encodeURIComponent(namespaceId)}`">Add
            Manager</NuxtLink>
          <NuxtLink class="btn" :to="`/messages/bucket/create/${encodeURIComponent(namespaceId)}`">Add Bucket</NuxtLink>
        </div>
      </div>

      <SkeletonCard v-if="bucketsLoading" :count="3" :lines="2" />

      <p v-if="bucketsError" style="margin: 0; color: var(--status-error)">{{ bucketsError }}</p>
      <div v-else class="stack" style="gap: 12px">
        <p v-if="!buckets.length && !bucketsLoading" class="muted" style="margin: 0">
          No buckets found for this namespace.
        </p>

        <div v-if="buckets.length" class="stack" style="gap: 12px">
          <NuxtLink v-for="bucket in buckets" :key="bucket.id" :to="`/indexed-bucket/${encodeURIComponent(bucket.id)}`"
            class="card bucket-card" style="padding: 16px; text-decoration: none; color: inherit; display: block">
            <div class="row"
              style="justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap">
              <div class="stack" style="gap: 6px">
                <strong style="font-size: 16px">{{ resolveDisplayName(bucket) }}</strong>
                <p class="muted" style="margin: 0">Bucket ID: {{ bucket.id }}</p>
              </div>
            </div>
          </NuxtLink>
        </div>
      </div>
    </section>

    <div class="card stack" style="gap: 16px; margin-top: 24px;">
      <div class="row" style="justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
        <h4 style="margin: 0; font-size: 16px;">Managers</h4>
        <NuxtLink v-if="isWalletConnected" class="btn"
          :to="`/messages/namespace/managers/${encodeURIComponent(namespaceId)}`">
          Add Manager
        </NuxtLink>
      </div>

      <SkeletonCard v-if="managersLoading" :count="3" :lines="1" />
      <p v-if="managersError" style="margin: 0; color: var(--status-error)">{{ managersError }}</p>

      <ul v-if="managers.length && !managersLoading" class="bucket-members-list"
        style="display: flex; flex-direction: column; gap: 8px; list-style: none; padding: 0; margin: 0;">
        <li v-for="address in managers" :key="address" class="bucket-member-item card"
          style="padding: 12px 16px; background: #f6f7f9; margin: 0; border: 1px solid var(--border-default);">
          <div class="row"
            style="justify-content: space-between; align-items: center; width: 100%; flex-wrap: wrap; gap: 12px;">
            <div class="stack" style="gap: 4px;">
              <div class="row" style="align-items: center; gap: 8px;">
                <strong style="font-size: 14px;">{{ formatAddress(address) }}</strong>
                <span
                  style="padding: 4px 8px; border-radius: 999px; font-size: 11px; color: white; font-weight: 600; text-transform: capitalize; background: var(--color-primary);">
                  Manager
                </span>
              </div>
            </div>

            <div class="row" style="gap: 8px;">
              <button class="btn member-remove-btn" type="button" title="Remove Manager"
                :disabled="Boolean(removingManagerAddress) || !session.accountAddress"
                @click="removeManager(address)" style="background: var(--color-white);">
                <Trash2 v-if="removingManagerAddress !== address" :size="16" aria-hidden="true" />
                <span v-else class="spinner-small"></span>
                <span>{{ removingManagerAddress === address ? "Removing..." : "Remove Manager" }}</span>
              </button>
            </div>
          </div>
        </li>
      </ul>
      <p v-else-if="!managersLoading && !managersError" class="muted" style="margin: 0">
        No managers found for this namespace.
      </p>
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

.bucket-card-item:hover {
  border-color: var(--color-primary) !important;
}

.bucket-members-list {
  margin: 0;
  padding-left: 0;
  list-style: none;
  display: grid;
  gap: 4px;
}

.bucket-member-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--border-default);
  border-radius: 8px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.7);
}

.member-remove-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--status-error);
  border-color: color-mix(in srgb, var(--status-error) 50%, var(--border-default));
}

.spinner-small {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(0, 0, 0, 0.1);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>

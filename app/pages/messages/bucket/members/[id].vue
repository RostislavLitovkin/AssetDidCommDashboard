<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue"
import { useNuxtApp, useRoute } from "nuxt/app"
import { DidCommRepository, type ExtrinsicUpdate } from "../../../../services/papi/didCommRepository"
import { useOperationsStore } from "../../../../stores/operations"
import { useSessionStore } from "../../../../stores/session"

const route = useRoute()
const { $papiClient } = useNuxtApp()
const session = useSessionStore()
const operations = useOperationsStore()
const didCommRepository = new DidCommRepository(
  $papiClient as { rpc(method: string, params?: unknown[]): Promise<unknown>; getEndpoint?(): string }
)

type MemberRole = "admin" | "contributor"

function toMemberRole(value: unknown): MemberRole {
  const candidate = Array.isArray(value) ? value[0] : value
  return candidate === "contributor" ? "contributor" : "admin"
}

const bucketId = computed(() => {
  const rawId = route.params.id
  const value = Array.isArray(rawId) ? (rawId[0] ?? "") : (rawId ?? "")

  try {
    return decodeURIComponent(String(value))
  } catch {
    return String(value)
  }
})

const bucketRoutePath = computed(() => `/messages/bucket/${encodeURIComponent(bucketId.value)}`)

const role = ref<MemberRole>(toMemberRole(route.query.role))
const namespaceId = ref("")
const memberAddress = ref("")
const submitting = ref(false)
const submitError = ref("")
const submittedTxHash = ref("")
const submittedMethod = ref("")

function extractRouteNamespaceId(): string {
  const raw = route.query.namespaceId
  const value = Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "")

  try {
    return decodeURIComponent(String(value)).trim()
  } catch {
    return String(value).trim()
  }
}

async function loadNamespaceFromBucket(): Promise<void> {
  if (namespaceId.value) {
    return
  }

  try {
    const bucket = await didCommRepository.fetchBucket(bucketId.value)
    namespaceId.value = bucket?.namespaceId?.trim() ?? ""
  } catch {
  }
}

watch(
  () => route.query.role,
  (value) => {
    role.value = toMemberRole(value)
  }
)

watch(
  () => route.query.namespaceId,
  () => {
    namespaceId.value = extractRouteNamespaceId()
  }
)

onMounted(async () => {
  namespaceId.value = extractRouteNamespaceId()
  await loadNamespaceFromBucket()
})

function logExtrinsicUpdate(update: ExtrinsicUpdate): void {
  const details = [update.message]
  if (update.txHash) {
    details.push(`tx: ${update.txHash}`)
  }
  if (update.blockHash) {
    details.push(`block: ${update.blockHash}`)
  }

  operations.add("did_write", `bucket-member:${update.stage}`, update.stage === "error" ? "error" : "info", details.join(" · "))
}

async function submitAddMember(): Promise<void> {
  submitError.value = ""
  submittedTxHash.value = ""
  submittedMethod.value = ""

  if (!bucketId.value.trim()) {
    submitError.value = "Bucket id is required"
    return
  }

  if (!namespaceId.value.trim()) {
    submitError.value = "Namespace id is required"
    return
  }

  if (!memberAddress.value.trim()) {
    submitError.value = "Member address is required"
    return
  }

  if (!session.accountAddress) {
    submitError.value = "Connect wallet before submitting bucket member extrinsics"
    return
  }

  submitting.value = true

  try {
    const result =
      role.value === "admin"
        ? await didCommRepository.addBucketAdmin(
            namespaceId.value,
            bucketId.value,
            memberAddress.value,
            session.accountAddress,
            logExtrinsicUpdate
          )
        : await didCommRepository.addBucketContributor(
            namespaceId.value,
            bucketId.value,
            memberAddress.value,
            session.accountAddress,
            logExtrinsicUpdate
          )

    submittedTxHash.value = result.txHash
    submittedMethod.value = result.method
    operations.add("did_write", bucketId.value, "success", `Member extrinsic submitted: ${result.txHash}`)
    memberAddress.value = ""
  } catch (error) {
    submitError.value = error instanceof Error ? error.message : "Unable to submit bucket member extrinsic"
    operations.add("did_write", `bucket:${bucketId.value}`, "error", submitError.value)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="stack">
    <header class="card">
      <h2 style="margin: 0">Manage Bucket Members</h2>
      <p class="muted" style="margin: 8px 0 0">Add an admin or contributor to bucket {{ bucketId }}.</p>
    </header>

    <section class="card stack" aria-live="polite">
      <label class="stack" style="gap: 6px">
        <span>Namespace</span>
        <input
          v-model="namespaceId"
          class="input"
          type="text"
          name="namespace-id"
          placeholder="e.g. 0"
          :disabled="submitting"
        />
      </label>

      <label class="stack" style="gap: 6px">
        <span>Bucket</span>
        <input class="input" type="text" :value="bucketId" disabled />
      </label>

      <label class="stack" style="gap: 6px">
        <span>Role</span>
        <select v-model="role" class="input" name="member-role" :disabled="submitting">
          <option value="admin">Admin</option>
          <option value="contributor">Contributor</option>
        </select>
      </label>

      <label class="stack" style="gap: 6px">
        <span>Address</span>
        <input
          v-model="memberAddress"
          class="input"
          type="text"
          name="member-address"
          placeholder="e.g. 5F3sa2TJ..."
          :disabled="submitting"
        />
      </label>

      <div class="row" style="justify-content: flex-end; gap: 8px">
        <NuxtLink class="btn" :to="bucketRoutePath">Cancel</NuxtLink>
        <button class="btn" type="button" :disabled="submitting" @click="submitAddMember">
          {{ submitting ? "Submitting..." : "Submit Extrinsic" }}
        </button>
      </div>

      <p v-if="!session.accountAddress" class="muted" style="margin: 0">
        Connect wallet on the dashboard first to sign and submit this extrinsic.
      </p>

      <p v-if="submitError" style="margin: 0; color: var(--status-error)">{{ submitError }}</p>
      <p v-if="submittedTxHash" style="margin: 0; color: var(--status-success)">
        Submitted via {{ submittedMethod }} with hash {{ submittedTxHash }}
      </p>
    </section>
  </div>
</template>

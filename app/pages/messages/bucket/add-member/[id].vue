<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { useRoute } from "nuxt/app"
import type { BucketMemberRole, OperationUpdate } from "../../../../services/buckets/types"
import { rolesGrantedBy, rolesHeld } from "../../../../services/buckets/membership"
import { ProfileClient } from "../../../../services/profile/profileClient"
import { resolveProfileByAddressOrNickname, type ProfileLookupKind } from "../../../../services/profile/profileLookup"
import { normalizeApiAddress } from "../../../../services/wallet/addressUtils"
import type { Profile } from "../../../../types/profile"
import { useOperationsStore } from "../../../../stores/operations"
import { useSessionStore } from "../../../../stores/session"
import WalletConnectPrompt from "../../../../components/common/WalletConnectPrompt.vue"
import PageHeader from "../../../../components/common/PageHeader.vue"
import SubmitButton from "../../../../components/common/SubmitButton.vue"
import type { SubmitButtonLabels } from "../../../../components/common/submitButtonView"
import { useAddress } from "../../../../composables/useAddress"
import { useProfileStatus } from "../../../../composables/useProfileStatus"
import { useSubmitState } from "../../../../composables/useSubmitState"

const route = useRoute()
const runtimeConfig = useRuntimeConfig()
const session = useSessionStore()

const operations = useOperationsStore()
const profileClient = new ProfileClient(String(runtimeConfig.public.profileApiUrl))
const bucketsRepository = useBucketsRepository()
const { formatAddress, addressesEqual } = useAddress()
// The connected wallet's own profile, from the shared store the app shell already
// fills — needed for its X25519 key, which is how viewer membership is matched.
const ownProfile = useProfileStatus()

const roleOptions: { value: BucketMemberRole; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "contributor", label: "Contributor" },
  { value: "viewer", label: "Viewer" }
]

const bucketId = computed(() => {
  const rawParam = route.params.id
  const rawQuery = route.query.bucketId
  const raw = Array.isArray(rawParam) ? (rawParam[0] ?? "") : (rawParam ?? rawQuery ?? "")

  try {
    return decodeURIComponent(String(raw)).trim()
  } catch {
    return String(raw).trim()
  }
})

const role = ref<BucketMemberRole>("admin")
const namespaceId = ref("")
// Standalone buckets have no namespace — members are added with a null
// namespace id, so an empty namespace field must not block the submit.
const isStandalone = ref(false)
const memberAddress = ref("")
const {
  phase: submitPhase,
  errorMessage: submitError,
  isBusy: submitting,
  applyUpdate: applySubmitUpdate,
  fail: failSubmit,
  reset: resetSubmit,
  run: runSubmit
} = useSubmitState()

type ProfileStatus = "idle" | "loading" | "found" | "notFound" | "noKey" | "error"
const profile = ref<Profile | null>(null)
const profileStatus = ref<ProfileStatus>("idle")
const profileError = ref("")
const lookupKind = ref<ProfileLookupKind>("address")

const bucketAdmins = ref<string[]>([])
const bucketContributors = ref<string[]>([])
const bucketViewers = ref<string[]>([])
// "Settled" rather than "loaded": a failed query still answers the question of
// whether we may draw the self-add button (we fail open and draw it).
const membersSettled = ref(false)
const membersFailed = ref(false)

let lookupTimer: ReturnType<typeof setTimeout> | null = null
let lastQueriedValue = ""

const submitLabels: SubmitButtonLabels = {
  idle: "Add member",
  signing: "Signing…",
  submitting: "Adding member…",
  success: "Member added",
  error: "Add failed — retry"
}

const memberLists = computed(() => ({
  admins: bucketAdmins.value,
  contributors: bucketContributors.value,
  viewers: bucketViewers.value
}))

/** The address actually submitted — always the profile's, never raw input. */
const resolvedAddress = computed(() =>
  profile.value ? normalizeApiAddress(profile.value.ss58Address) : ""
)

const grantedRoles = computed(() => rolesGrantedBy(role.value))

const enteredMemberRoles = computed(() =>
  resolvedAddress.value
    ? rolesHeld({ address: resolvedAddress.value, x25519Key: profile.value?.x25519Key }, memberLists.value)
    : []
)

const missingRoles = computed(() =>
  grantedRoles.value.filter((granted) => !enteredMemberRoles.value.includes(granted))
)

const alreadyHasAllRoles = computed(() =>
  Boolean(resolvedAddress.value) && missingRoles.value.length === 0
)

const selfIsMember = computed(() => {
  const address = session.accountAddress
  if (!address) {
    return false
  }

  return rolesHeld({ address, x25519Key: ownProfile.profile.value?.x25519Key }, memberLists.value).length > 0
})

/**
 * The inline "Add me" affordance. Hidden once we know the connected wallet is
 * already a member; shown when the member query failed, since losing a useful
 * shortcut to a failed request is worse than offering a redundant one.
 */
const canUseSelfAdd = computed(() => {
  const address = session.accountAddress
  if (!address || submitting.value || !membersSettled.value) {
    return false
  }

  if (!membersFailed.value && selfIsMember.value) {
    return false
  }

  const entered = memberAddress.value.trim()
  return !entered || !addressesEqual(entered, address)
})

const canSubmit = computed(() =>
  Boolean(memberAddress.value.trim()) &&
  (Boolean(namespaceId.value.trim()) || isStandalone.value) &&
  profileStatus.value === "found" &&
  Boolean(profile.value?.x25519Key) &&
  !alreadyHasAllRoles.value
)

function roleLabel(value: BucketMemberRole): string {
  return roleOptions.find((option) => option.value === value)?.label ?? value
}

function formatRoleList(roles: BucketMemberRole[]): string {
  const labels = roles.map((entry) => roleLabel(entry).toLowerCase())
  if (labels.length <= 1) {
    return labels[0] ?? ""
  }

  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`
}

function withArticle(roles: BucketMemberRole[]): string {
  const article = roles[0] === "admin" ? "an" : "a"
  return `${article} ${formatRoleList(roles)}`
}

const alreadyMemberMessage = computed(() =>
  `Already ${withArticle(enteredMemberRoles.value)} of this bucket.`
)

const promotionMessage = computed(() =>
  `Already ${withArticle(enteredMemberRoles.value)} — adding as ${roleLabel(role.value)} grants ${formatRoleList(missingRoles.value)}.`
)

/** Short form of a resolved address, for confirming what a nickname pointed at. */
const shortResolvedAddress = computed(() => {
  const formatted = formatAddress(resolvedAddress.value)
  return formatted.length > 14 ? `${formatted.slice(0, 6)}…${formatted.slice(-4)}` : formatted
})

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
    const bucket = await bucketsRepository.fetchBucket(bucketId.value)
    if (!bucket) {
      return
    }
    namespaceId.value = bucket.namespaceId?.trim() ?? ""
    isStandalone.value = bucket.namespaceId == null
  } catch {
  }
}

async function loadBucketMembers(): Promise<void> {
  const bucket = bucketId.value
  if (!bucket) {
    membersSettled.value = true
    membersFailed.value = true
    return
  }

  try {
    const [admins, contributors, viewers] = await Promise.all([
      bucketsRepository.fetchBucketAdmins(bucket),
      bucketsRepository.fetchBucketContributors(bucket),
      bucketsRepository.fetchBucketViewers(bucket)
    ])
    bucketAdmins.value = admins
    bucketContributors.value = contributors
    bucketViewers.value = viewers
    membersFailed.value = false
  } catch {
    bucketAdmins.value = []
    bucketContributors.value = []
    bucketViewers.value = []
    membersFailed.value = true
  } finally {
    membersSettled.value = true
  }
}

async function lookupProfile(): Promise<void> {
  const entered = memberAddress.value.trim()
  if (!entered) {
    profileStatus.value = "idle"
    profile.value = null
    profileError.value = ""
    return
  }

  lastQueriedValue = entered
  profileStatus.value = "loading"
  profile.value = null
  profileError.value = ""

  try {
    // Address-like input resolves by address; anything else is treated as a nickname.
    const result = await resolveProfileByAddressOrNickname(profileClient, entered)

    // Ignore results for a stale query if the entry changed while loading.
    if (memberAddress.value.trim() !== entered) {
      return
    }

    lookupKind.value = result.kind
    if (!result.profile) {
      profileStatus.value = "notFound"
      return
    }

    profile.value = result.profile
    profileStatus.value = result.profile.x25519Key ? "found" : "noKey"
  } catch (error) {
    if (memberAddress.value.trim() !== entered) {
      return
    }
    profileStatus.value = "error"
    profileError.value = error instanceof Error ? error.message : "Unable to load profile"
  }
}

function scheduleLookup(): void {
  if (lookupTimer) {
    clearTimeout(lookupTimer)
  }
  if (!memberAddress.value.trim()) {
    return
  }
  lookupTimer = setTimeout(() => {
    void lookupProfile()
  }, 400)
}

function lookupProfileNow(): void {
  if (lookupTimer) {
    clearTimeout(lookupTimer)
    lookupTimer = null
  }
  const entered = memberAddress.value.trim()
  if (!entered) {
    return
  }
  // Avoid a redundant request if this entry is already resolved.
  if (entered === lastQueriedValue && profileStatus.value !== "idle" && profileStatus.value !== "loading") {
    return
  }
  void lookupProfile()
}

/** Fills the entry with the connected wallet's address; it never submits. */
function fillOwnAddress(): void {
  const address = session.accountAddress
  if (!address) {
    return
  }

  memberAddress.value = formatAddress(address)
  // After the memberAddress watcher has run, so its debounce reset does not
  // discard the immediate lookup this triggers.
  void nextTick(lookupProfileNow)
}

watch(
  () => route.query.namespaceId,
  () => {
    namespaceId.value = extractRouteNamespaceId()
  }
)

watch(memberAddress, () => {
  resetSubmit()
  profile.value = null
  profileError.value = ""
  profileStatus.value = "idle"
  scheduleLookup()
})

watch(namespaceId, resetSubmit)
watch(role, resetSubmit)

watch(
  () => session.accountAddress,
  () => {
    void ownProfile.refresh()
  }
)

onMounted(async () => {
  namespaceId.value = extractRouteNamespaceId()
  await Promise.all([loadNamespaceFromBucket(), loadBucketMembers(), ownProfile.refresh()])
})

onBeforeUnmount(() => {
  if (lookupTimer) {
    clearTimeout(lookupTimer)
  }
})

// Drives the button only. The page logs one terminal entry per submit below —
// see the "Loggers drive phases; pages log outcomes" global constraint.
function logOperationUpdate(update: OperationUpdate): void {
  applySubmitUpdate(update)
}

async function submitAddMember(): Promise<void> {
  const bucket = bucketId.value.trim()
  if (!bucket) {
    failSubmit("Bucket id is required")
    return
  }

  const namespace = namespaceId.value.trim()
  if (!namespace && !isStandalone.value) {
    failSubmit("Namespace id is required")
    return
  }

  if (!memberAddress.value.trim()) {
    failSubmit("Member address or nickname is required")
    return
  }

  const address = session.accountAddress
  if (!address) {
    failSubmit("Connect wallet before adding bucket members")
    return
  }

  // The resolved profile address, never the raw entry — a nickname must never
  // reach the chain as a subject.
  const member = resolvedAddress.value
  const x25519Key = profile.value?.x25519Key
  if (profileStatus.value !== "found" || !member || !x25519Key) {
    failSubmit("A profile with an X25519 key is required for this address")
    return
  }

  if (alreadyHasAllRoles.value) {
    failSubmit(alreadyMemberMessage.value)
    return
  }

  await runSubmit(async () => {
    const result = await bucketsRepository.addBucketMemberWithRole(
      role.value,
      namespace || null,
      bucket,
      member,
      x25519Key,
      address,
      logOperationUpdate
    )
    operations.add("bucket_write", "Add member", "success", `Member added: ${result.id}`)
  })

  if (submitPhase.value === "error") {
    operations.add("bucket_write", "Add member", "error", submitError.value)
    return
  }

  // Keep the membership state honest: self-adding must retire the "Add me"
  // button, and re-adding the same member must be blocked from here on.
  await loadBucketMembers()
}
</script>

<template>
  <div class="chat-custom-page">
    <div class="info-content-scroll stack">
    <section class="stack" aria-live="polite">
      <PageHeader title="Add Member" />

      <WalletConnectPrompt
        v-if="!session.accountAddress"
        title="Connect Wallet to Manage Members"
        description="You must connect your wallet to manage bucket members."
      />

      <div v-else class="card stack" style="gap: 16px;">
        <label class="stack" style="gap: 8px">
          <span style="font-weight: 600; font-size: 14px;">Member Address or Nickname</span>
          <div class="member-input-wrap">
            <input
              v-model="memberAddress"
              class="input"
              :class="{ 'member-input-with-action': canUseSelfAdd }"
              type="text"
              name="member-address"
              placeholder="SS58 address or nickname"
              :disabled="submitting"
              @blur="lookupProfileNow"
            />
            <button
              v-if="canUseSelfAdd"
              type="button"
              class="self-add-btn"
              title="Fill in your own address"
              @mousedown.prevent
              @click="fillOwnAddress"
            >
              Add self
            </button>
          </div>
          <span v-if="profileStatus === 'loading'" class="muted" style="font-size: 12px;">Looking up profile…</span>
          <span v-else-if="profileStatus === 'found'" style="font-size: 12px; color: var(--status-success, #1a7f37);">
            ✓ Profile found<template v-if="profile?.nickname"> — {{ profile.nickname }}</template><template v-if="lookupKind === 'nickname'"> · {{ shortResolvedAddress }}</template>
          </span>
          <span v-else-if="profileStatus === 'notFound' && lookupKind === 'nickname'" style="font-size: 12px; color: var(--status-error);">
            No profile found with the nickname “{{ memberAddress.trim() }}”.
          </span>
          <span v-else-if="profileStatus === 'notFound'" style="font-size: 12px; color: var(--status-error);">
            No profile exists for this address, so it cannot be added.
          </span>
          <span v-else-if="profileStatus === 'noKey'" style="font-size: 12px; color: var(--status-error);">
            This profile has no X25519 encryption key and cannot be added.
          </span>
          <span v-else-if="profileStatus === 'error'" style="font-size: 12px; color: var(--status-error);">
            {{ profileError || "Unable to load profile." }}
          </span>

          <span v-if="alreadyHasAllRoles" style="font-size: 12px; color: var(--status-error);">
            {{ alreadyMemberMessage }}
          </span>
          <span v-else-if="enteredMemberRoles.length" class="muted" style="font-size: 12px;">
            {{ promotionMessage }}
          </span>
        </label>

        <div class="stack" style="gap: 8px">
          <span style="font-weight: 600; font-size: 14px;">Role</span>
          <div style="display: flex; background: #f6f7f9; border-radius: 8px; border: 1px solid var(--border-default); overflow: hidden; padding: 4px; gap: 4px;">
            <button
              v-for="option in roleOptions"
              :key="option.value"
              type="button"
              style="flex: 1; padding: 10px 16px; border: none; background: transparent; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s; border-radius: 6px;"
              :style="role === option.value ? 'background: var(--color-white); box-shadow: 0 1px 3px rgba(0,0,0,0.1); color: var(--color-primary);' : 'color: var(--text-secondary);'"
              :disabled="submitting"
              @click="role = option.value"
            >
              {{ option.label }}
            </button>
          </div>
        </div>

        <p v-if="submitError" style="margin: 0; color: var(--status-error); font-size: 13px;">{{ submitError }}</p>

        <div class="row" style="justify-content: flex-end; gap: 12px; margin-top: 8px;">
          <SubmitButton
            :phase="submitPhase"
            :labels="submitLabels"
            :disabled="!canSubmit"
            @click="submitAddMember"
          />
        </div>
      </div>
    </section>
    </div>
  </div>
</template>

<style scoped>
.member-input-wrap {
  position: relative;
  display: block;
}

/* Reserve room so a long address never runs under the button. */
.member-input-with-action {
  padding-right: 78px;
}

.self-add-btn {
  position: absolute;
  top: 50%;
  right: 6px;
  transform: translateY(-50%);
  border: 1px solid var(--border-default);
  border-radius: 6px;
  background: var(--color-white);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  padding: 6px 10px;
  cursor: pointer;
  transition: color 160ms ease, border-color 160ms ease, box-shadow 160ms ease;
}

.self-add-btn:hover,
.self-add-btn:focus-visible {
  color: var(--color-primary);
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary) 20%, transparent);
  outline: none;
}
</style>

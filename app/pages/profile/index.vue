<script setup lang="ts">
import { Pencil, Plus, UserRound } from "lucide-vue-next"
import { computed, onMounted, ref, watch } from "vue"
import { useAddress } from "../../composables/useAddress"
import { useWallet } from "../../composables/useWallet"
import { ProfileClient } from "../../services/profile/profileClient"
import type { Profile } from "../../types/profile"

const wallet = useWallet()
const { formatAddress } = useAddress()
const runtimeConfig = useRuntimeConfig()
const profileClient = new ProfileClient(String(runtimeConfig.public.profileApiUrl))
const profile = ref<Profile | null>(null)
// Starts true so a restored session paints the skeleton on the first render
// instead of flashing the "no profile yet" state until onMounted fires.
const loading = ref(true)
const error = ref("")
const hasConnectedWallet = computed(() => Boolean(wallet.accountAddress.value))

// The skeleton mirrors the three detail rows a fully populated profile renders.
// Rows only exceed their 58px min-height when a long value wraps, so any row whose
// final text length is already known is sized with that text (rendered transparent)
// rather than a proportional bar — it then wraps exactly like the loaded value at
// every viewport width. `valueWidth` is the fallback when no text is available.
type SkeletonDetailRow = { label: string; valueText: string; valueWidth: string }

const skeletonDetailRows = computed<SkeletonDetailRow[]>(() => [
  // Nicknames are free-form but short enough to always sit on one line.
  { label: "Nickname", valueText: "", valueWidth: "38%" },
  // The profile being fetched belongs to the connected wallet, so this row's
  // final value is already known before the response arrives.
  { label: "Wallet address", valueText: formatAddress(wallet.accountAddress.value), valueWidth: "64%" },
  // A 32-byte X25519 key is always 43 base64url characters; this sample is never
  // shown (it renders transparent) and exists only to size the placeholder.
  { label: "X25519 key", valueText: "kQ8fVz2Rm7pYtLc4XwEjN1oBsHdG9uAiTvZ0nKrMbCe", valueWidth: "86%" }
])

async function loadProfile(): Promise<void> {
  const address = wallet.accountAddress.value
  profile.value = null
  error.value = ""

  if (!address) {
    loading.value = false
    return
  }

  loading.value = true
  try {
    profile.value = await profileClient.getProfile(address)
  } catch (loadError) {
    error.value = loadError instanceof Error ? loadError.message : "Unable to load your profile"
  } finally {
    loading.value = false
  }
}

watch(() => wallet.accountAddress.value, loadProfile)
onMounted(loadProfile)
</script>

<template>
  <main class="profile-page stack">
    <section v-if="!hasConnectedWallet" class="card profile-empty stack">
      <UserRound :size="28" aria-hidden="true" />
      <div class="stack" style="gap: 4px">
        <h4>Connect a wallet to view your profile</h4>
        <p class="muted">Profiles are linked to your connected SS58 wallet address.</p>
      </div>
    </section>

    <!-- Skeleton reuses the loaded card's layout classes (.profile-cover, .profile-identity,
         .profile-details …) so its geometry cannot drift from the real card at any width. -->
    <section v-else-if="loading" class="profile-card" aria-busy="true">
      <span class="sr-only" aria-live="polite">Loading profile</span>
      <div class="profile-cover skeleton-block" aria-hidden="true" />
      <div class="profile-content stack" aria-hidden="true">
        <div class="profile-identity">
          <div class="profile-avatar skeleton-avatar">
            <span class="skeleton-avatar-fill skeleton-block" />
          </div>
          <div class="profile-title stack" style="gap: 4px">
            <div class="profile-name-row" />
          </div>
          <!-- Real icon and label, rendered transparent: reserves the button's true box -->
          <span class="profile-action profile-edit skeleton-button skeleton-block">
            <Pencil :size="16" />
            Edit profile
          </span>
        </div>

        <div class="profile-bio skeleton-bio">
          <span class="skeleton-bio-line skeleton-block" style="width: 94%" />
          <span class="skeleton-bio-line skeleton-block" style="width: 71%" />
        </div>

        <dl class="profile-details">
          <div v-for="row in skeletonDetailRows" :key="`skeleton-${row.label}`">
            <dt><span class="skeleton-label skeleton-block">{{ row.label }}</span></dt>
            <dd>
              <span v-if="row.valueText" class="skeleton-text skeleton-block">{{ row.valueText }}</span>
              <span v-else class="skeleton-value skeleton-block" :style="{ width: row.valueWidth }" />
            </dd>
          </div>
        </dl>
      </div>
    </section>

    <section v-else-if="error" class="card profile-empty stack" aria-live="polite">
      <h4>Unable to load profile</h4>
      <p class="profile-error">{{ error }}</p>
      <button class="btn" type="button" @click="loadProfile">Try again</button>
    </section>

    <section v-else-if="!profile" class="card profile-empty stack">
      <UserRound :size="32" aria-hidden="true" />
      <div class="stack" style="gap: 4px">
        <h4>You have not created a profile yet</h4>
        <p class="muted">Create a public profile associated with your connected wallet.</p>
      </div>
      <NuxtLink class="btn btn-primary profile-action" to="/profile/edit">
        <Plus :size="16" />
        Create profile
      </NuxtLink>
    </section>

    <section v-else class="profile-card">
      <img class="profile-cover" src="@/assets/Images/xcavatelandscape.png" alt="" aria-hidden="true" />
      <div class="profile-content stack">
        <div class="profile-identity">
          <img v-if="profile.profilePicture" class="profile-avatar" :src="profile.profilePicture" alt="Profile picture" />
          <img v-else class="profile-avatar" src="@/assets/Images/xcavateprofilepicture.png" alt="Profile picture" />
          <div class="profile-title stack" style="gap: 4px">
            <div class="profile-name-row">
            </div>
          </div>
          <NuxtLink class="btn btn-primary profile-action profile-edit" to="/profile/edit">
            <Pencil :size="16" />
            Edit profile
          </NuxtLink>
        </div>

        <p v-if="profile.bio" class="profile-bio">{{ profile.bio }}</p>
        <p v-else class="muted profile-bio">No biography added.</p>

        <dl class="profile-details">
          <div>
            <dt>Nickname</dt>
            <dd>{{ profile.nickname || "Not set" }}</dd>
          </div>
          <div>
            <dt>Wallet address</dt>
            <dd>{{ formatAddress(profile.ss58Address) }}</dd>
          </div>
          <div v-if="profile.x25519Key">
            <dt>X25519 key</dt>
            <dd>{{ profile.x25519Key }}</dd>
          </div>
        </dl>
      </div>
    </section>
  </main>
</template>

<style>
/* Full-bleed cover: uncap the shell container while the profile page is shown; the
   cover itself escapes the shell's padding via negative margins (see .profile-cover) */
.app-shell-content:has(.profile-page) .container { width: 100%; max-width: none; margin: 0; padding: 0; }
</style>

<style scoped>
.profile-empty h4, .profile-empty p, .profile-card h4 { margin: 0; }
.profile-action { display: inline-flex; align-items: center; gap: 8px; white-space: nowrap; }
.profile-empty { align-items: flex-start; padding: 28px; width: min(1100px, 100%); margin: 0 auto; }
.profile-error { margin: 0; color: var(--status-error); }
/* Escapes the app shell's content padding (24px desktop / 16px mobile) — cover only */
.profile-cover { display: block; width: calc(100% + 48px); margin: -24px -24px 0; aspect-ratio: 3 / 1; object-fit: cover; border-bottom: 1px solid var(--border-default); }
.profile-content { gap: 20px; padding: 0 24px 20px; width: min(1100px, 100%); margin: 0 auto; }
.profile-identity { display: flex; align-items: flex-end; gap: 16px; min-width: 0; margin-top: -48px; }
.profile-avatar { width: 104px; height: 104px; border-radius: 50%; object-fit: cover; flex: 0 0 104px; border: 5px solid var(--surface-bg); background: var(--surface-bg); }
.profile-title { min-width: 0; padding-bottom: 8px; }
.profile-edit { margin-top: 50px; margin-left: auto; margin-bottom: 8px; }
.profile-name-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.profile-name-row h4 { font-size: 24px; line-height: 1.1; }
.profile-badge { padding: 4px 10px; border-radius: 999px; background: color-mix(in srgb, var(--color-primary) 12%, var(--color-white)); color: var(--color-primary); font-size: 12px; font-weight: 600; }
.profile-address, .profile-details dd { overflow-wrap: anywhere; }
.profile-bio { margin: 0; white-space: pre-wrap; line-height: 1.55; }
.profile-details { display: grid; gap: 12px; margin: 0; }
.profile-details div { display: grid; grid-template-columns: minmax(140px, 0.45fr) minmax(0, 1fr); gap: 18px; align-items: center; min-height: 58px; padding: 12px 16px; border: 1px solid var(--border-default); border-radius: 8px; }
.profile-details dt { color: var(--text-secondary); font-size: 14px; font-weight: 600; }
.profile-details dd { margin: 0; font-size: 14px; font-weight: 600; }
/* --- Loading skeleton ----------------------------------------------------
   Surface treatment only. Every box above is positioned by the loaded card's
   own rules, so both states share one source of truth for geometry (including
   the media queries below). The shimmer fill comes from .skeleton-block. */
/* Fill sits inside .profile-avatar's content box, leaving its 5px ring intact */
.skeleton-avatar { overflow: hidden; }
.skeleton-avatar-fill { display: block; width: 100%; height: 100%; border-radius: 50%; }
/* Mirrors .btn's box (padding/border/radius) without inheriting .btn's background */
.skeleton-button { padding: 8px 12px; border: 1px solid transparent; border-radius: 8px; color: transparent; }
/* Two lines at .profile-bio's 1.55 line-height: 2 x 1.15em + 0.8em gap = 3.1em */
.skeleton-bio { display: flex; flex-direction: column; gap: 0.8em; }
.skeleton-bio-line { height: 1.15em; border-radius: 4px; }
.skeleton-label { display: inline-block; border-radius: 4px; color: transparent; }
.skeleton-value { display: block; height: 1.2em; border-radius: 4px; }
/* Inline (not inline-block) so a long value wraps into line fragments exactly as the
   real text does; `clone` gives each fragment its own bar rather than one sliced run. */
.skeleton-text { display: inline; border-radius: 4px; color: transparent; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
@media (max-width: 960px) {
  .profile-cover { width: calc(100% + 32px); margin: -16px -16px 0; }
}
@media (max-width: 720px) {
  .profile-empty { padding: 20px; }
  .profile-content { padding: 0 20px 14px; }
  .profile-identity { gap: 12px; margin-top: -40px; align-items: flex-end; flex-wrap: wrap; }
  .profile-avatar { width: 88px; height: 88px; flex-basis: 88px; }
  .profile-name-row h4 { font-size: 20px; }
  .profile-details div { grid-template-columns: 1fr; gap: 4px; }
}
</style>
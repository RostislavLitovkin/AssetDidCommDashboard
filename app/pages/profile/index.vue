<script setup lang="ts">
import { Pencil, Plus, UserRound } from "lucide-vue-next"
import { computed, onMounted, ref, watch } from "vue"
import { useAddress } from "../../composables/useAddress"
import { useWallet } from "../../composables/useWallet"
import { ProfileClient } from "../../services/profile/profileClient"
import type { Profile } from "../../types/profile"

const wallet = useWallet()
const { formatAddress } = useAddress()
const profileClient = new ProfileClient()
const profile = ref<Profile | null>(null)
const loading = ref(false)
const error = ref("")
const hasConnectedWallet = computed(() => Boolean(wallet.accountAddress.value))

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

    <section v-else-if="loading" class="card profile-empty stack" aria-live="polite">
      <span class="muted">Loading profile...</span>
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
.profile-edit { margin-left: auto; margin-bottom: 8px; }
.profile-name-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.profile-name-row h4 { font-size: 24px; line-height: 1.1; }
.profile-badge { padding: 4px 10px; border-radius: 999px; background: color-mix(in srgb, var(--color-primary) 12%, var(--color-white)); color: var(--color-primary); font-size: 12px; font-weight: 600; }
.profile-address, .profile-details dd { overflow-wrap: anywhere; }
.profile-bio { margin: 0; white-space: pre-wrap; line-height: 1.55; }
.profile-details { display: grid; gap: 12px; margin: 0; }
.profile-details div { display: grid; grid-template-columns: minmax(140px, 0.45fr) minmax(0, 1fr); gap: 18px; align-items: center; min-height: 58px; padding: 12px 16px; border: 1px solid var(--border-default); border-radius: 8px; }
.profile-details dt { color: var(--text-secondary); font-size: 14px; font-weight: 600; }
.profile-details dd { margin: 0; font-size: 14px; font-weight: 600; }
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
<script setup lang="ts">
import { ArrowRight, Smile, UserRoundPlus } from "lucide-vue-next"
import { computed, onMounted, watch } from "vue"
import { useRoute } from "vue-router"
import { useProfileStatus } from "../../composables/useProfileStatus"

const route = useRoute()
const profileStatus = useProfileStatus()

// Both banners send the user to the profile editor; showing them on top of that
// very form would be noise, so the editor is the one page they stay out of.
const isOnProfileEditor = computed(() => route.path === "/profile/edit")
const showAccountBanner = computed(
  () => !isOnProfileEditor.value && profileStatus.status.value === "ready" && !profileStatus.hasAccount.value
)
const showNicknameBanner = computed(
  () => !isOnProfileEditor.value && profileStatus.hasAccount.value && !profileStatus.hasNickname.value
)

watch(() => profileStatus.address.value, () => profileStatus.refresh())
onMounted(() => profileStatus.refresh())
</script>

<template>
  <div v-if="showAccountBanner || showNicknameBanner" class="profile-setup-banners stack">
    <section v-if="showAccountBanner" class="setup-banner setup-banner-primary">
      <span class="setup-banner-icon" aria-hidden="true">
        <UserRoundPlus :size="28" />
      </span>
      <div class="setup-banner-copy">
        <h2 class="setup-banner-title">Welcome! Please create your account first</h2>
        <p class="setup-banner-text">
          Your wallet is connected, but it doesn't have an account yet. Setting one up takes a moment
          and it's what lets other people find you and message you.
        </p>
      </div>
      <NuxtLink class="setup-banner-cta" to="/profile/edit">
        Create my account
        <ArrowRight :size="18" aria-hidden="true" />
      </NuxtLink>
    </section>

    <section v-if="showNicknameBanner" class="setup-banner">
      <span class="setup-banner-icon" aria-hidden="true">
        <Smile :size="22" />
      </span>
      <div class="setup-banner-copy">
        <h2 class="setup-banner-title">Add a nickname so people know it's you</h2>
        <p class="setup-banner-text">
          Your account is ready to go. A nickname is optional, but we recommend one — without it,
          everybody just sees your wallet address.
        </p>
      </div>
      <NuxtLink class="setup-banner-cta setup-banner-cta-soft" to="/profile/edit">
        Set my nickname
        <ArrowRight :size="16" aria-hidden="true" />
      </NuxtLink>
    </section>
  </div>
</template>

<style scoped>
/* A friendly light-green palette of its own: these banners should read as a
   warm nudge rather than as part of the app's blue-grey chrome. */
.profile-setup-banners {
  gap: 12px;
  margin-bottom: 24px;
}

.setup-banner {
  display: flex;
  align-items: center;
  gap: 16px;
  width: min(1100px, 100%);
  margin: 0 auto;
  padding: 18px 20px;
  border: 1px solid #b4e0bf;
  border-radius: 16px;
  background: linear-gradient(135deg, #e6f7ea 0%, #f3fbf4 100%);
  color: #1d5233;
}

.setup-banner-primary {
  gap: 20px;
  padding: 26px 26px;
  border-width: 2px;
  box-shadow: 0 8px 22px rgba(47, 133, 78, 0.1);
}

.setup-banner-icon {
  display: grid;
  place-items: center;
  flex: 0 0 46px;
  width: 46px;
  height: 46px;
  border-radius: 50%;
  border: 1px solid #b4e0bf;
  background: var(--color-white);
  color: #2f8550;
}

.setup-banner-primary .setup-banner-icon {
  flex-basis: 58px;
  width: 58px;
  height: 58px;
}

.setup-banner-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.setup-banner-title {
  margin: 0;
  font-size: 17px;
  line-height: 1.3;
}

.setup-banner-primary .setup-banner-title {
  font-size: 22px;
}

.setup-banner-text {
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
  color: #3e6f51;
}

.setup-banner-cta {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  margin-left: auto;
  padding: 11px 18px;
  border: 1px solid #2f8550;
  border-radius: 999px;
  background: #2f8550;
  color: var(--color-white);
  font-weight: 600;
  white-space: nowrap;
  transition: background-color 160ms ease, border-color 160ms ease, box-shadow 160ms ease;
}

/* Overrides the global `a:hover` accent so the CTA keeps its readable contrast. */
.setup-banner-cta:hover,
.setup-banner-cta:focus-visible {
  background: #256b41;
  border-color: #256b41;
  color: var(--color-white);
  box-shadow: 0 0 0 3px rgba(47, 133, 78, 0.22);
}

.setup-banner-cta:focus-visible {
  outline: none;
}

.setup-banner-cta-soft {
  padding: 9px 16px;
  background: var(--color-white);
  color: #226b40;
  font-size: 14px;
}

.setup-banner-cta-soft:hover,
.setup-banner-cta-soft:focus-visible {
  background: #d9f2e0;
  color: #1d5233;
}

@media (max-width: 720px) {
  .setup-banner,
  .setup-banner-primary {
    flex-wrap: wrap;
    gap: 12px;
    padding: 18px;
  }

  .setup-banner-copy {
    flex: 1 1 100%;
    order: 2;
  }

  .setup-banner-primary .setup-banner-title {
    font-size: 19px;
  }

  .setup-banner-cta {
    order: 3;
    width: 100%;
    margin-left: 0;
    justify-content: center;
  }
}
</style>

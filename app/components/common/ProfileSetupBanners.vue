<script setup lang="ts">
import { ArrowRight, Smile, UserRoundPlus } from "lucide-vue-next"
import { computed, onMounted, watch } from "vue"
import { useRoute } from "vue-router"
import { useProfileStatus } from "../../composables/useProfileStatus"

const route = useRoute()
const profileStatus = useProfileStatus()

// Pages the banners stay out of. The profile editor, because both banners send
// the user to that very form and sitting on top of it would just be noise. The
// indexed-bucket chat, because it's a fixed-height page that clips instead of
// scrolling, so a banner there silently eats the bottom of the conversation.
const hidesBanners = computed(
  () => route.path === "/profile/edit" || route.path.startsWith("/indexed-bucket/")
)
const showAccountBanner = computed(
  () => !hidesBanners.value && profileStatus.status.value === "ready" && !profileStatus.hasAccount.value
)
const showNicknameBanner = computed(
  () => !hidesBanners.value && profileStatus.hasAccount.value && !profileStatus.hasNickname.value
)

watch(() => profileStatus.address.value, () => profileStatus.refresh())
onMounted(() => profileStatus.refresh())
</script>

<template>
  <div v-if="showAccountBanner || showNicknameBanner" class="profile-setup-banners">
    <section v-if="showAccountBanner" class="setup-banner setup-banner-primary">
      <div class="setup-banner-inner container">
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
        <NuxtLink class="btn btn-primary setup-banner-cta" to="/profile/edit">
          Create my account
          <ArrowRight :size="16" aria-hidden="true" />
        </NuxtLink>
      </div>
    </section>

    <section v-if="showNicknameBanner" class="setup-banner">
      <div class="setup-banner-inner container">
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
        <NuxtLink class="btn setup-banner-cta" to="/profile/edit">
          Set my nickname
          <ArrowRight :size="16" aria-hidden="true" />
        </NuxtLink>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* Full bleed: escapes the shell's content padding so the banners run edge to
   edge and sit flush against the top of the content area. */
.profile-setup-banners {
  width: calc(100% + 48px);
  margin: -24px -24px 24px;
  /* Keeps full height in the shell's content column so a short viewport squeezes
     the page below (which scrolls internally) rather than crushing the banner. */
  flex-shrink: 0;
}

/* A friendly light-green strip: these should read as a warm nudge rather than
   as part of the app's blue-grey chrome. */
.setup-banner {
  padding: 18px 24px;
  border-bottom: 1px solid #b4e0bf;
  background: linear-gradient(135deg, #e6f7ea 0%, #f3fbf4 100%);
  color: #1d5233;
}

.setup-banner-primary {
  padding: 26px 24px;
}

/* Keeps the banner's contents on the same column as the page content below it.
   The shared .container supplies the width, centring and gutter, so the two
   columns can't drift apart — that only holds while the banner's own horizontal
   padding matches AppShell's content padding, which the breakpoints below keep
   in step. */
.setup-banner-inner {
  display: flex;
  align-items: center;
  gap: 16px;
}

.setup-banner-primary .setup-banner-inner {
  gap: 20px;
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

/* A zero flex basis keeps the copy on the icon's line once the banner is allowed
   to wrap; sized by its content it would jump to a line of its own instead. */
.setup-banner-copy {
  display: flex;
  flex: 1 1 0;
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

/* Layout only — the look comes from the app's own .btn / .btn-primary. */
.setup-banner-cta {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  margin-left: auto;
  white-space: nowrap;
}

/* The shell drops to 16px of content padding here, so the banner follows it —
   otherwise the copy sits a few pixels off the page content below. */
@media (max-width: 960px) {
  .profile-setup-banners {
    width: calc(100% + 32px);
    margin: -16px -16px 16px;
  }

  .setup-banner {
    padding: 18px 16px;
  }

  .setup-banner-primary {
    padding: 26px 16px;
  }
}

/* Narrow screens keep the icon beside the headline and drop the call to action
   onto a full-width line of its own. */
@media (max-width: 720px) {
  .setup-banner,
  .setup-banner-primary {
    padding: 18px 16px;
  }

  .setup-banner-inner {
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 14px;
  }

  .setup-banner-primary .setup-banner-title {
    font-size: 19px;
  }

  .setup-banner-cta {
    flex: 1 1 100%;
    margin-left: 0;
    justify-content: center;
  }
}
</style>

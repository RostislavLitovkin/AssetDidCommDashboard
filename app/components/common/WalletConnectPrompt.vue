<script setup lang="ts">
import { computed, ref } from "vue"
import { Link, Wallet } from "lucide-vue-next"
import WalletSelectModal from "./WalletSelectModal.vue"
import { useSettingsStore } from "../../stores/settings"

const DEFAULT_DESCRIPTION = "Connect your wallet to continue."

const props = withDefaults(
  defineProps<{
    title?: string
    description?: string
    actionLabel?: string
  }>(),
  {
    title: "Connect Your Wallet",
    description: DEFAULT_DESCRIPTION,
    actionLabel: "Connect Wallet"
  }
)

const settings = useSettingsStore()
settings.initialize()

const effectiveDescription = computed(() =>
  props.description !== DEFAULT_DESCRIPTION
    ? props.description
    : settings.walletType === "solana"
      ? "Connect a Solana wallet to continue."
      : "Connect the Polkadot browser extension to continue."
)

const showWalletPopup = ref(false)
</script>

<template>
  <div>
    <div
      style="
        display: grid;
        place-items: center;
        min-height: 400px;
        background: linear-gradient(135deg, var(--surface-card), var(--surface-bg));
        border-radius: 12px;
        padding: 40px 20px;
        text-align: center;
        border: 2px dashed var(--border-default);
      "
    >
      <div class="stack" style="gap: 24px; max-width: 400px">
        <Link :size="48" style="margin: 0 auto; color: var(--text-primary)" />
        <div class="stack" style="gap: 12px">
          <h2 style="margin: 0; font-size: 24px">{{ props.title }}</h2>
          <p class="muted" style="margin: 0; font-size: 14px; line-height: 1.6">
            {{ effectiveDescription }}
          </p>
        </div>
        <button
          class="btn btn-primary"
          type="button"
          style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 12px 16px"
          @click="showWalletPopup = true"
        >
          <Wallet :size="16" />
          {{ props.actionLabel }}
        </button>
      </div>
    </div>

    <WalletSelectModal v-if="showWalletPopup" @close="showWalletPopup = false" />
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue"
import { Link, Wallet } from "lucide-vue-next"
import ParticleLoader from "./ParticleLoader.vue"
import { useWallet } from "../../composables/useWallet"

const props = withDefaults(
  defineProps<{
    title?: string
    description?: string
    actionLabel?: string
  }>(),
  {
    title: "Connect Your Wallet",
    description: "Connect your wallet to continue.",
    actionLabel: "Connect Wallet"
  }
)

const wallet = useWallet()
const showWalletPopup = ref(false)
const walletAccounts = ref<Array<{ address: string; name: string; source: string }>>([])
const loadingWallet = ref(false)
const selectingWallet = ref(false)

async function openWalletPopup(): Promise<void> {
  showWalletPopup.value = true
  loadingWallet.value = true
  try {
    walletAccounts.value = await wallet.listAccounts()
  } finally {
    loadingWallet.value = false
  }
}

async function selectWallet(address: string): Promise<void> {
  selectingWallet.value = true
  try {
    await wallet.connectToAddress(address)
    showWalletPopup.value = false
  } finally {
    selectingWallet.value = false
  }
}
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
            {{ props.description }}
          </p>
        </div>
        <button
          class="btn btn-primary"
          type="button"
          style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 12px 16px"
          @click="openWalletPopup"
        >
          <Wallet :size="16" />
          {{ props.actionLabel }}
        </button>
      </div>
    </div>

    <div
      v-if="showWalletPopup"
      style="position: fixed; inset: 0; background: rgba(0,0,0,0.25); display: grid; place-items: center; z-index: 20"
      @click.self="showWalletPopup = false"
    >
      <div class="card stack" style="width: min(560px, 92vw)">
        <div class="row" style="justify-content: space-between; align-items: center">
          <h3 style="margin: 0">Select Wallet</h3>
          <button class="btn" type="button" aria-label="Close" @click="showWalletPopup = false" :disabled="selectingWallet">
            ✕
          </button>
        </div>

        <ParticleLoader v-if="loadingWallet" label="Loading wallets..." />

        <div v-else-if="walletAccounts.length" class="stack" style="max-height: 300px; overflow: auto; gap: 8px">
          <button
            v-for="account in walletAccounts"
            :key="account.address"
            class="btn"
            type="button"
            :disabled="selectingWallet"
            style="display: flex; justify-content: space-between; align-items: center; text-align: left"
            @click="selectWallet(account.address)"
          >
            <ParticleLoader v-if="selectingWallet" size="inline" label="Connecting wallet" style="min-width: 0" />
            <span v-else class="stack" style="gap: 2px; min-width: 0; flex: 1">
              <strong>{{ account.name }}</strong>
              <span class="muted" style="font-size: 12px">{{ account.address.slice(0, 10) }}...{{ account.address.slice(-10) }}</span>
            </span>
            <span class="muted" style="font-size: 12px; white-space: nowrap; margin-left: 8px">{{ account.source }}</span>
          </button>
        </div>

        <p v-else class="muted" style="margin: 0">No wallets found.</p>
      </div>
    </div>
  </div>
</template>

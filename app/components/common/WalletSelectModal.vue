<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import { ExternalLink, RefreshCw, X } from "lucide-vue-next"
import ParticleLoader from "./ParticleLoader.vue"
import WalletBrandIcon from "./WalletBrandIcon.vue"
import { useAddress } from "../../composables/useAddress"
import { useWallet } from "../../composables/useWallet"
import { useSettingsStore } from "../../stores/settings"
import { detectInstalledWallets, walletsForKind, hasInstalledWallet } from "../../services/wallet/walletCatalog"
import type { WalletBrandId } from "../../services/wallet/walletCatalog"

const props = withDefaults(defineProps<{ title?: string }>(), { title: "Select Wallet" })

const emit = defineEmits<{ close: [] }>()

const settings = useSettingsStore()
settings.initialize()
const wallet = useWallet()
const { formatAddress } = useAddress()

const dialogRef = ref<HTMLElement | null>(null)
const accounts = ref<Array<{ address: string; name: string; source: string }>>([])
const isLoading = ref(true)
const isSelecting = ref(false)
const selectingAddress = ref("")
const connectError = ref("")
const walletInstalled = ref(false)
const installedIds = ref<Set<WalletBrandId>>(new Set())

const chainLabel = computed(() => (settings.walletType === "solana" ? "Solana" : "Polkadot"))
const catalogEntries = computed(() => walletsForKind(settings.walletType))
const connectedAddress = computed(() => wallet.accountAddress.value || "")

const unlockHint = computed(() =>
  settings.walletType === "solana"
    ? "Your wallet did not provide an account. Unlock it, approve access for this site, then check again."
    : "No accounts available. Unlock your extension, allow access for this site, then check again."
)

function brandForSource(source: string): WalletBrandId | null {
  const normalized = source.toLowerCase()
  const entry = catalogEntries.value.find(
    (candidate) => candidate.id === normalized || candidate.name.toLowerCase() === normalized
  )
  return entry?.id ?? null
}

function downloadHost(url: string): string {
  return new URL(url).hostname.replace(/^www\./, "")
}

async function loadAccounts(): Promise<void> {
  isLoading.value = true
  connectError.value = ""
  walletInstalled.value = hasInstalledWallet(settings.walletType)
  installedIds.value = detectInstalledWallets(settings.walletType)

  try {
    accounts.value = await wallet.listAccounts()
  } catch {
    accounts.value = []
  } finally {
    isLoading.value = false
  }
}

async function selectAccount(address: string): Promise<void> {
  connectError.value = ""
  isSelecting.value = true
  selectingAddress.value = address

  try {
    await wallet.connectToAddress(address)
  } finally {
    isSelecting.value = false
    selectingAddress.value = ""
  }

  if (wallet.walletStatus.value === "connected") {
    emit("close")
  } else {
    connectError.value = "Connection failed — the wallet declined or the account is no longer available."
  }
}

function requestClose(): void {
  if (!isSelecting.value) {
    emit("close")
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    requestClose()
  }
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown)
  dialogRef.value?.focus()
  loadAccounts()
})

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown)
})
</script>

<template>
  <div class="wallet-modal-backdrop" @click.self="requestClose">
    <div
      ref="dialogRef"
      class="card stack wallet-modal"
      role="dialog"
      aria-modal="true"
      :aria-label="props.title"
      tabindex="-1"
    >
      <div class="row" style="justify-content: space-between; align-items: center">
        <h3 style="margin: 0">{{ props.title }}</h3>
        <button class="btn" type="button" aria-label="Close" :disabled="isSelecting" @click="requestClose">
          <X :size="14" />
        </button>
      </div>

      <ParticleLoader v-if="isLoading" label="Looking for wallets..." />

      <template v-else-if="accounts.length">
        <p class="muted" style="margin: 0; font-size: 13px">Choose an account to connect.</p>
        <div class="stack" style="max-height: 300px; overflow: auto; gap: 8px">
          <button
            v-for="account in accounts"
            :key="account.address"
            class="btn wallet-account-btn"
            type="button"
            :disabled="isSelecting"
            @click="selectAccount(account.address)"
          >
            <ParticleLoader
              v-if="isSelecting && selectingAddress === account.address"
              size="inline"
              label="Connecting wallet"
              style="min-width: 0"
            />
            <template v-else>
              <WalletBrandIcon
                v-if="brandForSource(account.source)"
                :brand="brandForSource(account.source)!"
                :size="26"
                class="wallet-account-icon"
              />
              <span class="stack" style="gap: 2px; min-width: 0; flex: 1; text-align: left">
                <strong>{{ account.name }}</strong>
                <span class="muted" style="font-size: 12px">{{ formatAddress(account.address) }}</span>
              </span>
              <span v-if="account.address === connectedAddress" class="wallet-connected-badge">Connected</span>
              <span v-else class="muted" style="font-size: 12px; white-space: nowrap">{{ account.source }}</span>
            </template>
          </button>
        </div>
      </template>

      <template v-else-if="!walletInstalled">
        <div class="stack" style="gap: 4px">
          <strong style="font-size: 15px">No {{ chainLabel }} wallet detected</strong>
          <p class="muted" style="margin: 0; font-size: 13px; line-height: 1.5">
            Install one of these browser extensions, then refresh this page — extensions only load with it.
          </p>
        </div>
        <div class="wallet-install-grid">
          <a
            v-for="entry in catalogEntries"
            :key="entry.id"
            class="wallet-install-card"
            :href="entry.downloadUrl"
            target="_blank"
            rel="noreferrer noopener"
          >
            <WalletBrandIcon :brand="entry.id" :size="36" />
            <span class="stack" style="gap: 1px; min-width: 0">
              <strong style="font-size: 13px">{{ entry.name }}</strong>
              <span class="muted" style="font-size: 11px">{{ downloadHost(entry.downloadUrl) }}</span>
            </span>
            <ExternalLink :size="13" class="wallet-install-external" />
          </a>
        </div>
        <button class="btn wallet-refresh-btn" type="button" @click="loadAccounts">
          <RefreshCw :size="14" />
          Check again
        </button>
      </template>

      <template v-else>
        <p class="muted" style="margin: 0; font-size: 13px; line-height: 1.5">{{ unlockHint }}</p>
        <div class="row" style="align-items: center; gap: 10px">
          <button class="btn wallet-refresh-btn" type="button" @click="loadAccounts">
            <RefreshCw :size="14" />
            Check again
          </button>
          <span class="muted" style="font-size: 12px">Or get another wallet:</span>
          <span class="row" style="gap: 6px; flex-wrap: nowrap">
            <a
              v-for="entry in catalogEntries"
              :key="entry.id"
              class="wallet-mini-link"
              :href="entry.downloadUrl"
              target="_blank"
              rel="noreferrer noopener"
              :title="`Install ${entry.name}`"
              :aria-label="`Install ${entry.name}`"
            >
              <WalletBrandIcon :brand="entry.id" :size="22" />
            </a>
          </span>
        </div>
      </template>

      <p v-if="connectError" class="wallet-modal-error">{{ connectError }}</p>
    </div>
  </div>
</template>

<style scoped>
.wallet-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.25);
  display: grid;
  place-items: center;
  z-index: 50;
}

.wallet-modal {
  width: min(560px, 92vw);
  animation: wallet-modal-in 160ms ease;
}

.wallet-modal:focus {
  outline: none;
}

@keyframes wallet-modal-in {
  from {
    opacity: 0;
    transform: translateY(6px) scale(0.985);
  }

  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .wallet-modal {
    animation: none;
  }
}

.wallet-account-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: left;
}

.wallet-account-icon {
  flex-shrink: 0;
}

.wallet-connected-badge {
  font-size: 11px;
  line-height: 1.2;
  padding: 3px 8px;
  border-radius: 999px;
  white-space: nowrap;
  color: var(--status-success);
  border: 1px solid color-mix(in srgb, var(--status-success) 45%, transparent);
  background: color-mix(in srgb, var(--status-success) 10%, transparent);
}

.wallet-install-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
}

.wallet-install-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border-default);
  border-radius: 10px;
  background: var(--surface-card);
  color: var(--text-primary);
  text-decoration: none;
  transition: border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
}

.wallet-install-card:hover,
.wallet-install-card:focus-visible {
  border-color: var(--color-primary);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
  transform: translateY(-1px);
}

.wallet-install-external {
  margin-left: auto;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.wallet-refresh-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  align-self: flex-start;
}

.wallet-mini-link {
  display: inline-flex;
  border-radius: 6px;
  transition: transform 160ms ease;
}

.wallet-mini-link:hover,
.wallet-mini-link:focus-visible {
  transform: translateY(-1px);
}

.wallet-modal-error {
  margin: 0;
  font-size: 13px;
  color: var(--status-error);
}
</style>

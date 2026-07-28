<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import { Check, ExternalLink } from "lucide-vue-next"
import { useSettingsStore } from "../stores/settings"
import { useSessionStore } from "../stores/session"
import { useWallet } from "../composables/useWallet"
import { PRIMARY_COLOR_OPTIONS } from "../services/theme/primaryColor"
import type { WalletKind } from "../services/wallet/types"
import type { WalletBrandId } from "../services/wallet/walletCatalog"
import { detectInstalledWallets, hasInstalledWallet, walletsForKind } from "../services/wallet/walletCatalog"
import PageHeader from "../components/common/PageHeader.vue"
import WalletBrandIcon from "../components/common/WalletBrandIcon.vue"

const settings = useSettingsStore()
settings.initialize()
const sessionStore = useSessionStore()
const wallet = useWallet()

const WALLET_TYPE_OPTIONS: Array<{ value: WalletKind; name: string; hint: string }> = [
  { value: "solana", name: "Solana", hint: "Sign with an injected Solana wallet" },
  { value: "polkadot", name: "Polkadot", hint: "Sign with a polkadot.js-compatible extension" }
]

// Wallet extensions inject after page load, so detection is client-only and
// gated behind detectionReady to keep hydration deterministic.
const detectionReady = ref(false)
const installedIds = ref<Set<WalletBrandId>>(new Set())
const hasWalletByKind = ref<Record<WalletKind, boolean>>({ solana: false, polkadot: false })

function refreshWalletDetection(): void {
  installedIds.value = new Set([...detectInstalledWallets("solana"), ...detectInstalledWallets("polkadot")])
  hasWalletByKind.value = {
    solana: hasInstalledWallet("solana"),
    polkadot: hasInstalledWallet("polkadot")
  }
  detectionReady.value = true
}

onMounted(() => {
  refreshWalletDetection()
  // Extensions can still be injecting while the page settles; check once more.
  setTimeout(refreshWalletDetection, 1500)
})

const selectedKindLabel = computed(() =>
  WALLET_TYPE_OPTIONS.find((option) => option.value === settings.walletType)?.name ?? ""
)
const missingWalletForSelection = computed(
  () => detectionReady.value && !hasWalletByKind.value[settings.walletType]
)

function downloadHost(url: string): string {
  return new URL(url).hostname.replace(/^www\./, "")
}

function selectWalletType(kind: WalletKind): void {
  if (kind === settings.walletType) {
    return
  }

  settings.setWalletType(kind)
  refreshWalletDetection()

  if (sessionStore.walletStatus === "connected" || sessionStore.walletStatus === "connecting") {
    wallet.disconnect()
  }
}

const ss58PrefixInput = ref(String(settings.ss58Prefix))
const saveError = ref("")
const saveSuccess = ref("")

const showMessageDebug = computed({
  get: () => settings.showMessageDebug,
  set: (value: boolean) => settings.setShowMessageDebug(value)
})

const notificationsEnabled = computed({
  get: () => settings.notificationsEnabled,
  set: (value: boolean) => settings.setNotificationsEnabled(value)
})

function saveSettings(): void {
  saveError.value = ""
  saveSuccess.value = ""

  try {
    const parsed = Number.parseInt(ss58PrefixInput.value, 10)
    settings.setSs58Prefix(parsed)
    ss58PrefixInput.value = String(settings.ss58Prefix)
    saveSuccess.value = "Saved"
  } catch (error) {
    saveError.value = error instanceof Error ? error.message : "Unable to save"
  }
}

function selectPrimaryColor(color: string): void {
  settings.setPrimaryColor(color)
}
</script>

<template>
  <main class="stack">
    <PageHeader title="Settings" />

    <section class="card stack" style="gap: 10px">
      <h4 style="margin: 0; font-size: 16px;">Wallet</h4>
      <span style="font-weight: 600; font-size: 14px;">Wallet type</span>
      <div class="swatch-row">
        <button
          v-for="option in WALLET_TYPE_OPTIONS"
          :key="option.value"
          type="button"
          class="wallet-option"
          :class="{ 'wallet-option-active': option.value === settings.walletType }"
          :aria-pressed="option.value === settings.walletType"
          @click="selectWalletType(option.value)"
        >
          <span class="wallet-option-head">
            <WalletBrandIcon :brand="option.value" :size="28" />
            <span class="stack" style="gap: 1px; text-align: left">
              <strong>{{ option.name }}</strong>
              <span class="muted" style="font-size: 12px">{{ option.hint }}</span>
            </span>
            <Check v-if="option.value === settings.walletType" :size="16" class="wallet-option-check" />
          </span>
          <span v-if="detectionReady" class="wallet-chip-row">
            <span
              v-for="entry in walletsForKind(option.value)"
              :key="entry.id"
              class="wallet-chip"
              :class="{ 'wallet-chip-installed': installedIds.has(entry.id) }"
            >
              <WalletBrandIcon :brand="entry.id" :size="14" />
              {{ entry.name }}
              <span v-if="installedIds.has(entry.id)" class="wallet-chip-dot" aria-label="Installed" />
            </span>
          </span>
        </button>
      </div>

      <div v-if="missingWalletForSelection" class="wallet-install-callout stack" style="gap: 8px">
        <p style="margin: 0; font-size: 13px; font-weight: 600">
          No {{ selectedKindLabel }} wallet detected in this browser
        </p>
        <div class="row" style="gap: 8px">
          <a
            v-for="entry in walletsForKind(settings.walletType)"
            :key="entry.id"
            class="wallet-install-link"
            :href="entry.downloadUrl"
            target="_blank"
            rel="noreferrer noopener"
          >
            <WalletBrandIcon :brand="entry.id" :size="24" />
            <span class="stack" style="gap: 0">
              <strong style="font-size: 12px">{{ entry.name }}</strong>
              <span class="muted" style="font-size: 11px">{{ downloadHost(entry.downloadUrl) }}</span>
            </span>
            <ExternalLink :size="12" class="muted" />
          </a>
        </div>
        <p class="muted" style="margin: 0; font-size: 12px">
          After installing, refresh this page — extensions only load with it.
        </p>
      </div>

      <span class="muted" style="font-size: 13px;">
        Which wallet family the app uses for your identity and request signing.
        Switching disconnects the currently connected wallet.
      </span>
    </section>

    <section class="card stack" style="gap: 10px" aria-live="polite">
      <h4 style="margin: 0; font-size: 16px;">Address Format</h4>
      <label class="stack" style="gap: 6px">
        <span style="font-weight: 600; font-size: 14px;">SS58 Prefix</span>
        <div style="display: flex; gap: 8px; align-items: flex-end">
          <input
            v-model="ss58PrefixInput"
            class="input"
            type="number"
            min="0"
            max="16383"
            step="1"
            inputmode="numeric"
            placeholder="42"
            style="flex: 1"
          />
          <button class="btn btn-primary" type="button" @click="saveSettings" style="white-space: nowrap">
            Save
          </button>
        </div>
      </label>
      <p v-if="saveError" class="error-text">{{ saveError }}</p>
      <p v-if="saveSuccess" class="success-text">{{ saveSuccess }}</p>
    </section>

    <section class="card stack" style="gap: 10px">
      <h4 style="margin: 0; font-size: 16px;">Appearance</h4>
      <span style="font-weight: 600; font-size: 14px;">Primary color</span>
      <div class="swatch-row">
        <button
          v-for="option in PRIMARY_COLOR_OPTIONS"
          :key="option.value"
          type="button"
          class="swatch"
          :class="{ 'swatch-active': option.value === settings.primaryColor }"
          :style="`--swatch-color: ${option.value}`"
          :aria-label="option.name"
          :aria-pressed="option.value === settings.primaryColor"
          @click="selectPrimaryColor(option.value)"
        >
          <span class="swatch-chip" aria-hidden="true">
            <Check v-if="option.value === settings.primaryColor" class="swatch-check" :size="14" />
          </span>
          <span>{{ option.name }}</span>
        </button>
      </div>
      <span class="muted" style="font-size: 13px;">Sets the app's accent color. Applied immediately.</span>
    </section>

    <section class="card stack" style="gap: 10px">
      <h4 style="margin: 0; font-size: 16px;">Notifications</h4>
      <label class="toggle-row">
        <input v-model="notificationsEnabled" type="checkbox" />
        <span>Enable notifications</span>
      </label>
      <span class="muted" style="font-size: 13px;">Disabled by default. When off, notification popups are hidden.</span>
    </section>

    <section class="card stack" style="gap: 10px">
      <h4 style="margin: 0; font-size: 16px;">Developer Options</h4>
      <label class="toggle-row">
        <input v-model="showMessageDebug" type="checkbox" />
        <span>Show debug data</span>
      </label>
      <span class="muted" style="font-size: 13px;">This will display extra data like internal record ids and extra debugging windows. Keep disabled if you are unsure what this does.</span>
    </section>
  </main>
</template>

<style scoped>
.error-text {
  margin: 0;
  color: var(--status-error);
  font-size: 13px;
}

.success-text {
  margin: 0;
  color: var(--status-success);
  font-size: 13px;
}

.toggle-row {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-weight: 600;
  font-size: 14px;
}

.toggle-row input {
  width: 18px;
  height: 18px;
}

.swatch-row {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.swatch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--border-default);
  border-radius: 10px;
  background: var(--surface-card);
  color: var(--text-primary);
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
}

.swatch:hover,
.swatch:focus-visible {
  border-color: var(--swatch-color);
}

.swatch-active {
  border-color: var(--swatch-color);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--swatch-color) 30%, transparent);
}

.swatch-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  background: var(--swatch-color);
}

.swatch-check {
  color: var(--color-white);
}

.wallet-option {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--border-default);
  border-radius: 10px;
  background: var(--surface-card);
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
}

.wallet-option-head {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.wallet-option-check {
  color: var(--color-primary);
  margin-left: 4px;
  flex-shrink: 0;
}

.wallet-chip-row {
  display: inline-flex;
  gap: 6px;
  flex-wrap: wrap;
}

.wallet-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border: 1px solid var(--border-default);
  border-radius: 999px;
  font-size: 11px;
  color: var(--text-secondary);
  opacity: 0.55;
}

.wallet-chip svg {
  filter: grayscale(1);
}

.wallet-chip-installed {
  opacity: 1;
  color: var(--text-primary);
  border-color: color-mix(in srgb, var(--status-success) 40%, var(--border-default));
}

.wallet-chip-installed svg {
  filter: none;
}

.wallet-chip-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--status-success);
}

.wallet-install-callout {
  padding: 12px 14px;
  border: 1px dashed color-mix(in srgb, var(--status-warning) 45%, var(--border-default));
  border-radius: 10px;
  background: color-mix(in srgb, var(--status-warning) 6%, var(--surface-card));
}

.wallet-install-link {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid var(--border-default);
  border-radius: 10px;
  background: var(--surface-card);
  color: var(--text-primary);
  text-decoration: none;
  transition: border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
}

.wallet-install-link:hover,
.wallet-install-link:focus-visible {
  border-color: var(--color-primary);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
  transform: translateY(-1px);
}

.wallet-option:hover,
.wallet-option:focus-visible {
  border-color: var(--color-primary);
}

.wallet-option-active {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary) 30%, transparent);
}

@media (max-width: 720px) {
  .settings-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .settings-actions .btn {
    width: 100%;
  }

  .toggle-row {
    width: 100%;
  }
}
</style>

<script setup lang="ts">
import { ChevronRight, FileUp, Fingerprint, MessageSquare, Settings, Trash2, Wallet, X } from "lucide-vue-next"
import { computed, ref } from "vue"
import NotificationCenter from "../common/NotificationCenter.vue"
import { useAddress } from "../../composables/useAddress"
import { useWallet } from "../../composables/useWallet"
import { useSettingsStore } from "../../stores/settings"

const wallet = useWallet()
const { formatAddress } = useAddress()
const settings = useSettingsStore()

settings.initialize()

const showWalletPopup = ref(false)
const accounts = ref<Array<{ address: string; name: string; source: string }>>([])
const x25519LoadError = ref("")
const x25519LoadSuccess = ref("")
const walletCopyError = ref("")
const walletCopySuccess = ref("")
const x25519FileInputRef = ref<HTMLInputElement | null>(null)
const showX25519CopyEffect = ref(false)
const showWalletCopyEffect = ref(false)
let x25519CopyEffectTimeout: ReturnType<typeof setTimeout> | undefined
let walletCopyEffectTimeout: ReturnType<typeof setTimeout> | undefined
const isWalletConnected = computed(() => wallet.walletStatus.value === "connected" && Boolean(wallet.accountAddress.value))
const connectedAddressFull = computed(() => wallet.accountAddress.value || "")
const connectedAddressLabel = computed(() => formatAddress(wallet.accountAddress.value || ""))
const activeX25519KeyKid = computed(() => settings.x25519SecretJwk?.kid || "")
const activeX25519PublicX = computed(() => settings.x25519SecretJwk?.x || "")
const hasActiveX25519Key = computed(() => Boolean(settings.x25519SecretJwk))
const formattedAccounts = computed(() =>
  accounts.value.map((account) => ({
    ...account,
    formattedAddress: formatAddress(account.address)
  }))
)

async function openWalletPopup() {
  showWalletPopup.value = true
  accounts.value = await wallet.listAccounts()
}

async function selectWallet(address: string) {
  await wallet.connectToAddress(address)
  showWalletPopup.value = false
}

async function loadX25519SecretFromFile(event: Event) {
  x25519LoadError.value = ""

  const input = event.target as HTMLInputElement | null
  const file = input?.files?.[0]

  if (!file) {
    return
  }

  try {
    const content = await file.text()
    const parsed = JSON.parse(content)
    settings.setX25519SecretJwk(parsed)
  } catch (error) {
    x25519LoadError.value = error instanceof Error ? error.message : "Unable to read selected key file"
  } finally {
    if (input) {
      input.value = ""
    }
  }
}

function openX25519FilePicker() {
  x25519FileInputRef.value?.click()
}

function clearX25519Secret() {
  settings.clearX25519SecretJwk()
  x25519LoadError.value = ""
  x25519LoadSuccess.value = "Stored X25519 secret key cleared."
}

function triggerX25519CopyEffect() {
  if (x25519CopyEffectTimeout) {
    clearTimeout(x25519CopyEffectTimeout)
  }

  showX25519CopyEffect.value = false
  requestAnimationFrame(() => {
    showX25519CopyEffect.value = true
    x25519CopyEffectTimeout = setTimeout(() => {
      showX25519CopyEffect.value = false
    }, 1200)
  })
}

function triggerWalletCopyEffect() {
  if (walletCopyEffectTimeout) {
    clearTimeout(walletCopyEffectTimeout)
  }

  showWalletCopyEffect.value = false
  requestAnimationFrame(() => {
    showWalletCopyEffect.value = true
    walletCopyEffectTimeout = setTimeout(() => {
      showWalletCopyEffect.value = false
    }, 1200)
  })
}

async function copyConnectedWalletAddress() {
  walletCopyError.value = ""

  if (!wallet.accountAddress.value) {
    walletCopyError.value = "No connected wallet address available to copy."
    return
  }

  try {
    await navigator.clipboard.writeText(wallet.accountAddress.value)
    walletCopySuccess.value = "Wallet address copied to clipboard."
    triggerWalletCopyEffect()
  } catch (error) {
    walletCopyError.value = error instanceof Error ? error.message : "Unable to copy wallet address"
  }
}

async function copyX25519PublicKey() {
  x25519LoadError.value = ""

  if (!activeX25519PublicX.value) {
    x25519LoadError.value = "No X25519 public key available to copy."
    return
  }

  try {
    await navigator.clipboard.writeText(activeX25519PublicX.value)
    x25519LoadSuccess.value = "X25519 public key copied to clipboard."
    triggerX25519CopyEffect()
  } catch (error) {
    x25519LoadError.value = error instanceof Error ? error.message : "Unable to copy X25519 public key"
  }
}
</script>

<template>
  <main class="app-shell-root">
    <aside class="app-shell-sidebar">
      <NuxtLink to="/" style="padding: 8px 8px 20px; text-decoration: none; color: inherit; display: block">
        <h2 style="margin: 0; font-size: 18px">Asset DIDComm</h2>
        <p class="muted" style="margin: 6px 0 0; font-size: 13px">Admin Dashboard</p>
      </NuxtLink>

      <nav class="stack" style="gap: 8px">
        <NuxtLink class="btn sidebar-btn" to="/did" style="display: flex; align-items: center; gap: 8px; text-decoration: none">
          <Fingerprint :size="16" />
          DID
        </NuxtLink>
        <NuxtLink class="btn sidebar-btn" to="/messages" style="display: flex; align-items: center; gap: 8px; text-decoration: none">
          <MessageSquare :size="16" />
          Messages
        </NuxtLink>
        <NuxtLink class="btn sidebar-btn" to="/settings" style="display: flex; align-items: center; gap: 8px; text-decoration: none">
          <Settings :size="16" />
          Settings
        </NuxtLink>
      </nav>

      <div style="margin-top: auto; padding-top: 16px; border-top: 1px solid var(--border-default)">
        <div
          class="row muted"
          style="margin: 0 0 8px; font-size: 12px; align-items: center; gap: 6px; flex-wrap: nowrap"
          v-if="isWalletConnected"
        >
          <span>Connected:</span>
          <span
            class="wallet-address-text"
            :class="{ 'wallet-address-text-copied': showWalletCopyEffect }"
            :data-full-address="connectedAddressFull"
            :title="connectedAddressFull"
            role="button"
            tabindex="0"
            style="display: inline-block; min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom"
            @click="copyConnectedWalletAddress"
            @keydown.enter.prevent="copyConnectedWalletAddress"
            @keydown.space.prevent="copyConnectedWalletAddress"
          >
            {{ connectedAddressLabel }}
          </span>
          <span class="wallet-copy-badge" v-if="showWalletCopyEffect">Copied!</span>
        </div>
        <p class="muted" style="margin: 0 0 8px; font-size: 12px" v-if="wallet.providerName">
          Provider: {{ wallet.providerName }}
        </p>
        <p class="muted" style="margin: 0 0 8px; font-size: 12px" v-if="!isWalletConnected">
          No wallet connected
        </p>
        <button
          class="btn sidebar-btn"
          type="button"
          style="width: 100%; display: flex; align-items: center; justify-content: space-between"
          @click="openWalletPopup"
        >
          <span style="display: inline-flex; align-items: center; gap: 8px">
            <Wallet :size="16" />
            {{ isWalletConnected ? "Switch Wallet" : "Connect Wallet" }}
          </span>
          <ChevronRight :size="14" />
        </button>
        <p class="sidebar-status-error" v-if="walletCopyError">{{ walletCopyError }}</p>

        <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border-default)" aria-live="polite">
          <div
            class="row muted"
            style="margin: 0 0 8px; font-size: 12px; align-items: center; gap: 6px; flex-wrap: nowrap"
            v-if="hasActiveX25519Key && activeX25519PublicX"
          >
            <span>X25519:</span>
            <span
              class="x25519-key-text"
              :class="{ 'x25519-key-text-copied': showX25519CopyEffect }"
              :data-full-key="activeX25519PublicX"
              :title="activeX25519PublicX"
              role="button"
              tabindex="0"
              style="display: inline-block; min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom"
              @click="copyX25519PublicKey"
              @keydown.enter.prevent="copyX25519PublicKey"
              @keydown.space.prevent="copyX25519PublicKey"
            >
              {{ activeX25519PublicX }}
            </span>
            <span class="x25519-copy-badge" v-if="showX25519CopyEffect">Copied!</span>
          </div>
          <button
            class="btn sidebar-btn"
            type="button"
            style="width: 100%; display: flex; align-items: center; justify-content: space-between"
            @click="openX25519FilePicker"
          >
            <span style="display: inline-flex; align-items: center; gap: 8px">
              <FileUp :size="16" />
              {{ hasActiveX25519Key ? "Replace X25519 Key" : "Load X25519 Key" }}
            </span>
            <ChevronRight :size="14" />
          </button>
          <input
            ref="x25519FileInputRef"
            class="sr-only-input"
            type="file"
            accept=".json,application/json"
            aria-label="Select X25519 key file"
            @change="loadX25519SecretFromFile"
          />
          <p class="sidebar-status-error" v-if="x25519LoadError">{{ x25519LoadError }}</p>
        </div>
      </div>
    </aside>

    <section class="app-shell-content">
      <div class="container">
        <slot />
      </div>
    </section>

    <NotificationCenter />

    <div
      v-if="showWalletPopup"
      style="position: fixed; inset: 0; background: rgba(0,0,0,0.25); display: grid; place-items: center; z-index: 20"
      @click.self="showWalletPopup = false"
    >
      <div class="card stack" style="width: min(560px, 92vw)">
        <div class="row" style="justify-content: space-between; align-items: center">
          <h3 style="margin: 0">Select Wallet</h3>
          <button class="btn" type="button" aria-label="Close" @click="showWalletPopup = false">
            <X :size="14" />
          </button>
        </div>
        <p class="muted" style="margin: 0">Choose an extension account to connect:</p>

        <div class="stack" style="max-height: 300px; overflow: auto">
          <button
            v-for="account in formattedAccounts"
            :key="account.address"
            class="btn"
            type="button"
            style="display: flex; justify-content: space-between; align-items: center; text-align: left"
            @click="selectWallet(account.address)"
          >
            <span class="stack" style="gap: 2px">
              <strong>{{ account.name }}</strong>
              <span class="muted" style="font-size: 12px">{{ account.formattedAddress }}</span>
            </span>
            <span class="muted" style="font-size: 12px">{{ account.source }}</span>
          </button>
        </div>

        <p class="muted" style="margin: 0" v-if="!accounts.length">No wallet accounts available.</p>
      </div>
    </div>

  </main>
</template>

<style scoped>
.app-shell-root {
  display: flex;
  height: 100vh;
  overflow: hidden;
  background: var(--surface-bg);
}

.app-shell-sidebar {
  width: 260px;
  height: 100vh;
  border-right: 1px solid var(--border-default);
  background: var(--surface-card);
  display: flex;
  flex-direction: column;
  padding: 20px 14px;
  overflow-y: auto;
  flex-shrink: 0;
}

.app-shell-content {
  flex: 1;
  min-width: 0;
  padding: 24px;
  overflow: auto;
}

.sr-only-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.sidebar-status-error,
.sidebar-status-success {
  margin: 8px 0 0;
  font-size: 12px;
}

.sidebar-status-error {
  color: var(--status-error);
}

.sidebar-status-success {
  color: var(--color-primary);
}

.x25519-key-text {
  cursor: pointer;
  position: relative;
  transition: color 180ms ease;
}

.x25519-key-text-copied {
  color: var(--color-primary);
  animation: x25519-copy-pulse 900ms ease;
}

.wallet-address-text {
  cursor: pointer;
  position: relative;
  transition: color 180ms ease;
}

.wallet-address-text-copied {
  color: var(--color-primary);
  animation: x25519-copy-pulse 900ms ease;
}

.x25519-key-text:focus-visible {
  outline: 1px solid var(--border-default);
  border-radius: 4px;
}

.wallet-address-text:focus-visible {
  outline: 1px solid var(--border-default);
  border-radius: 4px;
}

.x25519-key-text:hover::after,
.x25519-key-text:focus-visible::after {
  content: attr(data-full-key);
  position: absolute;
  left: 50%;
  bottom: calc(100% + 10px);
  transform: translateX(-50%);
  background: #000;
  color: #fff;
  padding: 6px 8px;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.3;
  white-space: normal;
  min-width: 200px;
  max-width: min(420px, 78vw);
  word-break: break-all;
  z-index: 40;
  pointer-events: none;
}

.wallet-address-text:hover::after,
.wallet-address-text:focus-visible::after {
  content: attr(data-full-address);
  position: absolute;
  left: 50%;
  bottom: calc(100% + 10px);
  transform: translateX(-50%);
  background: #000;
  color: #fff;
  padding: 6px 8px;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.3;
  white-space: normal;
  min-width: 200px;
  max-width: min(420px, 78vw);
  word-break: break-all;
  z-index: 40;
  pointer-events: none;
}

.x25519-key-text:hover::before,
.x25519-key-text:focus-visible::before {
  content: "";
  position: absolute;
  left: 50%;
  bottom: calc(100% + 4px);
  transform: translateX(-50%);
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-top: 6px solid #000;
  z-index: 40;
  pointer-events: none;
}

.wallet-address-text:hover::before,
.wallet-address-text:focus-visible::before {
  content: "";
  position: absolute;
  left: 50%;
  bottom: calc(100% + 4px);
  transform: translateX(-50%);
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-top: 6px solid #000;
  z-index: 40;
  pointer-events: none;
}

.x25519-copy-badge {
  background: linear-gradient(135deg, #1f4660, #2f6f90);
  color: #e9f6ff;
  border: 1px solid #57a0c5;
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 11px;
  line-height: 1.2;
  animation: x25519-copy-float 850ms ease forwards;
  pointer-events: none;
}

.wallet-copy-badge {
  background: linear-gradient(135deg, #1f4660, #2f6f90);
  color: #e9f6ff;
  border: 1px solid #57a0c5;
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 11px;
  line-height: 1.2;
  animation: x25519-copy-float 850ms ease forwards;
  pointer-events: none;
}

@keyframes x25519-copy-pulse {
  0% {
    text-shadow: 0 0 0 rgba(87, 160, 197, 0);
  }

  30% {
    text-shadow: 0 0 10px rgba(87, 160, 197, 0.8);
  }

  100% {
    text-shadow: 0 0 0 rgba(87, 160, 197, 0);
  }
}

@keyframes x25519-copy-float {
  0% {
    opacity: 0;
    transform: translateY(5px) scale(0.95);
  }

  20% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }

  80% {
    opacity: 1;
    transform: translateY(-4px) scale(1);
  }

  100% {
    opacity: 0;
    transform: translateY(-8px) scale(0.97);
  }
}
</style>

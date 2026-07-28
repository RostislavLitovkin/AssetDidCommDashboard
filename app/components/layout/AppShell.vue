<script setup lang="ts">
import { ChevronRight, FileUp, Layers, Menu, MessageSquare, Settings, Trash2, UserRound, WandSparkles, Wallet, X } from "lucide-vue-next"
import { computed, ref } from "vue"
import NotificationCenter from "../common/NotificationCenter.vue"
import ProfileSetupBanners from "../common/ProfileSetupBanners.vue"
import WalletSelectModal from "../common/WalletSelectModal.vue"
import { useAddress } from "../../composables/useAddress"
import { useWallet } from "../../composables/useWallet"
import { X25519KeyService } from "../../services/crypto/x25519KeyService"
import { buildX25519KeyFile, downloadX25519KeyFile } from "../../services/crypto/x25519KeyFile"
import { useSettingsStore } from "../../stores/settings"

const wallet = useWallet()
const { formatAddress } = useAddress()
const settings = useSettingsStore()
const route = useRoute()

settings.initialize()

const showWalletPopup = ref(false)
const x25519LoadError = ref("")
const x25519LoadSuccess = ref("")
const walletCopyError = ref("")
const walletCopySuccess = ref("")
const x25519FileInputRef = ref<HTMLInputElement | null>(null)
const showX25519CopyEffect = ref(false)
const showWalletCopyEffect = ref(false)
const isTopbarExpanded = ref(false)
const isGeneratingX25519Key = ref(false)
const isConfirmingX25519Removal = ref(false)
const x25519KeyService = new X25519KeyService()
let x25519CopyEffectTimeout: ReturnType<typeof setTimeout> | undefined
let walletCopyEffectTimeout: ReturnType<typeof setTimeout> | undefined
const isWalletConnected = computed(() => wallet.walletStatus.value === "connected" && Boolean(wallet.accountAddress.value))
const connectedAddressFull = computed(() => wallet.accountAddress.value || "")
const connectedAddressLabel = computed(() => formatAddress(wallet.accountAddress.value || ""))
const activeX25519KeyKid = computed(() => settings.x25519SecretJwk?.kid || "")
const activeX25519PublicX = computed(() => settings.x25519SecretJwk?.x || "")
const hasActiveX25519Key = computed(() => Boolean(settings.x25519SecretJwk))
const isHeaderVisible = computed(() => {
  const cookie = useCookie('rxm.isHeaderVisible')
  const cookieValue = cookie.value

  // Cookie takes priority (persistent across navigations)
  if (cookieValue === 'false') return false
  if (cookieValue === 'true') return true

  // Fall back to query param (one-time override)
  const value = route.query.isHeaderVisible
  const normalizedValue = Array.isArray(value) ? value[0] : value

  return normalizedValue !== "false"
})

function openWalletPopup() {
  showWalletPopup.value = true
  isTopbarExpanded.value = false
}

function toggleTopbar(): void {
  isTopbarExpanded.value = !isTopbarExpanded.value
}

function collapseTopbar(): void {
  isTopbarExpanded.value = false
}

async function loadX25519SecretFromFile(event: Event) {
  x25519LoadError.value = ""
  x25519LoadSuccess.value = ""
  isConfirmingX25519Removal.value = false

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
  isTopbarExpanded.value = false
}

/**
 * Generates a key, hands the user the only copy, then adopts it. The download
 * happens before the key becomes active: if adopting were to fail afterwards,
 * the user would be left with an unrecoverable key, whereas a saved file can
 * always be loaded back through the file picker.
 */
async function generateX25519Key() {
  if (isGeneratingX25519Key.value) {
    return
  }

  isGeneratingX25519Key.value = true
  isConfirmingX25519Removal.value = false
  x25519LoadError.value = ""
  x25519LoadSuccess.value = ""

  try {
    const material = await x25519KeyService.generate()
    const keyFile = buildX25519KeyFile(material)

    downloadX25519KeyFile(keyFile)
    settings.setX25519SecretJwk({ publicJwk: material.publicJwk, privateJwk: material.privateJwk })

    x25519LoadSuccess.value = `New key in use and saved as ${keyFile.fileName}. That download is the only copy — keep it safe.`
  } catch (error) {
    x25519LoadError.value = error instanceof Error ? error.message : "Unable to generate an X25519 key"
  } finally {
    isGeneratingX25519Key.value = false
  }
}

function requestX25519Removal() {
  x25519LoadError.value = ""
  x25519LoadSuccess.value = ""
  isConfirmingX25519Removal.value = true
}

function cancelX25519Removal() {
  isConfirmingX25519Removal.value = false
}

function clearX25519Secret() {
  settings.clearX25519SecretJwk()
  isConfirmingX25519Removal.value = false
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
    <aside v-if="isHeaderVisible" class="app-shell-sidebar" :class="{ 'topbar-expanded': isTopbarExpanded }">
      <div class="sidebar-header">
        <NuxtLink class="sidebar-brand" to="/">
          <img src="@/assets/Images/realXmessenger.svg" alt="realXmessage" style="height: 40px; width: auto;" />
        </NuxtLink>
        <button class="btn sidebar-toggle" type="button" @click="toggleTopbar" :aria-expanded="isTopbarExpanded" aria-label="Toggle navigation">
          <X v-if="isTopbarExpanded" :size="16" />
          <Menu v-else :size="16" />
        </button>
      </div>

      <nav class="stack sidebar-nav" style="gap: 8px">
        <NuxtLink aria-label="Namespaces" class="btn sidebar-btn" to="/messages" style="display: flex; align-items: center; gap: 8px; text-decoration: none" @click="collapseTopbar">
          <Layers :size="16" />
          <span class="sidebar-label">Namespaces</span>
        </NuxtLink>
        <NuxtLink aria-label="Messages" class="btn sidebar-btn" to="/messages/my-buckets" style="display: flex; align-items: center; gap: 8px; text-decoration: none" @click="collapseTopbar">
          <MessageSquare :size="16" />
          <span class="sidebar-label">Messages</span>
        </NuxtLink>
        <NuxtLink aria-label="Profile" class="btn sidebar-btn" to="/profile" style="display: flex; align-items: center; gap: 8px; text-decoration: none" @click="collapseTopbar">
          <UserRound :size="16" />
          <span class="sidebar-label">Profile</span>
        </NuxtLink>
        <NuxtLink aria-label="Settings" class="btn sidebar-btn" to="/settings" style="display: flex; align-items: center; gap: 8px; text-decoration: none" @click="collapseTopbar">
          <Settings :size="16" />
          <span class="sidebar-label">Settings</span>
        </NuxtLink>
      </nav>

      <div class="sidebar-extra" style="margin-top: auto; padding-top: 16px; border-top: 1px solid var(--border-default)">
        <div
          class="row muted sidebar-inline-row"
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
            class="row muted sidebar-inline-row"
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

          <button
            v-if="!hasActiveX25519Key"
            class="btn sidebar-btn sidebar-btn-stacked"
            type="button"
            style="width: 100%; display: flex; align-items: center; justify-content: space-between"
            :disabled="isGeneratingX25519Key"
            @click="generateX25519Key"
          >
            <span style="display: inline-flex; align-items: center; gap: 8px">
              <WandSparkles :size="16" />
              {{ isGeneratingX25519Key ? "Generating…" : "Generate X25519 Key" }}
            </span>
            <ChevronRight :size="14" />
          </button>

          <template v-else>
            <button
              v-if="!isConfirmingX25519Removal"
              class="btn sidebar-btn sidebar-btn-stacked"
              type="button"
              style="width: 100%; display: flex; align-items: center; justify-content: space-between"
              @click="requestX25519Removal"
            >
              <span style="display: inline-flex; align-items: center; gap: 8px">
                <Trash2 :size="16" />
                <span class="sidebar-label">Remove X25519 Key</span>
              </span>
              <ChevronRight :size="14" />
            </button>
            <div v-else class="stack sidebar-btn-stacked" style="gap: 6px">
              <p class="muted sidebar-confirm-text">
                Removing the key is permanent. Messages encrypted to it stay locked unless you kept the key file.
              </p>
              <div class="row" style="gap: 6px; flex-wrap: nowrap">
                <button
                  class="btn sidebar-btn sidebar-btn-danger"
                  type="button"
                  style="flex: 1; justify-content: center"
                  @click="clearX25519Secret"
                >
                  Confirm remove
                </button>
                <button
                  class="btn sidebar-btn"
                  type="button"
                  style="flex: 1; justify-content: center"
                  @click="cancelX25519Removal"
                >
                  Cancel
                </button>
              </div>
            </div>
          </template>

          <p class="sidebar-status-error" v-if="x25519LoadError">{{ x25519LoadError }}</p>
          <p class="sidebar-status-success" v-if="x25519LoadSuccess">{{ x25519LoadSuccess }}</p>
        </div>
      </div>
    </aside>

    <section class="app-shell-content" :class="{ 'header-hidden': !isHeaderVisible }">
      <ProfileSetupBanners />
      <div class="container">
        <slot />
      </div>
    </section>

    <NotificationCenter />

    <WalletSelectModal v-if="showWalletPopup" @close="showWalletPopup = false" />

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
  overscroll-behavior: contain;
}

.app-shell-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: 24px;
  overflow: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
}

@media (max-width: 960px) {
  .app-shell-root {
    flex-direction: column;
    height: auto;
    min-height: 100vh;
  }

  /* Collapse sidebar into a compact topbar on small screens */
  .app-shell-sidebar {
    width: 100%;
    height: 56px;
    border-right: none;
    border-bottom: 1px solid var(--border-default);
    padding: 8px 12px;
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 30;
    display: flex;
    align-items: center;
    gap: 8px;
    overflow: hidden;
  }

  .app-shell-content {
    padding: 16px;
    padding-top: calc(56px + 16px);
    overflow: visible;
  }

  .app-shell-content.header-hidden {
    padding-top: 16px;
  }
}

.sr-only-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

/* Compact topbar styles for the sidebar on small screens */
.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: stretch;
  width: 100%;
}

.sidebar-header {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
}

.sidebar-brand {
  padding: 8px 8px 20px;
  text-decoration: none;
  color: inherit;
  display: inline-flex;
  align-items: center;
}

.app-shell-sidebar .sidebar-btn {
  width: 100%;
  justify-content: flex-start;
}

.sidebar-toggle {
  display: none;
}

@media (max-width: 960px) {
  .sidebar-header {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
  }

  .sidebar-brand {
    padding: 0;
    display: inline-flex;
    align-items: center;
    height: 40px;
  }

  .sidebar-toggle {
    display: inline-flex;
    margin-left: auto;
    width: 40px;
    height: 40px;
    padding: 0;
    font-size: 12px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
  }

  .sidebar-toggle svg {
    display: block;
  }

  .sidebar-nav,
  .sidebar-extra {
    display: none;
  }

  .app-shell-sidebar.topbar-expanded {
    height: 100vh;
    align-items: flex-start;
    overflow-y: auto;
    padding-bottom: 24px;
    overscroll-behavior: contain;
  }

  .app-shell-sidebar.topbar-expanded .sidebar-nav,
  .app-shell-sidebar.topbar-expanded .sidebar-extra {
    display: flex;
    flex-direction: column;
    width: 100%;
    margin-top: 12px;
  }

  .app-shell-sidebar.topbar-expanded .sidebar-btn {
    width: 100%;
    justify-content: flex-start;
    font-size: 14px;
  }

  .app-shell-sidebar.topbar-expanded .sidebar-btn .sidebar-label {
    display: inline-block;
  }

  .sidebar-btn {
    padding: 8px;
    border-radius: 8px;
    min-width: 0;
    font-size: 0; /* hide label text visually */
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .sidebar-btn svg {
    margin: 0;
  }

  .sidebar-label {
    display: inline-block;
    font-size: 14px;
    margin-left: 6px;
  }

  /* hide labels but keep for larger small screens if space allows */
  .sidebar-btn .sidebar-label {
    display: none;
  }

  /* show small app title as minimal text */
  .app-shell-sidebar h2 {
    font-size: 14px;
    margin: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

@media (min-width: 480px) and (max-width: 960px) {
  /* allow labels to show on slightly larger small screens */
  .sidebar-btn {
    font-size: inherit;
    padding: 8px 10px;
  }

  .sidebar-btn .sidebar-label {
    display: inline-block;
  }
}

.sidebar-btn-stacked {
  margin-top: 8px;
}

.sidebar-btn-danger {
  color: var(--status-error);
  border-color: color-mix(in srgb, var(--status-error) 45%, transparent);
}

.sidebar-confirm-text {
  margin: 0;
  font-size: 12px;
  line-height: 1.4;
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

@media (max-width: 960px) {
  .wallet-address-text,
  .x25519-key-text {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sidebar-inline-row {
    flex-direction: row;
    align-items: center;
    flex-wrap: nowrap;
  }
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

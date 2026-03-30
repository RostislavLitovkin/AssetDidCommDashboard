<script setup lang="ts">
import { ChevronRight, Fingerprint, MessageSquare, Wallet, X } from "lucide-vue-next"
import NotificationCenter from "../common/NotificationCenter.vue"

const wallet = useWallet()
const showWalletPopup = ref(false)
const accounts = ref<Array<{ address: string; name: string; source: string }>>([])

async function openWalletPopup() {
  showWalletPopup.value = true
  accounts.value = await wallet.listAccounts()
}

async function selectWallet(address: string) {
  await wallet.connectToAddress(address)
  showWalletPopup.value = false
}
</script>

<template>
  <main style="display: flex; min-height: 100vh; background: var(--surface-bg)">
    <aside
      style="width: 260px; border-right: 1px solid var(--border-default); background: var(--surface-card); display: flex; flex-direction: column; padding: 20px 14px"
    >
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
      </nav>

      <div style="margin-top: auto; padding-top: 16px">
        <p class="muted" style="margin: 0 0 8px; font-size: 12px" v-if="wallet.accountAddress">
          Connected:
          <span
            :title="wallet.accountAddress"
            style="display: inline-block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom"
          >
            {{ wallet.accountAddress }}
          </span>
        </p>
        <p class="muted" style="margin: 0 0 8px; font-size: 12px" v-if="wallet.providerName">
          Provider: {{ wallet.providerName }}
        </p>
        <p class="muted" style="margin: 0 0 8px; font-size: 12px" v-if="!wallet.accountAddress">
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
            {{ wallet.accountAddress ? "Switch Wallet" : "Connect Wallet" }}
          </span>
          <ChevronRight :size="14" />
        </button>
      </div>
    </aside>

    <section style="flex: 1; padding: 24px">
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
        <p class="muted" style="margin: 0">Choose an extension account to connect or switch.</p>

        <div class="stack" style="max-height: 300px; overflow: auto">
          <button
            v-for="account in accounts"
            :key="account.address"
            class="btn"
            type="button"
            style="display: flex; justify-content: space-between; align-items: center; text-align: left"
            @click="selectWallet(account.address)"
          >
            <span class="stack" style="gap: 2px">
              <strong>{{ account.name }}</strong>
              <span class="muted" style="font-size: 12px">{{ account.address }}</span>
            </span>
            <span class="muted" style="font-size: 12px">{{ account.source }}</span>
          </button>
        </div>

        <p class="muted" style="margin: 0" v-if="!accounts.length">No wallet accounts available.</p>
      </div>
    </div>
  </main>
</template>

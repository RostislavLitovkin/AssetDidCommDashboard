<script setup lang="ts">
import { Plug, Unplug } from "lucide-vue-next"

const props = defineProps<{
  walletStatus: string
  accountAddress: string
  providerName: string
}>()

const emit = defineEmits<{
  connect: []
  disconnect: []
}>()
</script>

<template>
  <section class="card stack" aria-label="Wallet connection">
    <div class="row" style="justify-content: space-between; align-items: center">
      <h2 style="margin: 0">Wallet</h2>
      <OperationStatusBadge
        :status="walletStatus === 'connected' ? 'success' : walletStatus === 'connecting' ? 'info' : walletStatus === 'rejected' ? 'error' : 'warning'"
      />
    </div>

    <p class="muted" style="margin: 0">
      {{ accountAddress ? `Account: ${accountAddress}` : "No wallet connected" }}
    </p>
    <p class="muted" style="margin: 0" v-if="providerName">Provider: {{ providerName }}</p>

    <div class="row">
      <button
        class="btn btn-primary"
        type="button"
        @click="emit('connect')"
        :disabled="walletStatus === 'connecting'"
      >
        <Plug :size="16" style="vertical-align: text-bottom; margin-right: 4px" /> Connect
      </button>
      <button class="btn" type="button" @click="emit('disconnect')">
        <Unplug :size="16" style="vertical-align: text-bottom; margin-right: 4px" /> Disconnect
      </button>
    </div>
  </section>
</template>

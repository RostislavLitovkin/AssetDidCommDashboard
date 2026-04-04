<script setup lang="ts">
import type { DidRecord } from "~/app/types/did"
import LoadingBar from "../common/LoadingBar.vue"

const props = defineProps<{
  loading: boolean
  didRecord: DidRecord | null
}>()

const emit = defineEmits<{ refresh: [] }>()
</script>

<template>
  <section class="card stack" aria-label="DID lookup">
    <div class="row" style="justify-content: space-between; align-items: center">
      <h2 style="margin: 0">DID Lookup</h2>
      <button class="btn" type="button" @click="emit('refresh')" :disabled="loading">
        {{ loading ? "Refreshing..." : "Refresh DID" }}
      </button>
    </div>

    <LoadingBar v-if="loading" label="Refreshing DID record..." />

    <template v-if="didRecord">
      <div class="row" style="align-items: center">
        <span class="muted">Status:</span>
        <OperationStatusBadge :status="didRecord.status === 'failed' ? 'error' : didRecord.status === 'not_found' ? 'warning' : 'success'" />
      </div>
      <p class="muted" style="margin: 0">Source: {{ didRecord.source }}</p>
      <p style="margin: 0">DID: {{ didRecord.didUri || "N/A" }}</p>
      <p class="muted" style="margin: 0" v-if="didRecord.lastRefreshedAt">Last refreshed: {{ didRecord.lastRefreshedAt }}</p>
      <p style="margin: 0" v-if="didRecord.errorMessage">{{ didRecord.errorMessage }}</p>
    </template>
    <p class="muted" v-else style="margin: 0">No DID lookup performed yet.</p>
  </section>
</template>

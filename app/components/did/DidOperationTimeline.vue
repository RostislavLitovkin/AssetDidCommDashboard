<script setup lang="ts">
import type { OperationLogEntry } from "~/app/types/operations"

const props = defineProps<{ entries: OperationLogEntry[] }>()
</script>

<template>
  <section class="card stack" aria-label="Operation timeline">
    <h2 style="margin: 0">Operation Timeline</h2>
    <p class="muted" style="margin: 0" v-if="!props.entries.length">No operations yet.</p>
    <article class="card" v-for="entry in props.entries" :key="entry.entryId">
      <div class="row" style="justify-content: space-between; align-items: center">
        <strong>{{ entry.category }}</strong>
        <OperationStatusBadge :status="entry.status" />
      </div>
      <p style="margin: 8px 0 0">{{ entry.message }}</p>
      <p class="muted" style="margin: 6px 0 0">{{ entry.targetRef }} · {{ entry.timestamp }}</p>
    </article>
  </section>
</template>

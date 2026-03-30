<script setup lang="ts">
const did = useDid()
const operations = useOperationsStore()
</script>

<template>
  <div class="stack">
    <DidLookupPanel :loading="did.loading" :did-record="did.didRecord" @refresh="did.fetchDid" />

    <div class="row" style="align-items: flex-start">
      <div class="stack" style="flex: 1">
        <DidRegistrationForm @submit="did.registerDid" />
        <DidUpdateForm @submit="did.updateDid" />
      </div>
      <div style="flex: 1">
        <DidOperationTimeline :entries="operations.entries" />
      </div>
    </div>
  </div>
</template>

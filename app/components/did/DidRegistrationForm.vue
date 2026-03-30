<script setup lang="ts">
const emit = defineEmits<{ submit: [details: Record<string, unknown>] }>()
const displayName = ref("")

function onSubmit() {
  emit("submit", { displayName: displayName.value })
}
</script>

<template>
  <form class="card stack" @submit.prevent="onSubmit" aria-label="DID registration form">
    <h3 style="margin: 0">Register DID</h3>
    <label class="stack">
      <span class="muted">Display name</span>
      <input class="input" v-model="displayName" required />
    </label>
    <button class="btn btn-primary" type="submit">Confirm Registration</button>
  </form>
</template>

<script setup lang="ts">
const emit = defineEmits<{ submit: [details: Record<string, unknown>] }>()
const category = ref("")

function onSubmit() {
  emit("submit", { category: category.value })
}
</script>

<template>
  <form class="card stack" @submit.prevent="onSubmit" aria-label="DID update form">
    <h3 style="margin: 0">Update DID</h3>
    <label class="stack">
      <span class="muted">Category</span>
      <input class="input" v-model="category" required />
    </label>
    <button class="btn" type="submit">Confirm Update</button>
  </form>
</template>

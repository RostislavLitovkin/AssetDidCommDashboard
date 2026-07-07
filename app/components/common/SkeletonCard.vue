<script setup lang="ts">
interface Props {
  count?: number
  lines?: number
}

withDefaults(defineProps<Props>(), {
  count: 3,
  lines: 2
})
</script>

<template>
  <div class="skeleton-list">
    <div v-for="index in count" :key="`skeleton-${index}`" class="skeleton-card">
      <div v-for="line in lines" :key="`line-${line}`" class="skeleton-bar" :class="`skeleton-line-${line}`" />
    </div>
  </div>
</template>

<style scoped>
.skeleton-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.skeleton-card {
  border-radius: 12px;
  border: 1px solid var(--border-default);
  background: #fafafa;
  padding: 16px;
}

.skeleton-bar {
  display: block;
  height: 14px;
  background: #d0d0d0;
  border-radius: 4px;
  margin-bottom: 8px;
}

.skeleton-bar:last-child {
  margin-bottom: 0;
}

.skeleton-line-1 {
  height: 16px;
  width: 60%;
}

.skeleton-line-2 {
  height: 14px;
  width: 80%;
}
</style>
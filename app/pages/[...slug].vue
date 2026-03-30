<script setup lang="ts">
</script>

<template>
  <section class="not-found-page">
    <div class="not-found-content">
      <p class="not-found-status">404</p>
      <NuxtLink to="/" class="btn btn-primary not-found-btn">Go to dashboard</NuxtLink>
    </div>
  </section>
</template>

<style scoped>
.not-found-page {
  min-height: calc(100vh - 48px);
  display: grid;
  place-items: center;
  padding: 16px;
}

.not-found-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.not-found-status {
  margin: 0;
  font-size: clamp(72px, 18vw, 160px);
  line-height: 1;
  font-weight: 700;
  color: var(--color-primary);
}

.not-found-btn {
  text-decoration: none;
}
</style>

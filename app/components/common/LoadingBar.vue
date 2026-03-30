<script setup lang="ts">
withDefaults(
  defineProps<{
    label?: string
  }>(),
  {
    label: "Loading..."
  }
)
</script>

<template>
  <div class="loading-bar-wrap" role="status" aria-live="polite">
    <span class="loading-bar-label">{{ label }}</span>
    <div class="loading-bar-track" aria-hidden="true">
      <div class="loading-bar-indicator" />
    </div>
  </div>
</template>

<style scoped>
.loading-bar-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.loading-bar-label {
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.loading-bar-track {
  position: relative;
  width: 100%;
  height: 10px;
  border-radius: 999px;
  background: var(--color-gray-200);
  overflow: hidden;
}

.loading-bar-indicator {
  position: absolute;
  top: 0;
  left: 0;
  width: 24%;
  height: 100%;
  border-radius: 999px;
  background: var(--color-primary);
  animation: loading-slide 1.2s ease-in-out infinite;
}

@keyframes loading-slide {
  0% {
    transform: translateX(0);
  }
  50% {
    transform: translateX(calc(316.6667%));
  }
  100% {
    transform: translateX(0);
  }
}
</style>
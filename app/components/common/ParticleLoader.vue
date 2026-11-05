<script setup lang="ts">
import { computed } from "vue"

type LoaderSize = "inline" | "block" | "page"

const props = withDefaults(
  defineProps<{
    label?: string
    size?: LoaderSize
  }>(),
  {
    label: "Loading...",
    size: "block"
  }
)

const text = computed(() => (props.size === "inline" ? "" : props.label))
const ariaLabel = computed(() => props.label || "Loading")
</script>

<template>
  <div
    class="particle-loader"
    :class="`particle-loader--${size}`"
    role="status"
    aria-live="polite"
    :aria-label="text ? undefined : ariaLabel"
  >
    <span v-if="text" class="particle-loader-label">{{ text }}</span>
  </div>
</template>

<style scoped>
.particle-loader {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: center;
  justify-content: center;
  width: 100%;
  overflow: hidden;
}

.particle-loader--inline {
  height: 22px;
  min-width: 48px;
}

.particle-loader--block {
  height: 120px;
}

.particle-loader--page {
  height: 100%;
  min-height: 220px;
}

.particle-loader-label {
  position: relative;
  z-index: 1;
  max-width: 80%;
  color: var(--text-secondary);
  font-size: 0.9rem;
  text-align: center;
  overflow-wrap: anywhere;
}

.particle-loader--page .particle-loader-label {
  font-size: 1rem;
}
</style>

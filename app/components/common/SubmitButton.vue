<script setup lang="ts">
import { computed } from "vue"
import { Check, RotateCw } from "lucide-vue-next"
import type { SubmitPhase } from "../../composables/useSubmitState"
import { resolveSubmitButtonView, type SubmitButtonLabels } from "./submitButtonView"

const props = withDefaults(
  defineProps<{
    phase: SubmitPhase
    labels: SubmitButtonLabels
    disabled?: boolean
    type?: "button" | "submit"
  }>(),
  { disabled: false, type: "button" }
)

const emit = defineEmits<{ click: [] }>()

const view = computed(() => resolveSubmitButtonView(props.phase, props.labels, props.disabled))
const busy = computed(() => props.phase === "signing" || props.phase === "submitting")
</script>

<template>
  <button
    class="btn btn-primary submit-button"
    :class="`submit-button-${view.variant}`"
    :type="props.type"
    :disabled="view.disabled"
    :aria-busy="busy"
    @click="emit('click')"
  >
    <span v-if="view.icon === 'spinner'" class="submit-button-spinner" aria-hidden="true" />
    <Check v-else-if="view.icon === 'check'" :size="16" aria-hidden="true" />
    <RotateCw v-else-if="view.icon === 'retry'" :size="16" aria-hidden="true" />
    <slot v-else name="icon" />
    <span aria-live="polite">{{ view.label }}</span>
  </button>
</template>

<style scoped>
.submit-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  white-space: nowrap;
}

.submit-button-success:disabled,
.submit-button-success {
  background: var(--status-success);
  border-color: var(--status-success);
  color: var(--color-white);
  opacity: 1;
}

.submit-button-error {
  background: var(--status-error);
  border-color: var(--status-error);
  color: var(--color-white);
}

.submit-button-spinner {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid color-mix(in srgb, var(--color-white) 40%, transparent);
  border-top-color: var(--color-white);
  animation: submit-button-spin 700ms linear infinite;
}

@keyframes submit-button-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>

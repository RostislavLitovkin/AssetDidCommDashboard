<script setup lang="ts">
const props = defineProps<{ status: "success" | "warning" | "error" | "info" }>()

const styleMap: Record<string, string> = {
  success: "background:#e8f4ee;color:#2f6f4f;border-color:#b7d7c6",
  warning: "background:#fff4e1;color:#7f6125;border-color:#f1d6a0",
  error: "background:#fdeaea;color:#7f2f2f;border-color:#f1b6b6",
  info: "background:#edf4fa;color:#335f7a;border-color:#bfd7e7"
}
</script>

<template>
  <span
    :style="`padding:2px 8px;border:1px solid;border-radius:999px;font-size:12px;text-transform:capitalize;${styleMap[props.status]}`"
  >
    {{ props.status }}
  </span>
</template>

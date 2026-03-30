<script setup lang="ts">
import { Download, FileUp, KeyRound, WandSparkles } from "lucide-vue-next"
import type { KeyMaterial } from "~/app/types/keys"

const props = defineProps<{ activeKey: KeyMaterial | null }>()
const emit = defineEmits<{
  generate: []
  import: [payload: string]
  export: []
}>()

const importValue = ref("")

function submitImport() {
  emit("import", importValue.value)
  importValue.value = ""
}
</script>

<template>
  <section class="card stack" aria-label="Key management">
    <h2 style="margin: 0">X25519 Keys</h2>

    <div class="row">
      <button class="btn btn-primary" type="button" @click="emit('generate')">
        <WandSparkles :size="16" style="vertical-align: text-bottom; margin-right: 4px" /> Generate
      </button>
      <button class="btn" type="button" @click="emit('export')" :disabled="!props.activeKey">
        <Download :size="16" style="vertical-align: text-bottom; margin-right: 4px" /> Export
      </button>
    </div>

    <label class="stack">
      <span class="muted">Import key JSON</span>
      <textarea class="input" rows="4" v-model="importValue" aria-label="Import key JSON" />
    </label>
    <button class="btn" type="button" @click="submitImport" :disabled="!importValue.trim()">
      <FileUp :size="16" style="vertical-align: text-bottom; margin-right: 4px" /> Import
    </button>

    <div class="card" v-if="props.activeKey">
      <p style="margin: 0"><KeyRound :size="14" style="vertical-align: text-bottom" /> Key ID: {{ props.activeKey.keyId }}</p>
      <p class="muted" style="margin: 6px 0 0">
        {{ props.activeKey.algorithm }} · {{ props.activeKey.origin }} · {{ props.activeKey.validationState }}
      </p>
    </div>
  </section>
</template>

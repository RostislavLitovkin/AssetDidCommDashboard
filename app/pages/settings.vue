<script setup lang="ts">
import { computed, ref } from "vue"
import { useSettingsStore } from "../stores/settings"

const settings = useSettingsStore()
settings.initialize()

const ss58PrefixInput = ref(String(settings.ss58Prefix))
const saveError = ref("")
const saveSuccess = ref("")

const showMessageDebug = computed({
  get: () => settings.showMessageDebug,
  set: (value: boolean) => settings.setShowMessageDebug(value)
})

function saveSettings(): void {
  saveError.value = ""
  saveSuccess.value = ""

  try {
    const parsed = Number.parseInt(ss58PrefixInput.value, 10)
    settings.setSs58Prefix(parsed)
    ss58PrefixInput.value = String(settings.ss58Prefix)
    saveSuccess.value = "Saved"
  } catch (error) {
    saveError.value = error instanceof Error ? error.message : "Unable to save"
  }
}
</script>

<template>
  <main class="stack settings-page">
    <section class="card stack" style="gap: 10px" aria-live="polite">
      <label class="stack" style="gap: 6px">
        <span>SS58 Prefix</span>
        <div style="display: flex; gap: 8px; align-items: flex-end">
          <input
            v-model="ss58PrefixInput"
            class="input"
            type="number"
            min="0"
            max="16383"
            step="1"
            inputmode="numeric"
            placeholder="42"
            style="flex: 1"
          />
          <button class="btn btn-primary" type="button" @click="saveSettings" style="white-space: nowrap">
            Save
          </button>
        </div>
      </label>
      <p v-if="saveError" class="error-text">{{ saveError }}</p>
      <p v-if="saveSuccess" class="success-text">{{ saveSuccess }}</p>
    </section>

    <section class="card stack" style="gap: 10px">
      <label class="toggle-row">
        <input v-model="showMessageDebug" type="checkbox" />
        <span>Show debug data</span>
      </label>
      <span>This will display extra data like on-chain ids, block numbers and extra debugging windows. Keep disabled if you are unsure what this does.</span>

    </section>
  </main>
</template>

<style scoped>
.settings-page {
  padding: 16px;
  max-width: 720px;
  margin: 0 auto;
}

.error-text {
  margin: 0;
  color: var(--status-error);
}

.success-text {
  margin: 0;
  color: var(--status-success);
}

.toggle-row {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-weight: 500;
}

.toggle-row input {
  width: 18px;
  height: 18px;
}

@media (max-width: 720px) {
  .settings-page {
    padding: 12px;
  }

  .settings-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .settings-actions .btn {
    width: 100%;
  }

  .toggle-row {
    width: 100%;
  }
}
</style>

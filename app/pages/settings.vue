<script setup lang="ts">
import { computed, ref } from "vue"
import { useSettingsStore } from "../stores/settings"

const settings = useSettingsStore()
settings.initialize()

const ss58PrefixInput = ref(String(settings.ss58Prefix))
const saveError = ref("")
const saveSuccess = ref("")

const currentPrefix = computed(() => settings.ss58Prefix)
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
    saveSuccess.value = "SS58 prefix saved. Address formatting has been updated across the dashboard."
  } catch (error) {
    saveError.value = error instanceof Error ? error.message : "Unable to save SS58 prefix"
  }
}

function resetToCurrent(): void {
  ss58PrefixInput.value = String(settings.ss58Prefix)
  saveError.value = ""
  saveSuccess.value = ""
}
</script>

<template>
  <main class="stack settings-page">
    <header class="card stack" style="gap: 8px">
      <h1 style="margin: 0">Settings</h1>
      <p class="muted" style="margin: 0">
        Configure the dashboard to your needs.
      </p>
    </header>

    <section class="card stack" style="gap: 10px" aria-live="polite">
      <p class="muted" style="margin: 0">Current saved prefix: <strong>{{ currentPrefix }}</strong></p>

      <label class="stack" style="gap: 6px">
        <span>SS58 Prefix</span>
        <input
          v-model="ss58PrefixInput"
          class="input"
          type="number"
          min="0"
          max="16383"
          step="1"
          inputmode="numeric"
          placeholder="42"
        />
      </label>

      <div class="row settings-actions" style="justify-content: flex-end; gap: 8px">
        <button class="btn" type="button" @click="resetToCurrent">Reset</button>
        <button class="btn btn-primary" type="button" @click="saveSettings">Save</button>
      </div>

      <p v-if="saveError" class="error-text">{{ saveError }}</p>
      <p v-if="saveSuccess" class="success-text">{{ saveSuccess }}</p>
    </section>

    <section class="card stack" style="gap: 10px">
      <h2 style="margin: 0">Message Debugging</h2>
      <p class="muted" style="margin: 0">
        Show collapsible debug data in message threads, including IPFS references and message IDs.
      </p>
      <label class="toggle-row">
        <input v-model="showMessageDebug" type="checkbox" />
        <span>Show message debug data</span>
      </label>
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

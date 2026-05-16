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

const notificationsEnabled = computed({
  get: () => settings.notificationsEnabled,
  set: (value: boolean) => settings.setNotificationsEnabled(value)
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
  <main class="stack">
    <div class="row buckets-header" style="justify-content: space-between; align-items: center">
      <div class="row" style="gap: 12px; align-items: center">
        <div class="stack" style="gap: 4px">
          <h3 style="margin: 0">Settings</h3>
        </div>
      </div>
    </div>

    <section class="card stack" style="gap: 10px" aria-live="polite">
      <h4 style="margin: 0; font-size: 16px;">Chain Configuration</h4>
      <label class="stack" style="gap: 6px">
        <span style="font-weight: 600; font-size: 14px;">SS58 Prefix</span>
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
      <h4 style="margin: 0; font-size: 16px;">Notifications</h4>
      <label class="toggle-row">
        <input v-model="notificationsEnabled" type="checkbox" />
        <span>Enable notifications</span>
      </label>
      <span class="muted" style="font-size: 13px;">Disabled by default. When off, notification popups are hidden.</span>
    </section>

    <section class="card stack" style="gap: 10px">
      <h4 style="margin: 0; font-size: 16px;">Developer Options</h4>
      <label class="toggle-row">
        <input v-model="showMessageDebug" type="checkbox" />
        <span>Show debug data</span>
      </label>
      <span class="muted" style="font-size: 13px;">This will display extra data like on-chain ids, block numbers and extra debugging windows. Keep disabled if you are unsure what this does.</span>
    </section>
  </main>
</template>

<style scoped>
.error-text {
  margin: 0;
  color: var(--status-error);
  font-size: 13px;
}

.success-text {
  margin: 0;
  color: var(--status-success);
  font-size: 13px;
}

.toggle-row {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-weight: 600;
  font-size: 14px;
}

.toggle-row input {
  width: 18px;
  height: 18px;
}

@media (max-width: 720px) {
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

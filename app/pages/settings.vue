<script setup lang="ts">
import { computed, ref } from "vue"
import { Check } from "lucide-vue-next"
import { useSettingsStore } from "../stores/settings"
import { PRIMARY_COLOR_OPTIONS } from "../services/theme/primaryColor"
import PageHeader from "../components/common/PageHeader.vue"

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

function selectPrimaryColor(color: string): void {
  settings.setPrimaryColor(color)
}
</script>

<template>
  <main class="stack">
    <PageHeader title="Settings" />

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
      <h4 style="margin: 0; font-size: 16px;">Appearance</h4>
      <span style="font-weight: 600; font-size: 14px;">Primary color</span>
      <div class="swatch-row">
        <button
          v-for="option in PRIMARY_COLOR_OPTIONS"
          :key="option.value"
          type="button"
          class="swatch"
          :class="{ 'swatch-active': option.value === settings.primaryColor }"
          :style="`--swatch-color: ${option.value}`"
          :aria-label="option.name"
          :aria-pressed="option.value === settings.primaryColor"
          @click="selectPrimaryColor(option.value)"
        >
          <span class="swatch-chip" aria-hidden="true">
            <Check v-if="option.value === settings.primaryColor" class="swatch-check" :size="14" />
          </span>
          <span>{{ option.name }}</span>
        </button>
      </div>
      <span class="muted" style="font-size: 13px;">Sets the app's accent color. Applied immediately.</span>
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

.swatch-row {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.swatch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--border-default);
  border-radius: 10px;
  background: var(--surface-card);
  color: var(--text-primary);
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
}

.swatch:hover,
.swatch:focus-visible {
  border-color: var(--swatch-color);
}

.swatch-active {
  border-color: var(--swatch-color);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--swatch-color) 30%, transparent);
}

.swatch-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  background: var(--swatch-color);
}

.swatch-check {
  color: var(--color-white);
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

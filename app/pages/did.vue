<script setup lang="ts">
import { Keyring } from "@polkadot/keyring"
import { cryptoWaitReady, mnemonicGenerate } from "@polkadot/util-crypto"
import { computed } from "vue"
import { ref } from "vue"
import { X25519KeyService } from "../services/crypto/x25519KeyService"
import type { KeyMaterial } from "../types/keys"

const ss58Format = 42
const mnemonic = ref("")
const ss58Address = ref("")
const generatingMnemonic = ref(false)
const mnemonicError = ref<string | null>(null)
const mnemonicCopied = ref(false)

const keyService = new X25519KeyService()
const keyMaterial = ref<KeyMaterial | null>(null)
const generatingJwk = ref(false)
const jwkError = ref<string | null>(null)

const jwkJson = computed(() => (keyMaterial.value ? keyService.export(keyMaterial.value) : ""))
const hasJwk = computed(() => Boolean(jwkJson.value))

async function generateMnemonic(): Promise<void> {
  generatingMnemonic.value = true
  mnemonicError.value = null
  mnemonicCopied.value = false

  try {
    await cryptoWaitReady()
    const nextMnemonic = mnemonicGenerate()
    const keyring = new Keyring({ type: "sr25519", ss58Format })
    const account = keyring.addFromUri(nextMnemonic)

    mnemonic.value = nextMnemonic
    ss58Address.value = account.address
  } catch (error) {
    mnemonicError.value = error instanceof Error ? error.message : "Failed to generate mnemonic account"
  } finally {
    generatingMnemonic.value = false
  }
}

async function copyMnemonic(): Promise<void> {
  if (!import.meta.client || !mnemonic.value) {
    return
  }

  try {
    await navigator.clipboard.writeText(mnemonic.value)
    mnemonicCopied.value = true
    setTimeout(() => {
      mnemonicCopied.value = false
    }, 1800)
  } catch {
    mnemonicError.value = "Clipboard copy failed"
  }
}

async function generateJwk(): Promise<void> {
  generatingJwk.value = true
  jwkError.value = null

  try {
    keyMaterial.value = await keyService.generate()
  } catch (error) {
    jwkError.value = error instanceof Error ? error.message : "Failed to generate X25519 JWK"
  } finally {
    generatingJwk.value = false
  }
}

function downloadJson(): void {
  if (!import.meta.client || !jwkJson.value) {
    return
  }

  const fileName = `x25519-jwk-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
  const blob = new Blob([jwkJson.value], { type: "application/json" })
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement("a")

  link.href = objectUrl
  link.download = fileName
  link.click()

  URL.revokeObjectURL(objectUrl)
}

const mnemonicWords = computed(() => (mnemonic.value ? mnemonic.value.split(" ").filter(Boolean) : []))
</script>

<template>
  <main class="container did-page stack">
    <header class="stack page-header">
      <h1 class="page-title">DID management</h1>
    </header>

    <section class="card stack">
      <div class="row section-header">
        <h2 style="margin: 0">DID (Sr25519) Key</h2>
        <div class="row">
          <button class="btn btn-primary" type="button" @click="generateMnemonic" :disabled="generatingMnemonic">
            {{ generatingMnemonic ? "Generating..." : "Generate Mnemonic" }}
          </button>
          <button class="btn" type="button" @click="copyMnemonic" :disabled="!mnemonic">
            {{ mnemonicCopied ? "Copied" : "Copy Mnemonic" }}
          </button>
        </div>
      </div>

      <p v-if="mnemonicError" class="error-text">{{ mnemonicError }}</p>

      <div v-if="mnemonicWords.length" class="mnemonic-grid" aria-label="Generated mnemonic words">
        <span v-for="(word, index) in mnemonicWords" :key="`${index}-${word}`" class="mnemonic-word">
          {{ index + 1 }}. {{ word }}
        </span>
      </div>

      <div v-if="ss58Address" class="address-card">
        <p class="muted" style="margin: 0">SS58 Address</p>
        <p style="margin: 4px 0 0" class="address-value">{{ ss58Address }}</p>
      </div>
    </section>

    <section class="card stack">
      <div class="row section-header">
        <h2 style="margin: 0">X25519 Key</h2>
        <div class="row">
          <button class="btn btn-primary" type="button" @click="generateJwk" :disabled="generatingJwk">
            {{ generatingJwk ? "Generating..." : "Generate X25519" }}
          </button>
          <button class="btn" type="button" @click="downloadJson" :disabled="!hasJwk">Download JSON</button>
        </div>
      </div>

      <p v-if="jwkError" class="error-text">{{ jwkError }}</p>

      <div v-if="hasJwk" class="address-card">
        <pre v-if="hasJwk" class="address-value" aria-label="Generated JWK JSON">{{ jwkJson }}</pre>
      </div>
    </section>
  </main>
</template>

<style scoped>
.did-page {
  padding-top: 12px;
  padding-bottom: 24px;
}

.page-header {
  gap: 4px;
}

.page-title {
  margin: 0;
  font-size: clamp(1.5rem, 2.2vw, 2rem);
}

.page-subtitle {
  margin: 0;
  max-width: 76ch;
}

.section-header {
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
}

.mnemonic-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 8px;
}

.mnemonic-word {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  border: 1px solid var(--border-default);
  border-radius: 8px;
  padding: 4px 8px;
  background: color-mix(in srgb, var(--surface-bg) 68%, var(--surface-card));
}

.address-card {
  border: 1px solid var(--border-default);
  border-radius: 8px;
  padding: 10px 12px;
  background: color-mix(in srgb, var(--surface-bg) 70%, var(--surface-card));
}

.address-value {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  overflow-wrap: anywhere;
}

.jwk-json {
  margin: 0;
  max-height: 360px;
  overflow: auto;
  border: 1px solid var(--border-default);
  border-radius: 8px;
  padding: 12px;
  background: var(--color-gray-900);
  color: var(--color-gray-50);
  font-size: 0.86rem;
  line-height: 1.5;
}

.error-text {
  margin: 0;
  color: var(--status-error);
}
</style>

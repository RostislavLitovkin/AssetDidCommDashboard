<script setup lang="ts">
import { DidCommRepository, type BucketMessage, type ExtrinsicUpdate } from "../../../services/papi/didCommRepository"
import { computed, nextTick, onMounted, ref, watch } from "vue"
import { useNuxtApp, useRoute } from "nuxt/app"
import { useOperationsStore } from "../../../stores/operations"
import { useSessionStore } from "../../../stores/session"

const route = useRoute()
const { $papiClient } = useNuxtApp()
const session = useSessionStore()
const operations = useOperationsStore()
const didCommRepository = new DidCommRepository(
  $papiClient as { rpc(method: string, params?: unknown[]): Promise<unknown>; getEndpoint?(): string }
)

type DeliveryState = "sending" | "sent" | "failed"

interface PendingChatMessage {
  id: string
  body: string
  createdAt: Date
  sender?: string
  deliveryState: DeliveryState
}

interface ChatMessage {
  id: string
  body: string
  createdAt: Date
  outgoing: boolean
  senderLabel: string
  deliveryState?: DeliveryState
}

const bucketId = computed(() => {
  const rawId = route.params.id
  const value = Array.isArray(rawId) ? (rawId[0] ?? "") : (rawId ?? "")

  try {
    return decodeURIComponent(String(value))
  } catch {
    return String(value)
  }
})

const messages = ref<BucketMessage[]>([])
const messagesLoading = ref(false)
const messagesError = ref("")
const sendText = ref("")
const sendError = ref("")
const sending = ref(false)
const pendingMessages = ref<PendingChatMessage[]>([])
const chatViewport = ref<HTMLElement | null>(null)

const chatMessages = computed<ChatMessage[]>(() => {
  const chainMessages = messages.value.map((message) => toChatMessage(message))
  const pending = pendingMessages.value.map((message) => ({
    id: message.id,
    body: message.body,
    createdAt: message.createdAt,
    outgoing: true,
    senderLabel: "You",
    deliveryState: message.deliveryState
  }))

  return [...chainMessages, ...pending].sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
})

async function loadMessages() {
  messagesError.value = ""
  messagesLoading.value = true

  try {
    messages.value = await didCommRepository.fetchMessages(bucketId.value)
  } catch (error) {
    messagesError.value = error instanceof Error ? error.message : "Unable to load messages"
  } finally {
    messagesLoading.value = false
  }
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined
  }

  return value as Record<string, unknown>
}

function decodeHexToUtf8(value: string): string | undefined {
  if (!/^0x[0-9a-fA-F]+$/.test(value) || value.length % 2 !== 0) {
    return undefined
  }

  try {
    const payload = value.slice(2)
    const bytes = new Uint8Array(payload.length / 2)

    for (let index = 0; index < payload.length; index += 2) {
      bytes[index / 2] = Number.parseInt(payload.slice(index, index + 2), 16)
    }

    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return undefined
  }
}

function textValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  return decodeHexToUtf8(value) ?? value
}

function firstString(record: Record<string, unknown> | undefined, fields: string[]): string | undefined {
  if (!record) {
    return undefined
  }

  for (const field of fields) {
    const candidate = textValue(record[field])
    if (candidate && candidate.trim()) {
      return candidate.trim()
    }
  }

  return undefined
}

function toDate(value: unknown): Date | undefined {
  if (!value) {
    return undefined
  }

  if (typeof value === "number") {
    const normalized = value > 1_000_000_000_000 ? value : value * 1000
    const parsed = new Date(normalized)
    return Number.isNaN(parsed.getTime()) ? undefined : parsed
  }

  if (typeof value === "string") {
    const asNumber = Number(value)
    if (!Number.isNaN(asNumber) && value.trim()) {
      return toDate(asNumber)
    }

    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? undefined : parsed
  }

  return undefined
}

function toChatMessage(message: BucketMessage): ChatMessage {
  const rawRecord = toRecord(message.raw)
  const body =
    firstString(rawRecord, ["message", "content", "payload", "body", "text", "summary"]) ?? message.summary
  const sender = firstString(rawRecord, ["sender", "from", "author", "owner", "account"])
  const createdAt =
    toDate(rawRecord?.createdAt) ??
    toDate(rawRecord?.timestamp) ??
    toDate(rawRecord?.time) ??
    toDate(rawRecord?.submittedAt) ??
    new Date(0)

  const activeAddress = session.accountAddress.trim().toLowerCase()
  const senderAddress = sender?.trim().toLowerCase() ?? ""
  const outgoing = Boolean(activeAddress && senderAddress && activeAddress === senderAddress)

  return {
    id: message.id,
    body,
    createdAt,
    outgoing,
    senderLabel: outgoing ? "You" : sender ?? "Unknown"
  }
}

function formatTimestamp(value: Date): string {
  if (value.getTime() === 0) {
    return ""
  }

  return value.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  })
}

function logExtrinsicUpdate(update: ExtrinsicUpdate): void {
  const details = [update.message]
  if (update.txHash) {
    details.push(`tx: ${update.txHash}`)
  }
  if (update.blockHash) {
    details.push(`block: ${update.blockHash}`)
  }

  operations.add("did_write", `message:${update.stage}`, update.stage === "error" ? "error" : "info", details.join(" · "))
}

async function sendMessage() {
  sendError.value = ""
  const payload = sendText.value.trim()

  if (!payload) {
    sendError.value = "Message content is required"
    return
  }

  if (!session.accountAddress) {
    sendError.value = "Connect wallet before sending messages"
    return
  }

  const pendingId = `pending-${Date.now()}-${Math.random().toString(16).slice(2)}`
  pendingMessages.value.push({
    id: pendingId,
    body: payload,
    createdAt: new Date(),
    sender: session.accountAddress,
    deliveryState: "sending"
  })

  sendText.value = ""
  sending.value = true

  try {
    const result = await didCommRepository.createMessage(bucketId.value, payload, session.accountAddress, logExtrinsicUpdate)
    const pending = pendingMessages.value.find((entry) => entry.id === pendingId)
    if (pending) {
      pending.deliveryState = "sent"
    }

    operations.add("did_write", bucketId.value, "success", `Message submitted: ${result.txHash}`)
    await loadMessages()
    pendingMessages.value = pendingMessages.value.filter((entry) => entry.deliveryState === "failed")
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to submit message"
    sendError.value = message
    const pending = pendingMessages.value.find((entry) => entry.id === pendingId)
    if (pending) {
      pending.deliveryState = "failed"
    }

    operations.add("did_write", bucketId.value, "error", message)
    if (!sendText.value) {
      sendText.value = payload
    }
  } finally {
    sending.value = false
  }
}

async function scrollToBottom(): Promise<void> {
  await nextTick()
  if (!chatViewport.value) {
    return
  }

  chatViewport.value.scrollTop = chatViewport.value.scrollHeight
}

watch(
  () => chatMessages.value.length,
  async () => {
    await scrollToBottom()
  }
)

onMounted(async () => {
  await loadMessages()
  await scrollToBottom()
})
</script>

<template>
  <div class="stack message-page">
    <header class="card">
      <h2 style="margin: 0">Bucket {{ bucketId }}</h2>
      <p class="muted" style="margin: 8px 0 0">WhatsApp-style thread view for messages in this bucket.</p>
    </header>

    <section class="card stack chat-shell" aria-live="polite">
      <div class="row" style="justify-content: space-between; align-items: center">
        <h3 style="margin: 0">Conversation</h3>
        <div class="row" style="gap: 8px">
          <NuxtLink class="btn" to="/messages">Back</NuxtLink>
          <button class="btn" type="button" :disabled="messagesLoading" @click="loadMessages">
            {{ messagesLoading ? "Loading..." : "Reload" }}
          </button>
        </div>
      </div>

      <LoadingBar v-if="messagesLoading" label="Loading messages..." />

      <p v-if="messagesError" style="margin: 0; color: var(--status-error)">{{ messagesError }}</p>

      <div ref="chatViewport" class="chat-viewport" role="log" aria-live="polite" aria-label="Bucket conversation">
        <p v-if="!chatMessages.length && !messagesLoading" class="muted" style="margin: 0">
          No messages found for this bucket.
        </p>

        <div
          v-for="message in chatMessages"
          :key="message.id"
          class="chat-row"
          :class="message.outgoing ? 'chat-row-outgoing' : 'chat-row-incoming'"
        >
          <article class="chat-bubble" :class="message.outgoing ? 'chat-bubble-outgoing' : 'chat-bubble-incoming'">
            <p class="chat-text">{{ message.body }}</p>
            <footer class="chat-meta">
              <span>{{ message.senderLabel }}</span>
              <span v-if="formatTimestamp(message.createdAt)">{{ formatTimestamp(message.createdAt) }}</span>
              <span v-if="message.deliveryState === 'sending'">Sending...</span>
              <span v-if="message.deliveryState === 'failed'" style="color: var(--status-error)">Failed</span>
            </footer>
          </article>
        </div>
      </div>

      <form class="chat-composer" @submit.prevent="sendMessage">
        <textarea
          v-model="sendText"
          class="input chat-input"
          name="message-text"
          placeholder="Write a message"
          rows="2"
          :disabled="sending"
        />
        <button class="btn btn-primary" type="submit" :disabled="sending || messagesLoading">
          {{ sending ? "Sending..." : "Send" }}
        </button>
      </form>

      <p v-if="!session.accountAddress" class="muted" style="margin: 0">
        Connect wallet on the dashboard first to sign and send bucket messages.
      </p>
      <p v-if="sendError" style="margin: 0; color: var(--status-error)">{{ sendError }}</p>
    </section>
  </div>
</template>

<style scoped>
.message-page {
  min-height: 0;
}

.chat-shell {
  min-height: calc(100vh - 220px);
}

.chat-viewport {
  flex: 1;
  min-height: 380px;
  max-height: 62vh;
  overflow-y: auto;
  border: 1px solid var(--border-default);
  border-radius: 14px;
  padding: 14px;
  background:
    radial-gradient(circle at 20% 20%, rgba(87, 160, 197, 0.12), transparent 30%),
    radial-gradient(circle at 80% 0%, rgba(87, 160, 197, 0.08), transparent 24%),
    var(--color-gray-50);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.chat-row {
  display: flex;
  width: 100%;
}

.chat-row-incoming {
  justify-content: flex-start;
}

.chat-row-outgoing {
  justify-content: flex-end;
}

.chat-bubble {
  max-width: min(78%, 560px);
  border-radius: 12px;
  padding: 10px 12px;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.06);
}

.chat-bubble-incoming {
  background: var(--color-white);
  border: 1px solid var(--border-default);
}

.chat-bubble-outgoing {
  background: #dcf8c6;
  border: 1px solid rgba(92, 135, 84, 0.25);
}

.chat-text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.chat-meta {
  margin-top: 6px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  font-size: 12px;
  color: var(--text-secondary);
}

.chat-composer {
  display: flex;
  gap: 10px;
  align-items: flex-end;
}

.chat-input {
  resize: vertical;
  min-height: 56px;
}

@media (max-width: 840px) {
  .chat-shell {
    min-height: calc(100vh - 190px);
  }

  .chat-viewport {
    min-height: 320px;
    max-height: 56vh;
    padding: 10px;
  }

  .chat-bubble {
    max-width: 88%;
  }

  .chat-composer {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>

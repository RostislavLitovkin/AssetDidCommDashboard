<script setup lang="ts">
import { X } from "lucide-vue-next"

const notifications = useNotificationsStore()
</script>

<template>
  <section class="notification-center" aria-live="polite" aria-label="Notifications" v-if="notifications.items.length">
    <article class="card notification-item" v-for="item in notifications.items" :key="item.id">
      <div class="row notification-header" style="justify-content: space-between; align-items: center">
        <strong class="notification-title">{{ item.title }}</strong>
        <button class="notification-close-btn" type="button" @click="notifications.dismiss(item.id)" aria-label="Dismiss notification">
          <X :size="16" aria-hidden="true" />
        </button>
      </div>
      <p class="notification-message" style="margin: 8px 0 0">{{ item.message }}</p>
      <p class="muted notification-meta" style="margin: 6px 0 0">{{ item.status }} · {{ item.timestamp }}</p>
    </article>
  </section>
</template>

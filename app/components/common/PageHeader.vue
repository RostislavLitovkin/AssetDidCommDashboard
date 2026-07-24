<script setup lang="ts">
// Shared page-level header: a title (with an optional subtitle) on the left and
// an optional group of action buttons on the right. Used across every top-level
// page so the header band looks and behaves consistently.
defineProps<{
  title: string
  subtitle?: string
  // Constrains the inner content to the 1000px chat column (matching
  // `.ib-container`) so the title lines up with the content on full-height
  // chat / files pages. The bottom border still spans the full width.
  contained?: boolean
}>()
</script>

<template>
  <header class="page-header" :class="{ 'page-header--contained': contained }">
    <div class="page-header__inner">
      <div class="page-header__text">
        <h3 class="page-header__title">{{ title }}</h3>
        <p v-if="subtitle" class="page-header__subtitle muted">{{ subtitle }}</p>
      </div>
      <div v-if="$slots.actions" class="page-header__actions">
        <slot name="actions" />
      </div>
    </div>
  </header>
</template>

<style scoped>
.page-header {
  flex-shrink: 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
}

.page-header__inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 0;
}

.page-header--contained .page-header__inner {
  max-width: 1000px;
  margin: 0 auto;
  padding-left: 48px;
  padding-right: 48px;
}

.page-header__text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.page-header__title {
  margin: 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.page-header__subtitle {
  margin: 0;
  font-size: 13px;
}

.page-header__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  flex-wrap: nowrap;
}

.page-header__actions :deep(.btn) {
  white-space: nowrap;
}

@media (max-width: 840px) {
  .page-header--contained .page-header__inner {
    padding-left: 16px;
    padding-right: 16px;
  }
}
</style>

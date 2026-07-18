<script setup lang="ts">
import { ref, computed, onMounted } from "vue"
import { useProfile } from "../../composables/useProfile"
import { useAddress } from "../../composables/useAddress"
import { useRoute } from "vue-router"

const route = useRoute()
const { formatAddress } = useAddress()

const ss58Address = computed(() => route.params.ss58Address as string)
const formattedAddress = computed(() => 
  ss58Address.value ? formatAddress(ss58Address.value) : ""
)

const { profile, isFetching, error, fetchProfile } = useProfile()

async function loadProfile() {
  if (ss58Address.value) {
    // Get private key from wallet storage
    const privateKey = localStorage.getItem(`wallet_private_key_${ss58Address.value}`)
    if (privateKey) {
      await fetchProfile(ss58Address.value, privateKey)
    }
  }
}

onMounted(() => {
  loadProfile()
})

// Computed properties for display
const fullName = computed(() => 
  `${profile.value?.firstName || ""} ${profile.value?.lastName || ""}`.trim() || 
  "No name set"
)

const accountCreatedAtText = computed(() => {
  if (!profile.value?.accountCreatedAt) return ""
  const date = new Date(profile.value.accountCreatedAt)
  return `Account created ${date.toLocaleString("en-US", { month: "long", year: "numeric" })}`
})

const firstName = computed(() => profile.value?.firstName || "")
const lastName = computed(() => profile.value?.lastName || "")
const email = computed(() => profile.value?.email || "")
const phoneNumber = computed(() => profile.value?.phoneNumber || "")

// Profile picture and background
const profilePictureUrl = computed(() => profile.value?.profilePicture || "")
const profileBackgroundUrl = computed(() => profile.value?.profileBackground || "")

// Developer stats
const developerStatsIsVisible = computed(() => 
  profile.value?.role === "developer" && 
  profile.value.developerStats !== undefined
)

const activeListedProperties = computed(() => 
  profile.value?.developerStats?.activeListedProperties || 0
)

const propertyTokensSold = computed(() => 
  profile.value?.developerStats?.propertyTokensSold || 0
)

const totalSales = computed(() => 
  profile.value?.developerStats?.totalSales || 0
)

const averageSaleTime = computed(() => 
  profile.value?.developerStats?.averageSaleTime || 0
)
</script>

<template>
  <div class="profile-container">
    <!-- Profile Header (Background + Avatar) -->
    <div class="profile-header">
      <div 
        class="profile-background" 
        v-if="profileBackgroundUrl"
        :style="{ backgroundImage: `url(${profileBackgroundUrl})` }"
      />
      <div 
        class="profile-avatar"
        :style="{ backgroundImage: profilePictureUrl ? `url(${profilePictureUrl})` : 'none' }"
      >
        <span v-if="!profilePictureUrl" class="avatar-placeholder">?</span>
      </div>
    </div>

    <!-- Profile Content -->
    <div class="profile-content">
      <!-- Header Info -->
      <div class="profile-header-info">
        <div class="profile-name-role">
          <h1 class="profile-name">{{ fullName }}</h1>
          <span v-if="developerStatsIsVisible" class="developer-badge">Developer</span>
        </div>
        <p class="profile-account-created">{{ accountCreatedAtText }}</p>
      </div>

      <!-- Basic Info -->
      <div class="profile-section">
        <div class="info-row">
          <label class="info-label">First Name</label>
          <span class="info-value">{{ firstName }}</span>
        </div>
        <div class="info-row">
          <label class="info-label">Last Name</label>
          <span class="info-value">{{ lastName }}</span>
        </div>
        <div class="info-row">
          <label class="info-label">Email</label>
          <span class="info-value">{{ email }}</span>
        </div>
        <div class="info-row">
          <label class="info-label">Phone Number</label>
          <span class="info-value">{{ phoneNumber }}</span>
        </div>
      </div>

      <!-- Developer Stats -->
      <div 
        class="profile-section developer-stats" 
        v-if="developerStatsIsVisible"
      >
        <h2>Developer Statistics</h2>
        <div class="stats-grid">
          <div class="stat-item">
            <label class="stat-label">Active Listed Properties</label>
            <span class="stat-value">{{ activeListedProperties }}</span>
          </div>
          <div class="stat-item">
            <label class="stat-label">Property Tokens Sold</label>
            <span class="stat-value">{{ propertyTokensSold }}</span>
          </div>
          <div class="stat-item">
            <label class="stat-label">Total Sales</label>
            <span class="stat-value">{{ totalSales }}</span>
          </div>
          <div class="stat-item">
            <label class="stat-label">Average Sale Time</label>
            <span class="stat-value">{{ averageSaleTime }} days</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.profile-container {
  max-width: 800px;
  margin: 0 auto;
  padding: 20px;
}

/* Profile Header */
.profile-header {
  position: relative;
  height: 200px;
  overflow: hidden;
  border-radius: 16px;
  margin-bottom: 24px;
}

.profile-background {
  width: 100%;
  height: 100%;
  background-size: cover;
  background-position: center;
}

.profile-avatar {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background-size: cover;
  background-position: center;
  position: absolute;
  bottom: -40px;
  left: 20px;
  border: 4px solid var(--card-bg);
  background-color: #f0f0f0;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
}

.avatar-placeholder {
  font-size: 40px;
  color: #999;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

/* Profile Content */
.profile-content {
  background: var(--card-bg);
  padding: 32px 24px;
  border-radius: 12px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

/* Profile Header Info */
.profile-header-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 24px;
}

.profile-name-role {
  display: flex;
  align-items: center;
  gap: 12px;
}

.profile-name {
  font-size: 24px;
  font-weight: 600;
  margin: 0;
}

.developer-badge {
  background: var(--color-primary);
  color: white;
  padding: 4px 12px;
  border-radius: 16px;
  font-size: 12px;
  font-weight: 500;
}

.profile-account-created {
  color: var(--text-secondary);
  font-size: 14px;
  margin: 0;
}

/* Profile Section */
.profile-section {
  margin-bottom: 24px;
}

.profile-section h2 {
  font-size: 18px;
  font-weight: 600;
  margin: 0 0 16px;
  color: var(--text-primary);
}

/* Info Row */
.info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid var(--border-color);
}

.info-row:last-child {
  border-bottom: none;
}

.info-label {
  color: var(--text-secondary);
  font-size: 14px;
}

.info-value {
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 500;
}

/* Developer Stats */
.developer-stats {
  background: var(--color-gray-50);
  padding: 20px;
  border-radius: 12px;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}

.stat-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat-label {
  color: var(--text-secondary);
  font-size: 12px;
}

.stat-value {
  color: var(--text-primary);
  font-size: 20px;
  font-weight: 600;
}

/* Loading and Error */
.loading {
  text-align: center;
  padding: 40px;
  color: var(--text-secondary);
}

.error {
  text-align: center;
  padding: 40px;
  color: var(--color-error);
  background: var(--color-error-bg);
  border-radius: 8px;
  margin: 20px 0;
}
</style>

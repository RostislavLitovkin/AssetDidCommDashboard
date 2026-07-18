<script setup lang="ts">
import { ref, onMounted } from "vue"
import { useProfile } from "../composables/useProfile"
import { useAddress } from "../composables/useAddress"

const { formatAddress } = useAddress()
const { profile, isFetching, error, fetchProfile } = useProfile()
const allProfiles = ref<any[]>([])

const selectedAddress = ref("")

async function loadAllProfiles() {
  // Get all accounts from wallet
  const accounts = await window.navigator.wallet?.listAccounts?.() || []
  if (accounts.length > 0) {
    const firstAccount = accounts[0]
    selectedAddress.value = firstAccount.address
    await loadProfile(firstAccount.address)
  }
}

async function loadProfile(address: string) {
  const privateKey = localStorage.getItem(`wallet_private_key_${address}`)
  if (privateKey) {
    await fetchProfile(address, privateKey)
  }
}

async function handleAddressChange(event: Event) {
  const select = event.target as HTMLSelectElement
  const address = select.value
  selectedAddress.value = address
  await loadProfile(address)
}

onMounted(() => {
  loadAllProfiles()
})
</script>

<template>
  <div class="profile-management-container">
    <div class="header">
      <h1>Profile Management</h1>
      <p class="subtitle">Manage your profile information across all accounts</p>
    </div>

    <!-- Account Selector -->
    <div class="account-selector">
      <label class="selector-label">Select Account</label>
      <select 
        v-if="allProfiles.length > 0"
        @change="handleAddressChange"
        class="selector"
      >
        <option 
          v-for="profile in allProfiles" 
          :key="profile.ss58Address" 
          :value="profile.ss58Address"
        >
          {{ formatAddress(profile.ss58Address) }} ({{ profile.firstName || profile.nickname || 'No name' }})
        </option>
      </select>
      
      <p v-else class="no-accounts">
        No accounts found. Please connect your wallet first.
      </p>
    </div>

    <!-- Profile Info -->
    <div v-if="isFetching" class="loading">
      <div class="spinner">Loading...</div>
    </div>

    <div v-else-if="error" class="error">
      <p>Error: {{ error }}</p>
    </div>

    <div v-else-if="profile" class="profile-info">
      <div class="profile-header-section">
        <h2>{{ formatAddress(profile.ss58Address) }}</h2>
        <div class="profile-meta">
          <span v-if="profile.firstName || profile.lastName" class="profile-name">
            {{ profile.firstName }} {{ profile.lastName }}
          </span>
          <span v-if="profile.email" class="profile-email">{{ profile.email }}</span>
          <span v-if="profile.role" class="profile-role">Role: {{ profile.role }}</span>
        </div>
      </div>
    </div>

    <div v-else class="no-profile">
      <p>No profile found for the selected account.</p>
      <button class="btn btn-primary">Create Profile</button>
    </div>
  </div>
</template>

<style scoped>
.profile-management-container {
  max-width: 800px;
  margin: 0 auto;
  padding: 20px;
}

.header {
  margin-bottom: 24px;
}

.header h1 {
  font-size: 24px;
  font-weight: 600;
  margin: 0 0 8px;
}

.subtitle {
  color: var(--text-secondary);
  font-size: 14px;
  margin: 0;
}

/* Account Selector */
.account-selector {
  background: var(--card-bg);
  padding: 20px;
  border-radius: 12px;
  margin-bottom: 24px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.selector-label {
  display: block;
  margin-bottom: 8px;
  font-weight: 500;
  color: var(--text-primary);
}

.selector {
  width: 100%;
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  font-size: 14px;
  background: var(--bg-color);
  color: var(--text-primary);
}

.no-accounts {
  color: var(--text-secondary);
  font-size: 14px;
}

/* Profile Info */
.profile-info {
  background: var(--card-bg);
  padding: 24px;
  border-radius: 12px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.profile-header-section {
  margin-bottom: 24px;
}

.profile-header-section h2 {
  font-size: 20px;
  font-weight: 600;
  margin: 0 0 12px;
}

.profile-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}

.profile-name {
  font-weight: 500;
  color: var(--text-primary);
}

.profile-email {
  color: var(--text-secondary);
}

.profile-role {
  color: var(--color-primary);
  font-weight: 500;
}

/* No Profile */
.no-profile {
  text-align: center;
  padding: 40px;
  color: var(--text-secondary);
}

.btn {
  padding: 10px 20px;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-primary {
  background: var(--color-primary);
  color: white;
  border: none;
  margin-top: 16px;
}

.btn-primary:hover {
  background: var(--color-primary-dark);
}

/* Loading and Error */
.loading, .error {
  text-align: center;
  padding: 40px;
}

.spinner {
  display: inline-block;
  width: 40px;
  height: 40px;
  border: 4px solid var(--border-color);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>

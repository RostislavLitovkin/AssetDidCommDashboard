<script setup lang="ts">
import type { WalletBrandId } from "../../services/wallet/walletCatalog"
import type { WalletKind } from "../../services/wallet/types"

/**
 * Simplified, hand-drawn brand marks for the supported wallets and chain
 * families. Inline SVG keeps the app free of remote image requests and lets
 * the marks scale crisply at any size.
 */
withDefaults(
  defineProps<{
    brand: WalletBrandId | WalletKind
    size?: number
  }>(),
  { size: 32 }
)
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <!-- Phantom: purple tile, white ghost -->
    <template v-if="brand === 'phantom'">
      <rect width="32" height="32" rx="7" fill="#AB9FF2" />
      <path
        d="M16 6.5c-5.4 0-9 4-9 9.6v7.6c0 .9 1.1 1.4 1.8.7l1.8-1.7 2.1 2c.4.4 1.1.4 1.5 0l1.8-1.8 1.8 1.8c.4.4 1.1.4 1.5 0l2.1-2 1.8 1.7c.7.7 1.8.2 1.8-.7v-7.6c0-5.6-3.6-9.6-9-9.6z"
        fill="#ffffff"
      />
      <circle cx="12.6" cy="15.2" r="1.6" fill="#AB9FF2" />
      <circle cx="19.4" cy="15.2" r="1.6" fill="#AB9FF2" />
    </template>

    <!-- Solflare: dark tile, orange spark -->
    <template v-else-if="brand === 'solflare'">
      <rect width="32" height="32" rx="7" fill="#17161C" />
      <defs>
        <radialGradient id="wbi-solflare" cx="0.5" cy="0.35" r="0.75">
          <stop offset="0" stop-color="#FFC10B" />
          <stop offset="1" stop-color="#FB3F2E" />
        </radialGradient>
      </defs>
      <path d="M16 5.5l2.7 7.8 7.8 2.7-7.8 2.7-2.7 7.8-2.7-7.8-7.8-2.7 7.8-2.7z" fill="url(#wbi-solflare)" />
    </template>

    <!-- Backpack: red tile, white backpack -->
    <template v-else-if="brand === 'backpack'">
      <rect width="32" height="32" rx="7" fill="#E33E3F" />
      <path d="M12.6 11.4v-1.2c0-2.5 1.4-4.2 3.4-4.2s3.4 1.7 3.4 4.2v1.2" stroke="#ffffff" stroke-width="2.2" />
      <rect x="9.2" y="11" width="13.6" height="13.5" rx="4.2" fill="#ffffff" />
      <circle cx="16" cy="15.6" r="2" fill="#E33E3F" />
    </template>

    <!-- polkadot.js: light tile, pink-to-orange ball -->
    <template v-else-if="brand === 'polkadot-js'">
      <rect width="32" height="32" rx="7" fill="#F6F2F8" />
      <defs>
        <linearGradient id="wbi-pjs" x1="8" y1="8" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#E6007A" />
          <stop offset="1" stop-color="#FF8C00" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="8.5" fill="url(#wbi-pjs)" />
    </template>

    <!-- Talisman: lime tile, dark eye -->
    <template v-else-if="brand === 'talisman'">
      <rect width="32" height="32" rx="7" fill="#D5FF5C" />
      <path
        d="M6.5 16c3.4-4.8 6.6-7.2 9.5-7.2s6.1 2.4 9.5 7.2c-3.4 4.8-6.6 7.2-9.5 7.2S9.9 20.8 6.5 16z"
        fill="#1B2634"
      />
      <circle cx="16" cy="16" r="3.4" fill="#D5FF5C" />
      <circle cx="16" cy="16" r="1.5" fill="#1B2634" />
    </template>

    <!-- SubWallet: blue tile, angular white S -->
    <template v-else-if="brand === 'subwallet-js'">
      <rect width="32" height="32" rx="7" fill="#004BFF" />
      <path
        d="M21.5 7.5H10.5v9.2l7 2.9V21h-7v3.5h11v-9.2l-7-2.9V11h7z"
        fill="#ffffff"
      />
    </template>

    <!-- Solana chain mark: dark tile, gradient bars -->
    <template v-else-if="brand === 'solana'">
      <rect width="32" height="32" rx="7" fill="#0E1116" />
      <defs>
        <linearGradient id="wbi-solana" x1="7" y1="25" x2="27" y2="7" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#9945FF" />
          <stop offset="1" stop-color="#14F195" />
        </linearGradient>
      </defs>
      <path d="M10.9 7.5h15.6l-3.4 3.6H7.5z" fill="url(#wbi-solana)" />
      <path d="M7.5 14.2h15.6l3.4 3.6H10.9z" fill="url(#wbi-solana)" />
      <path d="M10.9 21h15.6l-3.4 3.6H7.5z" fill="url(#wbi-solana)" />
    </template>

    <!-- Polkadot chain mark: soft tile, pink ball -->
    <template v-else-if="brand === 'polkadot'">
      <rect width="32" height="32" rx="7" fill="#FFF1F7" />
      <defs>
        <radialGradient id="wbi-polkadot" cx="0.38" cy="0.32" r="0.85">
          <stop offset="0" stop-color="#FF3D9A" />
          <stop offset="1" stop-color="#D50072" />
        </radialGradient>
      </defs>
      <circle cx="16" cy="16" r="8.5" fill="url(#wbi-polkadot)" />
    </template>
  </svg>
</template>

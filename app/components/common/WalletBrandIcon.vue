<script setup lang="ts">
import { computed, useId } from "vue"
import type { WalletBrandId } from "../../services/wallet/walletCatalog"
import type { WalletKind } from "../../services/wallet/types"

/**
 * Official brand marks for the supported wallets and chain families, inlined
 * verbatim from each project's own published artwork: the wallet-adapter
 * icons Phantom and Solflare ship, backpack.app's logo, the polkadot.js mark
 * bundled by the Talisman and SubWallet connect packages, Talisman's and
 * SubWallet's own logos, solana.com's logo mark and polkadot.com's favicon.
 * Inline SVG keeps the app free of remote image requests and lets the marks
 * scale crisply at any size.
 *
 * Every brand keeps its source artwork's viewBox so nothing is redrawn by
 * hand; the square width/height plus the default preserveAspectRatio centres
 * the non-square marks inside the icon box.
 */
const props = withDefaults(
  defineProps<{
    brand: WalletBrandId | WalletKind
    size?: number
  }>(),
  { size: 32 }
)

const VIEW_BOXES: Record<WalletBrandId | WalletKind, string> = {
  phantom: "0 0 108 108",
  solflare: "0 0 50 50",
  backpack: "0 0 19.25 28",
  "polkadot-js": "15 15 140 140",
  talisman: "0 0 128 128",
  "subwallet-js": "0 0 134 134",
  solana: "0 0 101 88",
  polkadot: "0 0 256 256"
}

const viewBox = computed(() => VIEW_BOXES[props.brand])

// Gradient ids live in a document-global namespace, so each instance scopes
// its own — the same brand can render many times on one page.
const uid = useId()

function gradientId(name: string): string {
  return `${uid}-${name}`
}

function gradientRef(name: string): string {
  return `url(#${gradientId(name)})`
}
</script>

<template>
  <svg :width="size" :height="size" :viewBox="viewBox" fill="none" aria-hidden="true">
    <!-- Phantom: purple tile, white ghost -->
    <template v-if="brand === 'phantom'">
      <rect width="108" height="108" rx="26" fill="#AB9FF2" />
      <path
        fill-rule="evenodd"
        clip-rule="evenodd"
        fill="#FFFDF8"
        d="M46.5267 69.9229C42.0054 76.8509 34.4292 85.6182 24.348 85.6182C19.5824 85.6182 15 83.6563 15 75.1342C15 53.4305 44.6326 19.8327 72.1268 19.8327C87.768 19.8327 94 30.6846 94 43.0079C94 58.8258 83.7355 76.9122 73.5321 76.9122C70.2939 76.9122 68.7053 75.1342 68.7053 72.314C68.7053 71.5783 68.8275 70.7812 69.0719 69.9229C65.5893 75.8699 58.8685 81.3878 52.5754 81.3878C47.993 81.3878 45.6713 78.5063 45.6713 74.4598C45.6713 72.9884 45.9768 71.4556 46.5267 69.9229ZM83.6761 42.5794C83.6761 46.1704 81.5575 47.9658 79.1875 47.9658C76.7816 47.9658 74.6989 46.1704 74.6989 42.5794C74.6989 38.9885 76.7816 37.1931 79.1875 37.1931C81.5575 37.1931 83.6761 38.9885 83.6761 42.5794ZM70.2103 42.5795C70.2103 46.1704 68.0916 47.9658 65.7216 47.9658C63.3157 47.9658 61.233 46.1704 61.233 42.5795C61.233 38.9885 63.3157 37.1931 65.7216 37.1931C68.0916 37.1931 70.2103 38.9885 70.2103 42.5795Z"
      />
    </template>

    <!-- Solflare: yellow tile, dark flare -->
    <template v-else-if="brand === 'solflare'">
      <rect width="50" height="50" rx="12" ry="12" fill="#FFEF46" />
      <path
        fill="#02050A"
        stroke="#FFEF46"
        stroke-miterlimit="10"
        stroke-width="0.5"
        d="M24.23,26.42l2.46-2.38,4.59,1.5c3.01,1,4.51,2.84,4.51,5.43,0,1.96-.75,3.26-2.25,4.93l-.46.5.17-1.17c.67-4.26-.58-6.09-4.72-7.43l-4.3-1.38h0ZM18.05,11.85l12.52,4.17-2.71,2.59-6.51-2.17c-2.25-.75-3.01-1.96-3.3-4.51v-.08h0ZM17.3,33.06l2.84-2.71,5.34,1.75c2.8.92,3.76,2.13,3.46,5.18l-11.65-4.22h0ZM13.71,20.95c0-.79.42-1.54,1.13-2.17.75,1.09,2.05,2.05,4.09,2.71l4.42,1.46-2.46,2.38-4.34-1.42c-2-.67-2.84-1.67-2.84-2.96M26.82,42.87c9.18-6.09,14.11-10.23,14.11-15.32,0-3.38-2-5.26-6.43-6.72l-3.34-1.13,9.14-8.77-1.84-1.96-2.71,2.38-12.81-4.22c-3.97,1.29-8.97,5.09-8.97,8.89,0,.42.04.83.17,1.29-3.3,1.88-4.63,3.63-4.63,5.8,0,2.05,1.09,4.09,4.55,5.22l2.75.92-9.52,9.14,1.84,1.96,2.96-2.71,14.73,5.22h0Z"
      />
    </template>

    <!-- Backpack: red backpack mark -->
    <template v-else-if="brand === 'backpack'">
      <path
        fill-rule="evenodd"
        clip-rule="evenodd"
        fill="#E33E3F"
        d="M11.4485 2.20159C12.4662 2.20159 13.4208 2.33802 14.3047 2.59104C13.4394 0.574296 11.6427 0 9.64316 0C7.6397 0 5.83992 0.576553 4.97656 2.60292C5.85392 2.341 6.80442 2.20159 7.81865 2.20159H11.4485ZM7.58586 4.22632C2.75337 4.22632 0 8.028 0 12.7176V17.535C0 18.004 0.391751 18.375 0.875 18.375H18.375C18.8582 18.375 19.25 18.004 19.25 17.535V12.7176C19.25 8.028 16.0482 4.22632 11.2157 4.22632H7.58586ZM9.61816 12.7593C11.3095 12.7593 12.6807 11.3881 12.6807 9.69678C12.6807 8.00541 11.3095 6.63428 9.61816 6.63428C7.92679 6.63428 6.55566 8.00541 6.55566 9.69678C6.55566 11.3881 7.92679 12.7593 9.61816 12.7593ZM0 21.2066C0 20.7376 0.391751 20.3574 0.875 20.3574H18.375C18.8582 20.3574 19.25 20.7376 19.25 21.2066V26.3013C19.25 27.2392 18.4665 27.9996 17.5 27.9996H1.75C0.783501 27.9996 0 27.2392 0 26.3013V21.2066Z"
      />
    </template>

    <!-- polkadot.js: orange disc, white mark -->
    <template v-else-if="brand === 'polkadot-js'">
      <circle cx="85" cy="85" r="70" fill="#FF8C00" />
      <path
        fill="#FFFFFF"
        d="M85 34.7c-20.8 0-37.8 16.9-37.8 37.8 0 4.2.7 8.3 2 12.3.9 2.7 3.9 4.2 6.7 3.3 2.7-.9 4.2-3.9 3.3-6.7-1.1-3.1-1.6-6.4-1.5-9.7.4-14.1 11.8-25.7 25.9-26.4 15.7-.8 28.7 11.7 28.7 27.2 0 14.5-11.4 26.4-25.7 27.2 0 0-5.3.3-7.9.7-1.3.2-2.3.4-3 .5-.3.1-.6-.2-.5-.5l.9-4.4L81 73.4c.6-2.8-1.2-5.6-4-6.2-2.8-.6-5.6 1.2-6.2 4 0 0-11.8 55-11.9 55.6-.6 2.8 1.2 5.6 4 6.2 2.8.6 5.6-1.2 6.2-4 .1-.6 1.7-7.9 1.7-7.9 1.2-5.6 5.8-9.7 11.2-10.4 1.2-.2 5.9-.5 5.9-.5 19.5-1.5 34.9-17.8 34.9-37.7 0-20.9-17-37.8-37.8-37.8zm2.7 87c-3.4-.7-6.8 1.4-7.5 4.9-.7 3.4 1.4 6.8 4.9 7.5 3.4.7 6.8-1.4 7.5-4.9.7-3.5-1.4-6.8-4.9-7.5z"
      />
    </template>

    <!-- Talisman: lime tile, red eye -->
    <template v-else-if="brand === 'talisman'">
      <path
        fill="#D5FF5C"
        fill-rule="evenodd"
        d="M0 70.25c0 21.255 0 31.883 4.463 39.852a35 35 0 0 0 13.435 13.435C25.867 128 36.495 128 57.75 128h12.5c21.255 0 31.883 0 39.852-4.463a35 35 0 0 0 13.435-13.435C128 102.133 128 91.505 128 70.25v-12.5c0-21.255 0-31.883-4.463-39.852a35 35 0 0 0-13.435-13.435C102.133 0 91.505 0 70.25 0h-12.5C36.495 0 25.867 0 17.898 4.463A35 35 0 0 0 4.463 17.898C0 25.867 0 36.495 0 57.75Z"
      />
      <path
        fill="#FD4848"
        fill-rule="evenodd"
        d="m33.879 35.117-.5 19.165c8.107 4.168 15.75 4.075 24.74 2.063 3.56-1.397 6.056-1.702 9.511 0 9.067 2.816 16.969 1.95 25.185-2.243l-.485-19.187c0-10.805-7.004-14.962-14.632-12.739-.779.232-1.944 1.274-1.944 2.207l-.181 18.733a1.77 1.77 0 1 1-3.538-.015V20.067a8.838 8.838 0 0 0-17.675 0V43.1a1.77 1.77 0 1 1-3.538.015l-.176-18.743c0-.923-1.109-1.96-1.882-2.192-8.8-2.61-14.88 2.538-14.88 12.936Zm2.475 23.843a48.43 48.43 0 0 1-5.209-2.254c-4.73-2.269-12.095-1.562-17.072 4.111-2.274 2.6-.515 6.36 2.77 7.448 1.583.526 3.017 1.413 4.353 2.408l.464.336c4.132 2.965 6.793 7.406 7.056 12.486l.253 4.812a31.616 31.616 0 0 0 19.428 25.959 38.59 38.59 0 0 0 29.327 0 31.616 31.616 0 0 0 19.429-25.959c.046-.825.061-1.65.051-2.465l.124-2.347c.263-5.08 2.924-9.52 7.056-12.486l.464-.336c1.34-.995 2.77-1.882 4.353-2.408 3.285-1.089 5.05-4.849 2.77-7.448-4.978-5.673-12.343-6.375-17.072-4.11-1.718.825-3.435 1.65-5.21 2.253l-3.62 1.238-.01.041c-6.654 1.842-12.12 1.847-18.398-.742-3.177-1.31-6.38-1.558-9.48 0-5.967 1.856-12.048 2.64-18.206.701l-3.626-1.238Zm26.665 44.732c13.39 0 24.241-15.596 24.241-15.596S76.41 72.499 63.02 72.499c-13.385 0-24.236 15.597-24.236 15.597s10.851 15.596 24.24 15.596Zm10.883-15.596c0 6.01-4.872 10.882-10.883 10.882-6.01 0-10.882-4.872-10.882-10.882s4.872-10.883 10.882-10.883 10.883 4.872 10.883 10.883Zm-10.883 4.936a4.936 4.936 0 1 0 0-9.872 4.936 4.936 0 0 0 0 9.872Z"
      />
    </template>

    <!-- SubWallet: folded gradient ribbon -->
    <template v-else-if="brand === 'subwallet-js'">
      <defs>
        <linearGradient
          :id="gradientId('sw0')"
          x1="11.9006"
          y1="50.6648"
          x2="119.372"
          y2="50.6648"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stop-color="#FFD4B2" />
          <stop offset="0.36" stop-color="#9ACEB7" />
          <stop offset="0.67" stop-color="#47C8BB" />
          <stop offset="0.89" stop-color="#14C5BE" />
          <stop offset="1" stop-color="#00C4BF" />
        </linearGradient>
        <linearGradient
          :id="gradientId('sw1')"
          x1="44.0766"
          y1="62.8524"
          x2="44.0766"
          y2="21.2167"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stop-color="#00FECF" />
          <stop offset="0.08" stop-color="#00E5D0" />
          <stop offset="0.24" stop-color="#00A5D1" />
          <stop offset="0.48" stop-color="#0040D4" />
          <stop offset="0.54" stop-color="#0025D5" />
          <stop offset="1" stop-color="#000000" />
        </linearGradient>
        <linearGradient
          :id="gradientId('sw2')"
          x1="37.4414"
          y1="76.8587"
          x2="146.891"
          y2="76.8587"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stop-color="#FDEC9F" />
          <stop offset="0.08" stop-color="#E4D8A4" />
          <stop offset="0.24" stop-color="#A4A6B2" />
          <stop offset="0.47" stop-color="#3F57C8" />
          <stop offset="0.61" stop-color="#0025D5" />
          <stop offset="1" stop-color="#000000" />
        </linearGradient>
        <linearGradient
          :id="gradientId('sw3')"
          x1="15.0596"
          y1="103.18"
          x2="155.01"
          y2="103.18"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0.05" stop-color="#62A5FF" />
          <stop offset="0.45" stop-color="#1032D1" />
          <stop offset="1" stop-color="#000000" />
        </linearGradient>
        <linearGradient
          :id="gradientId('sw4')"
          x1="628.741"
          y1="3244.93"
          x2="797.782"
          y2="3247.12"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stop-color="#FFD4B2" />
          <stop offset="0.36" stop-color="#9ACEB7" />
          <stop offset="0.67" stop-color="#47C8BB" />
          <stop offset="0.89" stop-color="#14C5BE" />
          <stop offset="1" stop-color="#00C4BF" />
        </linearGradient>
        <linearGradient
          :id="gradientId('sw5')"
          x1="24.5987"
          y1="82.3783"
          x2="72.5834"
          y2="82.3783"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stop-color="#00FECF" />
          <stop offset="0.08" stop-color="#00E5D0" />
          <stop offset="0.25" stop-color="#00A5D1" />
          <stop offset="0.49" stop-color="#0040D4" />
          <stop offset="0.56" stop-color="#0025D5" />
        </linearGradient>
        <linearGradient
          :id="gradientId('sw6')"
          x1="70.9573"
          y1="52.5952"
          x2="189.069"
          y2="50.4576"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stop-color="#00FECF" />
          <stop offset="0.05" stop-color="#00E5D0" />
          <stop offset="0.15" stop-color="#00A5D1" />
          <stop offset="0.29" stop-color="#0040D4" />
          <stop offset="0.33" stop-color="#0025D5" />
        </linearGradient>
        <linearGradient
          :id="gradientId('sw7')"
          x1="27.1191"
          y1="27.8689"
          x2="173.642"
          y2="27.8689"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stop-color="#FFD4AF" />
          <stop offset="0.1" stop-color="#E6D5BA" />
          <stop offset="0.31" stop-color="#A7D6D5" />
          <stop offset="0.61" stop-color="#43D9FF" />
          <stop offset="0.63" stop-color="#37B1D0" />
          <stop offset="0.65" stop-color="#2B8CA5" />
          <stop offset="0.67" stop-color="#216B7D" />
          <stop offset="0.7" stop-color="#184E5B" />
          <stop offset="0.72" stop-color="#10353F" />
          <stop offset="0.75" stop-color="#0A2228" />
          <stop offset="0.78" stop-color="#061316" />
          <stop offset="0.82" stop-color="#020809" />
          <stop offset="0.88" stop-color="#010202" />
          <stop offset="1" stop-color="#000000" />
        </linearGradient>
      </defs>
      <path
        :fill="gradientRef('sw0')"
        d="M87.9615 64.3201L87.9456 47.7455L27.1191 16.2236V64.3041L66.0589 85.106L80.2884 78.8367L37.4403 56.1046L37.4722 37.887L87.9615 64.3201Z"
      />
      <path
        :fill="gradientRef('sw1')"
        d="M50.7607 44.8421V50.5052L37.3926 56.2321L37.4883 37.6636L50.7607 44.8421Z"
      />
      <path
        :fill="gradientRef('sw2')"
        d="M50.8095 91.822L80.2895 78.8368L37.4414 56.2163L50.6819 50.5054L105.765 79.2835L50.9212 103.212L50.8095 91.822Z"
      />
      <path
        :fill="gradientRef('sw3')"
        d="M37.4886 87.9773L50.6493 82.2982L50.9365 103.196L105.765 79.2832V97.118L37.377 127.077L37.4886 87.9773Z"
      />
      <path
        :fill="gradientRef('sw4')"
        d="M27.1191 82.5857L37.4403 87.9776L37.3765 127.013L27.1191 121.86V82.5857Z"
      />
      <path
        :fill="gradientRef('sw5')"
        d="M40.1522 76.7791L50.6489 82.2986L37.4403 87.9776L27.1191 82.5857L40.1522 76.7791Z"
      />
      <path
        :fill="gradientRef('sw6')"
        d="M105.765 56.5993L105.702 39.9131L87.9785 47.7457V64.3362L105.765 56.5993Z"
      />
      <path
        :fill="gradientRef('sw7')"
        d="M27.1191 16.2237L45.0337 7.97632L105.732 39.8811L87.9775 47.7456L27.1191 16.2237Z"
      />
    </template>

    <!-- Solana chain mark: gradient bars -->
    <template v-else-if="brand === 'solana'">
      <defs>
        <linearGradient
          :id="gradientId('solana')"
          x1="8.52558"
          y1="90.0973"
          x2="88.9933"
          y2="-3.01622"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0.08" stop-color="#9945FF" />
          <stop offset="0.3" stop-color="#8752F3" />
          <stop offset="0.5" stop-color="#5497D5" />
          <stop offset="0.6" stop-color="#43B4CA" />
          <stop offset="0.72" stop-color="#28E0B9" />
          <stop offset="0.97" stop-color="#19FB9B" />
        </linearGradient>
      </defs>
      <path
        :fill="gradientRef('solana')"
        d="M100.48 69.3817L83.8068 86.8015C83.4444 87.1799 83.0058 87.4816 82.5185 87.6878C82.0312 87.894 81.5055 88.0003 80.9743 88H1.93563C1.55849 88 1.18957 87.8926 0.874202 87.6912C0.558829 87.4897 0.31074 87.2029 0.160416 86.8659C0.0100923 86.529 -0.0359181 86.1566 0.0280382 85.7945C0.0919944 85.4324 0.263131 85.0964 0.520422 84.8278L17.2061 67.408C17.5676 67.0306 18.0047 66.7295 18.4904 66.5234C18.9762 66.3172 19.5002 66.2104 20.0301 66.2095H99.0644C99.4415 66.2095 99.8104 66.3169 100.126 66.5183C100.441 66.7198 100.689 67.0067 100.84 67.3436C100.99 67.6806 101.036 68.0529 100.972 68.415C100.908 68.7771 100.737 69.1131 100.48 69.3817ZM83.8068 34.3032C83.4444 33.9248 83.0058 33.6231 82.5185 33.4169C82.0312 33.2108 81.5055 33.1045 80.9743 33.1048H1.93563C1.55849 33.1048 1.18957 33.2121 0.874202 33.4136C0.558829 33.6151 0.31074 33.9019 0.160416 34.2388C0.0100923 34.5758 -0.0359181 34.9482 0.0280382 35.3103C0.0919944 35.6723 0.263131 36.0083 0.520422 36.277L17.2061 53.6968C17.5676 54.0742 18.0047 54.3752 18.4904 54.5814C18.9762 54.7875 19.5002 54.8944 20.0301 54.8952H99.0644C99.4415 54.8952 99.8104 54.7879 100.126 54.5864C100.441 54.3849 100.689 54.0981 100.84 53.7612C100.99 53.4242 101.036 53.0518 100.972 52.6897C100.908 52.3277 100.737 51.9917 100.48 51.723L83.8068 34.3032ZM1.93563 21.7905H80.9743C81.5055 21.7907 82.0312 21.6845 82.5185 21.4783C83.0058 21.2721 83.4444 20.9704 83.8068 20.592L100.48 3.17219C100.737 2.90357 100.908 2.56758 100.972 2.2055C101.036 1.84342 100.99 1.47103 100.84 1.13408C100.689 0.79713 100.441 0.510296 100.126 0.308823C99.8104 0.107349 99.4415 1.24074e-05 99.0644 0L20.0301 0C19.5002 0.000878397 18.9762 0.107699 18.4904 0.313848C18.0047 0.519998 17.5676 0.821087 17.2061 1.19848L0.524723 18.6183C0.267681 18.8866 0.0966198 19.2223 0.0325185 19.5839C-0.0315829 19.9456 0.0140624 20.3177 0.163856 20.6545C0.31365 20.9913 0.561081 21.2781 0.875804 21.4799C1.19053 21.6817 1.55886 21.7896 1.93563 21.7905Z"
      />
    </template>

    <!-- Polkadot chain mark: the dot in Polkadot Pink -->
    <template v-else-if="brand === 'polkadot'">
      <path
        fill="#FF2670"
        d="M31.0155 57.7181C14.6547 76.7768 14.2233 103.306 30.0862 116.92C45.9492 130.566 72.0667 126.15 88.4607 107.058C104.821 87.9995 105.253 61.4701 89.3899 47.8567C83.1841 42.511 75.3522 39.9543 67.1884 39.9543C54.5113 39.9543 40.9713 46.1302 31.0155 57.7181Z"
      />
      <path
        fill="#FF2670"
        d="M26.2694 156.332C13.9574 170.941 19.3003 195.744 38.2164 211.715C57.1326 227.686 82.4868 228.815 94.7989 214.205C107.111 199.596 101.768 174.793 82.8518 158.822C72.8296 150.355 61.0153 146.072 50.2962 146.072C40.7718 146.072 32.077 149.459 26.3026 156.332"
      />
      <path
        fill="#FF2670"
        d="M137.343 209.789C115.142 216.795 99.8429 231.072 103.161 241.664C106.513 252.256 127.221 255.178 149.423 248.139C171.625 241.133 186.923 226.856 183.605 216.264C181.481 209.59 172.454 205.938 160.507 205.938C153.505 205.938 145.54 207.166 137.343 209.756"
      />
      <path
        fill="#FF2670"
        d="M102.597 18.5365C98.0176 31.7514 112.553 48.8179 135.12 56.6871C157.686 64.5562 179.689 60.2066 184.268 46.9917C188.848 33.7768 174.313 16.7103 151.746 8.84109C144.146 6.18482 136.58 4.9231 129.744 4.9231C116.303 4.9231 105.617 9.77078 102.597 18.5365Z"
      />
      <path
        fill="#FF2670"
        d="M204.048 45.169C197.51 47.7921 199.07 66.884 207.499 87.7357C215.928 108.621 228.041 123.396 234.579 120.773C241.083 118.15 239.557 99.0912 231.128 78.2063C223.362 58.9484 212.444 44.8702 205.674 44.8702C205.11 44.8702 204.579 44.9698 204.048 45.169Z"
      />
      <path
        fill="#FF2670"
        d="M209.058 172.038C199.766 192.192 196.547 210.553 201.89 213.01C207.233 215.468 219.114 201.124 228.406 180.969C237.731 160.815 240.917 142.453 235.607 139.996C235.209 139.797 234.778 139.731 234.28 139.731C228.472 139.731 217.654 153.411 209.058 172.038Z"
      />
    </template>
  </svg>
</template>

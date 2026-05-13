export default defineNuxtConfig({
  ssr: false,
  devtools: { enabled: true },
  modules: ["@pinia/nuxt", "@nuxtjs/color-mode"],
  css: ["~/assets/styles/tokens.css", "~/assets/styles/globals.css"],
  app: {
    baseURL: process.env.NUXT_APP_BASE_URL || "/",
    head: {
      title: "Asset DIDComm Admin Dashboard",
      meta: [{ name: "viewport", content: "width=device-width, initial-scale=1" }]
    }
  },
  nitro: {
    preset: "github_pages"
  },
  runtimeConfig: {
    public: {
      xcavateWsEndpoint:
        process.env.NUXT_PUBLIC_XCAVATE_WS_ENDPOINT ||
        "wss://xcavate-paseo.api.onfinality.io/public-ws",
      subqueryIndexerUrl:
        process.env.NUXT_PUBLIC_SUBQUERY_INDEXER_URL ||
        "https://index-api.onfinality.io/sq/7396860564255539200/xcavate-indexer",
      subquerySchemaCid: process.env.NUXT_PUBLIC_SUBQUERY_SCHEMA_CID || "QmSJWayuSumbFwM6UyCN6zJ8mHRFqy3YTsotg18gaz86NX",
      pinataJwt: process.env.NUXT_PUBLIC_PINATA_JWT || "",
      pinataApiKey: process.env.NUXT_PUBLIC_PINATA_API_KEY || "",
      pinataApiSecret: process.env.NUXT_PUBLIC_PINATA_API_SECRET || "",
      pinataGateway: process.env.NUXT_PUBLIC_PINATA_GATEWAY || "https://gateway.pinata.cloud/ipfs",
      publicFreeCommunicationBucket: process.env.NUXT_PUBLIC_FREE_COMMUNICATION_BUCKET,
    }
  },
  typescript: {
    strict: true,
    typeCheck: true
  }
})
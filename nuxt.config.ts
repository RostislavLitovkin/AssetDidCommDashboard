import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

// Pre-hydration splash: inlined so it paints before the app JS bundle. Kept in
// real files (app/splash/*) for editability; read here at build/eval time.
const rootDir = dirname(fileURLToPath(import.meta.url))
const splashCss = readFileSync(resolve(rootDir, "app/splash/splash.css"), "utf-8")
// Inline the logo as a base64 data URI so the splash needs no network request.
const logoSvg = readFileSync(resolve(rootDir, "app/assets/Images/realXmessenger.svg"), "utf-8")
const logoDataUri = "data:image/svg+xml;base64," + Buffer.from(logoSvg, "utf-8").toString("base64")
const splashJs = readFileSync(resolve(rootDir, "app/splash/splash.js"), "utf-8").replace(
  "__RX_LOGO__",
  logoDataUri
)

export default defineNuxtConfig({
  ssr: false,
  devtools: { enabled: true },
  modules: ["@pinia/nuxt", "@nuxtjs/color-mode"],
  css: ["~/assets/styles/tokens.css", "~/assets/styles/globals.css"],
  app: {
    baseURL: process.env.NUXT_APP_BASE_URL || "/",
    head: {
      title: "realXmessage",
      meta: [{ name: "viewport", content: "width=device-width, initial-scale=1" }],
      link: [{ rel: "icon", type: "image/x-icon", href: "/realXmessengerAppIcon.ico" }],
      style: [{ innerHTML: splashCss, tagPriority: "critical" }],
      // Classic inline script at bodyOpen runs during parse, before the module
      // bundle — this is what makes the splash paint early.
      script: [{ innerHTML: splashJs, tagPosition: "bodyOpen" }]
    }
  },
  nitro: {
    preset: "github_pages"
  },
  runtimeConfig: {
    public: {
      xcavateWsEndpoint:
        process.env.NUXT_PUBLIC_XCAVATE_WS_ENDPOINT ||
        "wss://xcavate-solochain.api.onfinality.io/public-ws",
      subqueryIndexerUrl:
        process.env.NUXT_PUBLIC_SUBQUERY_INDEXER_URL ||
        "https://indexer.realxmarket.io/",
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
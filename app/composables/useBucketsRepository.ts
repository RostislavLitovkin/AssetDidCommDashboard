import { useRuntimeConfig } from "nuxt/app"
import { BucketsRepository } from "../services/buckets/bucketsRepository"
import { resolveWalletProvider } from "../services/wallet/resolveWalletProvider"
import { hashApiBody } from "../services/wallet/signingCore"
import { useSettingsStore } from "../stores/settings"

/**
 * Build the buckets repository from runtime config. Pages must use this
 * instead of constructing BucketsRepository (or wiring config) by hand.
 */
export function useBucketsRepository(): BucketsRepository {
  const config = useRuntimeConfig()
  const settings = useSettingsStore()
  settings.initialize()

  return new BucketsRepository({
    apiUrl: String(config.public.profileApiUrl),
    pinataConfig: {
      jwt: String(config.public.pinataJwt || ""),
      apiKey: String(config.public.pinataApiKey || ""),
      apiSecret: String(config.public.pinataApiSecret || ""),
      publicGateway: String(config.public.pinataGateway || "")
    },
    sign: async (address, rawBody) =>
      resolveWalletProvider(settings.walletType).signApiRequest(
        address,
        "POST",
        "/graphql",
        await hashApiBody(rawBody)
      )
  })
}

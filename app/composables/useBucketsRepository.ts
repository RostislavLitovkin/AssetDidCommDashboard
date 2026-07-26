import { useRuntimeConfig } from "nuxt/app"
import { BucketsRepository } from "../services/buckets/bucketsRepository"
import { WalletExtensionProvider } from "../services/wallet/extensionProvider"

/**
 * Build the buckets repository from runtime config. Pages must use this
 * instead of constructing BucketsRepository (or wiring config) by hand.
 */
export function useBucketsRepository(): BucketsRepository {
  const config = useRuntimeConfig()
  const provider = new WalletExtensionProvider()

  return new BucketsRepository({
    apiUrl: String(config.public.profileApiUrl),
    pinataConfig: {
      jwt: String(config.public.pinataJwt || ""),
      apiKey: String(config.public.pinataApiKey || ""),
      apiSecret: String(config.public.pinataApiSecret || ""),
      publicGateway: String(config.public.pinataGateway || "")
    },
    sign: (address, rawBody) => provider.signGraphqlRequest(address, rawBody)
  })
}

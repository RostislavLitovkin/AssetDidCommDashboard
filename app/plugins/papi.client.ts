import { PapiClient } from "../services/papi/client"

export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()
  const client = new PapiClient(config.public.xcavateWsEndpoint)
  return {
    provide: {
      papiClient: client
    }
  }
})

import type { PapiClient } from "../services/papi/client"

declare module "#app" {
  interface NuxtApp {
    $papiClient: PapiClient
  }
}

declare module "vue" {
  interface ComponentCustomProperties {
    $papiClient: PapiClient
  }
}

export {}

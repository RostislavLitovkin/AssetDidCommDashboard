import { installAssetDidCommBridge } from "../services/injection/x25519InjectionBridge"
import { useSettingsStore } from "../stores/settings"

export default defineNuxtPlugin(() => {
  const settings = useSettingsStore()
  settings.initialize()

  installAssetDidCommBridge(
    {
      setX25519SecretJwk: (value, persist) => settings.setX25519SecretJwk(value, persist),
      clearX25519SecretJwk: () => settings.clearX25519SecretJwk(),
      getX25519KeyId: () => settings.x25519SecretJwk?.kid,
      hasX25519Key: () => settings.x25519SecretJwk !== null
    },
    window
  )
})

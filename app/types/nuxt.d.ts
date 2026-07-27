import type { AssetDidCommBridge } from "../services/injection/x25519InjectionBridge"

declare global {
  interface Window {
    /** Host-injection API installed by app/plugins/keyInjection.client.ts. */
    assetDidComm?: AssetDidCommBridge
    /** Injected by .NET MAUI HybridWebView for JS -> C# raw messages. */
    HybridWebView?: {
      SendRawMessage?: (message: string) => void
    }
    /** Slot for a key injected by the host before the app has booted. */
    __assetDidCommPendingX25519Key?: string | Record<string, unknown>
  }
}

export {}

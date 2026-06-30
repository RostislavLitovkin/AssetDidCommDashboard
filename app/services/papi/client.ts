const DEFAULT_ENDPOINT = "wss://xcavate-solochain.api.onfinality.io/public-ws"

type JsonRpcSuccess<T> = {
  jsonrpc: "2.0"
  id: number
  result: T
}

type JsonRpcError = {
  jsonrpc: "2.0"
  id: number
  error: {
    code: number
    message: string
    data?: unknown
  }
}

export class PapiClient {
  private endpoint: string
  private requestId = 0

  constructor(endpoint?: string) {
    this.endpoint = endpoint || DEFAULT_ENDPOINT
  }

  getEndpoint(): string {
    return this.endpoint
  }

  async health(): Promise<{ ok: boolean; endpoint: string }> {
    return { ok: true, endpoint: this.endpoint }
  }

  async rpc<T>(method: string, params: unknown[] = []): Promise<T> {
    if (typeof WebSocket === "undefined") {
      throw new Error("WebSocket is unavailable in this runtime")
    }

    const requestId = ++this.requestId

    return await new Promise<T>((resolve, reject) => {
      const socket = new WebSocket(this.endpoint)
      let settled = false

      const finalize = (handler: () => void): void => {
        if (settled) {
          return
        }
        settled = true
        handler()
        socket.close()
      }

      socket.onopen = () => {
        socket.send(JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }))
      }

      socket.onmessage = (event) => {
        let payload: JsonRpcSuccess<T> | JsonRpcError

        try {
          payload = JSON.parse(event.data as string) as JsonRpcSuccess<T> | JsonRpcError
        } catch {
          return
        }

        if (payload.id !== requestId) {
          return
        }

        if ("error" in payload) {
          finalize(() => reject(new Error(payload.error.message || "JSON-RPC request failed")))
          return
        }

        finalize(() => resolve(payload.result))
      }

      socket.onerror = () => {
        finalize(() => reject(new Error(`Failed to call JSON-RPC method ${method}`)))
      }

      socket.onclose = () => {
        if (!settled) {
          settled = true
          reject(new Error(`Connection closed before JSON-RPC response for ${method}`))
        }
      }
    })
  }
}

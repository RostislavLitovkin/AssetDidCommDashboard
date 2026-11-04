import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { compileScript, compileTemplate, parse } from "@vue/compiler-sfc"
import { createRenderer, h, nextTick, reactive, type App, type Component } from "vue"
import { transformWithEsbuild } from "vite"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

const pagePath = fileURLToPath(new URL("../../app/pages/messages/namespace/[namespaceId].vue", import.meta.url))
const pageSource = readFileSync(pagePath, "utf8")

interface HostNode {
  type: string
  text: string
  props: Record<string, any>
  children: HostNode[]
  parent: HostNode | null
}

function hostNode(type: string, text = ""): HostNode {
  return { type, text, props: {}, children: [], parent: null }
}

const renderer = createRenderer<HostNode, HostNode>({
  patchProp(element, key, _previous, next) {
    element.props[key] = next
  },
  insert(child, parent, anchor) {
    child.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    if (index < 0) parent.children.push(child)
    else parent.children.splice(index, 0, child)
  },
  remove(child) {
    const siblings = child.parent?.children
    const index = siblings?.indexOf(child) ?? -1
    if (index >= 0) siblings!.splice(index, 1)
  },
  createElement(type) {
    return hostNode(type)
  },
  createText(text) {
    return hostNode("#text", text)
  },
  createComment(text) {
    return hostNode("#comment", text)
  },
  setText(node, text) {
    node.text = text
  },
  setElementText(element, text) {
    element.children = text ? [hostNode("#text", text)] : []
    for (const child of element.children) child.parent = element
  },
  parentNode(node) {
    return node.parent
  },
  nextSibling(node) {
    const siblings = node.parent?.children ?? []
    return siblings[siblings.indexOf(node) + 1] ?? null
  },
  querySelector() {
    return null
  },
  setScopeId() {}
})

let NamespacePage: Component
const apps: App[] = []

beforeAll(async () => {
  const { descriptor, errors } = parse(pageSource, { filename: pagePath })
  if (errors.length) throw errors[0]
  const script = compileScript(descriptor, { id: "namespace-page" })
  const template = compileTemplate({
    id: "namespace-page",
    filename: pagePath,
    source: descriptor.template?.content ?? "",
    compilerOptions: { bindingMetadata: script.bindings, hoistStatic: false }
  })
  if (template.errors.length) throw template.errors[0]

  const scriptSource = script.content
    .replace(/import SkeletonCard from "[^"]+"/, "const SkeletonCard = () => null")
    .replace(/import WalletConnectPrompt from "[^"]+"/, "const WalletConnectPrompt = () => null")
    .replace(/import PageHeader from "[^"]+"/, "const PageHeader = () => null")
    .replace(
      /import \{ useAddress \} from "[^"]+"/,
      'const useAddress = () => ({ formatAddress: (address: string) => address, addressesEqual })'
    )
    .replace(
      /import \{ useRoute \} from "[^"]+"/,
      'const useRoute = () => ({ params: { namespaceId: "7" } })'
    )
    .replace(
      /import \{ useSessionStore \} from "[^"]+"/,
      "const useSessionStore = () => (globalThis as any).__namespaceSession"
    )

  const combined = `import { addressesEqual } from ${JSON.stringify(import.meta.resolve("../../app/services/wallet/addressUtils.ts"))}\n${
    scriptSource.replace("export default", "const __sfc__ =")
  }\nconst useBucketsRepository = () => (globalThis as any).__namespaceRepository\n${
    template.code.replace("export function render", "function render")
  }\n__sfc__.render = render;\nexport default __sfc__;`
  const transformed = await transformWithEsbuild(combined, pagePath, { loader: "ts", target: "es2022" })
  const code = transformed.code
    .replace(/from\s+["']vue["']/g, `from ${JSON.stringify(import.meta.resolve("vue"))}`)
    .replace(/from\s+["']lucide-vue-next["']/g, `from ${JSON.stringify(import.meta.resolve("lucide-vue-next"))}`)
    .replace(
      /from\s+["']\.\.\/\.\.\/\.\.\/services\/format\/relativeTime["']/g,
      `from ${JSON.stringify(import.meta.resolve("../../app/services/format/relativeTime.ts"))}`
    )
  const module = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`)
  NamespacePage = module.default
})

afterEach(() => {
  for (const app of apps.splice(0)) app.unmount()
  delete (globalThis as any).__namespaceSession
  delete (globalThis as any).__namespaceRepository
})

function findAll(root: HostNode, predicate: (node: HostNode) => boolean): HostNode[] {
  return [...(predicate(root) ? [root] : []), ...root.children.flatMap((child) => findAll(child, predicate))]
}

function removeButtons(root: HostNode): HostNode[] {
  return findAll(root, (node) => node.type === "button" && node.props.title === "Remove")
}

async function mountPage(walletStatus: string, accountAddress: string): Promise<HostNode> {
  const session = reactive({ walletStatus, accountAddress })
  const repository = {
    fetchNamespaceById: vi.fn().mockResolvedValue({
      id: "7",
      namespaceId: "7",
      name: "Example namespace",
      schemaUri: null,
      properties: null,
      creator: "ManagerWallet",
      createdAt: "2026-01-01T00:00:00.000Z"
    }),
    fetchBucketsByNamespace: vi.fn().mockResolvedValue([]),
    fetchLatestMessageTimes: vi.fn().mockResolvedValue({}),
    fetchNamespaceManagers: vi.fn().mockResolvedValue(["ManagerWallet", "OtherManager"]),
    removeNamespaceManager: vi.fn()
  }
  ;(globalThis as any).__namespaceSession = session
  ;(globalThis as any).__namespaceRepository = repository

  const root = hostNode("root")
  const app = renderer.createApp({ render: () => h(NamespacePage) })
  app.component("NuxtLink", () => null)
  app.mount(root)
  apps.push(app)
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
  return root
}

describe("namespace bucket cards", () => {
  it("loads and displays each bucket's latest message time instead of its bucket ID", () => {
    expect(pageSource).toContain("fetchLatestMessageTimes")
    expect(pageSource).toContain("timeAgo")
    expect(pageSource).toContain("Last message: {{ formatLastMessage(bucket) }}")
    expect(pageSource).not.toContain("Bucket ID: {{ bucket.id }}")
  })
})

describe("namespace manager removal", () => {
  it("shows remove buttons only when the connected wallet is a namespace manager", async () => {
    const scenarios = [
      { walletStatus: "connected", accountAddress: " managerwallet ", expectedButtons: 2 },
      { walletStatus: "connected", accountAddress: "UnauthorizedWallet", expectedButtons: 0 },
      { walletStatus: "disconnected", accountAddress: "ManagerWallet", expectedButtons: 0 }
    ]

    for (const scenario of scenarios) {
      const root = await mountPage(scenario.walletStatus, scenario.accountAddress)
      expect(removeButtons(root), `${scenario.walletStatus}: ${scenario.accountAddress}`).toHaveLength(scenario.expectedButtons)
    }
  })
})

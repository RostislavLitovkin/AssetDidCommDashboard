import { readFileSync } from "node:fs"
import vm from "node:vm"
import { fileURLToPath } from "node:url"
import { compileScript, compileTemplate, parse } from "@vue/compiler-sfc"
import { renderToString } from "@vue/server-renderer"
import { h } from "vue"
import { transformWithEsbuild } from "vite"
import { describe, expect, it } from "vitest"

const loaderPath = fileURLToPath(
  new URL("../../app/components/common/ParticleLoader.vue", import.meta.url)
)
const splashPath = fileURLToPath(new URL("../../app/splash/splash.js", import.meta.url))

async function renderLoader(size: "inline" | "block" | "page"): Promise<string> {
  const source = readFileSync(loaderPath, "utf8")
  const { descriptor, errors } = parse(source, { filename: loaderPath })
  if (errors.length) throw errors[0]
  const script = compileScript(descriptor, { id: "particle-loader" })
  const template = compileTemplate({
    id: "particle-loader",
    filename: loaderPath,
    source: descriptor.template?.content ?? "",
    compilerOptions: { bindingMetadata: script.bindings },
    ssrCssVars: [],
    ssr: true
  })
  if (template.errors.length) throw template.errors[0]

  const combined = `${script.content.replace("export default", "const __sfc__ =")}\n${
    template.code
  }\n__sfc__.ssrRender = ssrRender;\nexport default __sfc__;`
  const transformed = await transformWithEsbuild(combined, loaderPath, {
    loader: "ts",
    target: "es2022"
  })
  const code = transformed.code
    .replace(/from\s+["']vue["']/g, `from ${JSON.stringify(import.meta.resolve("vue"))}`)
    .replace(
      /from\s+["']vue\/server-renderer["']/g,
      `from ${JSON.stringify(import.meta.resolve("@vue/server-renderer"))}`
    )
  const module = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`)
  return renderToString(h(module.default, { label: "Loading test content...", size }))
}

type FakeElement = {
  tagName: string
  children: FakeElement[]
  parentNode: FakeElement | null
  className: string
  textContent: string
  style: Record<string, string>
  setAttribute: (name: string, value: string) => void
  addEventListener: () => void
  appendChild: (child: FakeElement) => void
}

function executeSplash() {
  const createdTags: string[] = []
  const frames: FrameRequestCallback[] = []
  let body: FakeElement
  let now = 0

  function element(tagName: string): FakeElement {
    createdTags.push(tagName)
    return {
      tagName,
      children: [],
      parentNode: null,
      className: "",
      textContent: "",
      style: {},
      setAttribute() {},
      addEventListener() {},
      appendChild(child) {
        child.parentNode = this as FakeElement
        this.children.push(child)
      }
    }
  }

  body = element("body")
  const window = {
    matchMedia: () => ({ matches: true }),
    removeEventListener() {},
    addEventListener() {}
  }
  const context = {
    window,
    document: {
      body,
      documentElement: body,
      createElement: element
    },
    performance: { now: () => now },
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    },
    cancelAnimationFrame() {},
    setTimeout() {}
  }
  vm.runInNewContext(readFileSync(splashPath, "utf8"), context)

  return {
    createdTags,
    body,
    runFrame(timestamp: number) {
      now = timestamp
      frames.shift()?.(timestamp)
    },
    appReady: () => (window as typeof window & { __appReady: () => void }).__appReady()
  }
}

describe("loading screens without particles", () => {
  it.each(["inline", "block", "page"] as const)(
    "keeps the %s loader label without rendering particle elements",
    async (size) => {
      const html = await renderLoader(size)

      expect(html).toContain('role="status"')
      expect(html).not.toContain("<canvas")
      expect(html).not.toContain("particle-loader-fallback")
      if (size === "inline") expect(html).toContain('aria-label="Loading test content..."')
      else expect(html).toContain("Loading test content...")
    }
  )

  it("keeps the startup splash without creating a particle canvas", () => {
    const splash = executeSplash()

    expect(splash.createdTags).toContain("img")
    expect(splash.createdTags).toContain("div")
    expect(splash.createdTags).not.toContain("canvas")
    expect(splash.body.children[0]?.textContent).not.toBe("100%")
  })

  it("preserves splash progress and readiness completion", () => {
    const splash = executeSplash()
    const root = splash.body.children[0]!
    const center = root.children.find((child) => child.className === "rx-splash__center")!
    const percentage = center.children.find((child) => child.className === "rx-splash__pct")!

    expect(percentage.textContent).toBe("0%")
    splash.runFrame(1000)
    expect(percentage.textContent).toBe("40%")
    splash.appReady()
    expect(percentage.textContent).toBe("100%")
    expect(root.className).toBe("rx-splash--hide")
  })
})

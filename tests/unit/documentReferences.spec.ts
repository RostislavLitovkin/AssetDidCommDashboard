import { describe, expect, it } from "vitest"
import { resolveProfileApiDocumentUrl } from "../../app/services/buckets/documentReferences"

const API = "https://profile-api.xcavate.io/"
const HASH = "f7adfcd9aa4fc5aa1973fbca008e119ab9452184e9a34a2d9bf622bebc153c36"

describe("resolveProfileApiDocumentUrl", () => {
  it("serves a legacy terms document through the API", () => {
    expect(resolveProfileApiDocumentUrl(API, "/xcavate-profile/terms-documents/by-candidacy/5Gx.pdf"))
      .toBe("https://profile-api.xcavate.io/api/terms-documents/by-candidacy/5Gx")
  })

  it("rewrites a virtual-hosted review snapshot and drops its suffix", () => {
    const path = new URL(
      `https://xcavate-profile.fsn1.your-objectstorage.com/terms-documents/by-listing/22/developer-lawyer-${HASH}.pdf`,
    ).pathname
    expect(resolveProfileApiDocumentUrl(API, path))
      .toBe(`https://profile-api.xcavate.io/api/terms-documents/by-listing/22/developer-lawyer-${HASH}`)
  })

  it("rewrites a path-prefixed review snapshot too", () => {
    const path = new URL(
      `https://objects.example/xcavate-profile/terms-documents/by-listing/7/spv-lawyer-${HASH}.pdf`,
    ).pathname
    expect(resolveProfileApiDocumentUrl(API, path))
      .toBe(`https://profile-api.xcavate.io/api/terms-documents/by-listing/7/spv-lawyer-${HASH}`)
  })

  it("leaves an object whose name carries no digest to its own origin", () => {
    expect(resolveProfileApiDocumentUrl(API, "/terms-documents/by-listing/23/spv-lawyer.pdf")).toBeNull()
  })

  it("leaves anything that is not a lawyer snapshot alone", () => {
    for (const path of [
      // uppercase digest, unknown role and truncated digest are not this build's objects
      `/terms-documents/by-listing/22/spv-lawyer-${HASH.toUpperCase()}.pdf`,
      "/terms-documents/by-listing/22/accountant-9c1a00c1355328540303fcbe92895389e548bc2a63bd7e72d0edd42e4e0d3f1a.pdf",
      `/terms-documents/by-listing/22/spv-lawyer-${HASH.slice(0, 62)}.pdf`,
      // the by-candidacy rewrite stays scoped to the object-storage path shape
      "/terms-documents/by-candidacy/5Gx.pdf",
      // the reference this build posts is already the API route, suffix-less
      `/api/terms-documents/by-listing/22/spv-lawyer-${HASH}`,
      "/terms-documents/by-listing/22/spv-lawyer-.pdf",
    ]) {
      expect(resolveProfileApiDocumentUrl(API, path), path).toBeNull()
    }
  })

  it("joins the configured origin without doubling the slash", () => {
    const path = `/terms-documents/by-listing/22/spv-lawyer-${HASH}.pdf`
    expect(resolveProfileApiDocumentUrl("http://localhost:5000", path))
      .toBe(`http://localhost:5000/api/terms-documents/by-listing/22/spv-lawyer-${HASH}`)
  })
})

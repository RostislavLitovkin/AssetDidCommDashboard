// Legacy terms and lawyer-review documents live on object storage, which sends no
// CORS headers, so a reference naming one of them is rewritten to the ProfileApi
// route serving the same bytes. Each rewrite captures the id segments to append, and
// is matched on the path alone so virtual-hosted object URLs are covered too.
const profileApiDocumentRoutes = [
  { route: "/api/terms-documents/by-candidacy/", pathname: /^\/xcavate-profile\/terms-documents\/by-candidacy\/([^/]+)\.pdf$/ },
  // A review snapshot name is always "{role}-{sha256}" — anything else under the
  // same prefix is someone else's object and must keep its own URL.
  { route: "/api/terms-documents/by-listing/", pathname: /\/terms-documents\/by-listing\/([^/]+)\/((?:spv-lawyer|developer-lawyer)-[0-9a-f]{64})\.pdf$/ },
]

/**
 * The ProfileApi URL serving a document whose reference points at object storage,
 * or `null` when the path is not one of those documents and the reference stands.
 */
export function resolveProfileApiDocumentUrl(profileApiUrl: string, pathname: string): string | null {
  for (const entry of profileApiDocumentRoutes) {
    const segments = entry.pathname.exec(pathname)
    if (segments) {
      const origin = String(profileApiUrl).replace(/\/+$/, "")
      return `${origin}${entry.route}${segments.slice(1).join("/")}`
    }
  }
  return null
}

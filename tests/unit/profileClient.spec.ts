import { describe, expect, it, vi } from "vitest"
import { ProfileClient, normalizeProfile } from "../../app/services/profile/profileClient"

describe("ProfileClient", () => {
  it("treats a missing profile as an uncreated profile", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 404 }))
    const client = new ProfileClient("https://profiles.test", fetcher)

    await expect(client.getProfile("5Example")).resolves.toBeNull()
    expect(fetcher).toHaveBeenCalledWith("https://profiles.test/api/profiles/5Example")
  })

  it("normalizes profiles returned with lowercase address keys", () => {
    expect(normalizeProfile({ ss58address: "5Example", nickname: "alice" })).toEqual({
      ss58Address: "5Example",
      nickname: "alice",
      bio: null,
      profilePicture: null,
      x25519Key: null
    })
  })

  it("upserts the profile via PUT with the C#-canonical request body", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ss58Address: "5Example",
      nickname: "alice"
    }), { status: 200 }))
    const signRequest = vi.fn().mockResolvedValue({ "X-Signature": "0xsigned" })
    const client = new ProfileClient("https://profiles.test", fetcher)

    await client.saveProfile("5Example", {
      nickname: " alice ",
      bio: " About me ",
      profilePicture: "",
      x25519Key: ""
    }, signRequest)

    // Canonical JSON: `ss58address` key, declaration order, nulls emitted.
    const body = "{\"ss58address\":\"5Example\",\"nickname\":\"alice\",\"bio\":\"About me\",\"profilePicture\":null,\"x25519Key\":null}"
    expect(signRequest).toHaveBeenCalledWith("PUT", "/api/profiles/5Example", { kind: "json", canonicalJson: body })
    expect(fetcher).toHaveBeenCalledWith("https://profiles.test/api/profiles/5Example", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Signature": "0xsigned" },
      body
    })
  })

  it("signs an empty body and submits the image as form data", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("https://cdn.test/profile.jpg", { status: 200 }))
    const signRequest = vi.fn().mockResolvedValue({ "X-Signature": "0xsigned" })
    const client = new ProfileClient("https://profiles.test", fetcher)

    await expect(client.uploadProfileImage(
      "5Example",
      new File(["image data"], "ProfilePicture_5Example.jpg", { type: "image/jpeg" }),
      signRequest
    )).resolves.toBe("https://cdn.test/profile.jpg")

    expect(signRequest).toHaveBeenCalledWith("POST", "/api/profiles/5Example/image", { kind: "empty" })
    const [url, init] = (fetcher.mock.calls[0] ?? []) as [string, { method: string; headers: Record<string, string>; body: unknown }]
    expect(url).toBe("https://profiles.test/api/profiles/5Example/image")
    expect(init.method).toBe("POST")
    expect(init.headers).toEqual({ "X-Signature": "0xsigned" })
    expect(init.body).toBeInstanceOf(FormData)
    expect((init.body as FormData).get("image")).toBeInstanceOf(File)
  })
})
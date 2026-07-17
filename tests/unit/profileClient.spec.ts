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

  it("signs and submits the exact create-profile request body", async () => {
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
    }, false, signRequest)

    const body = "{\"ss58Address\":\"5Example\",\"nickname\":\"alice\",\"bio\":\"About me\",\"profilePicture\":null,\"x25519Key\":null}"
    expect(signRequest).toHaveBeenCalledWith("POST", "/api/profiles", body)
    expect(fetcher).toHaveBeenCalledWith("https://profiles.test/api/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Signature": "0xsigned" },
      body
    })
  })

  it("signs and submits an image as multipart form data", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("https://cdn.test/profile.png", { status: 200 }))
    const signRequest = vi.fn().mockResolvedValue({ "X-Signature": "0xsigned" })
    const client = new ProfileClient("https://profiles.test", fetcher)

    await expect(client.uploadProfileImage(
      "5Example",
      new File(["image data"], "profile.png", { type: "image/png" }),
      signRequest
    )).resolves.toBe("https://cdn.test/profile.png")

    expect(signRequest).toHaveBeenCalledWith(
      "POST",
      "/api/profiles/5Example/image",
      expect.stringContaining("name=\"image\"; filename=\"profile.png\"")
    )
    expect(fetcher).toHaveBeenCalledWith("https://profiles.test/api/profiles/5Example/image", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({
        "Content-Type": expect.stringMatching(/^multipart\/form-data; boundary=/),
        "X-Signature": "0xsigned"
      }),
      body: expect.any(ArrayBuffer)
    }))
  })
})
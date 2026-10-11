import { describe, expect, it } from "vitest"
import {
  buildBuyRelistedPostMessage,
  buildDelistAndRelistPostMessage,
  findMauiMarketplaceBridge
} from "../../app/services/injection/mauiMarketplaceBridge"

describe("findMauiMarketplaceBridge", () => {
  it("returns null outside the MAUI host and for non-object scopes", () => {
    expect(findMauiMarketplaceBridge({})).toBeNull()
    expect(findMauiMarketplaceBridge(null)).toBeNull()
    expect(findMauiMarketplaceBridge(undefined)).toBeNull()
    expect(findMauiMarketplaceBridge("window")).toBeNull()
  })

  it("returns null when the injected object does not quack like a bridge", () => {
    expect(findMauiMarketplaceBridge({ mauiMarketplace: {} })).toBeNull()
    expect(findMauiMarketplaceBridge({ mauiMarketplace: { postMessage: "yes" } })).toBeNull()
    expect(findMauiMarketplaceBridge({ mauiMarketplace: null })).toBeNull()
  })

  it("returns the injected bridge when postMessage is a function", () => {
    const calls: string[] = []
    const bridge = findMauiMarketplaceBridge({ mauiMarketplace: { postMessage: (m: string) => calls.push(m) } })
    expect(bridge).not.toBeNull()
    bridge!.postMessage("hello")
    expect(calls).toEqual(["hello"])
  })
})

describe("marketplace hand-off messages", () => {
  it("builds the buyer's buyRelisted message", () => {
    const raw = buildBuyRelistedPostMessage({
      shareListingId: "7",
      assetId: "12",
      amount: 5,
      pricePerToken: "123000000000",
      seller: "seller-wallet-address",
      propertyName: "Sunset Villa"
    })
    expect(JSON.parse(raw)).toEqual({
      type: "buyRelisted",
      shareListingId: "7",
      assetId: "12",
      amount: 5,
      pricePerToken: "123000000000",
      seller: "seller-wallet-address",
      propertyName: "Sunset Villa"
    })
  })

  it("carries the bucket ids when the page knows them, and omits them when it does not", () => {
    const withIds = JSON.parse(buildBuyRelistedPostMessage({
      shareListingId: "7",
      assetId: "12",
      amount: 5,
      pricePerToken: "123000000000",
      seller: "seller-wallet-address",
      propertyName: "Sunset Villa",
      namespaceId: "42",
      bucketId: "43"
    }))
    expect(withIds.namespaceId).toBe("42")
    expect(withIds.bucketId).toBe("43")

    const withoutIds = JSON.parse(buildBuyRelistedPostMessage({
      shareListingId: "7",
      assetId: "12",
      amount: 5,
      pricePerToken: "123000000000",
      seller: "seller-wallet-address",
      propertyName: "Sunset Villa",
      namespaceId: undefined,
      bucketId: undefined
    }))
    expect("namespaceId" in withoutIds).toBe(false)
    expect("bucketId" in withoutIds).toBe(false)
  })

  it("builds the seller's delistAndRelist message", () => {
    const raw = buildDelistAndRelistPostMessage({
      shareListingId: "7",
      assetId: "12",
      amount: 5,
      pricePerToken: "123000000000",
      seller: "seller-wallet-address"
    })
    expect(JSON.parse(raw)).toEqual({
      type: "delistAndRelist",
      shareListingId: "7",
      assetId: "12",
      amount: 5,
      pricePerToken: "123000000000",
      seller: "seller-wallet-address"
    })
  })
})

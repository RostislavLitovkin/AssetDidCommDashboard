/**
 * Host bridge for realXmarket secondary-market actions.
 *
 * The .NET MAUI app that hosts this SPA ("realXmessenger") injects
 * `window.mauiMarketplace` into the WebView. The bridge is how the page hands
 * off actions only the native app can perform — executing the on-chain
 * purchase of a relisted share after a price was agreed here, or finalizing a
 * relist at the agreed price. Plain browser sessions have no bridge: callers
 * must feature-detect with findMauiMarketplaceBridge() and degrade to a hint
 * to open the realXmarket app.
 */

export interface MauiMarketplaceBridge {
  postMessage(message: string): void;
}

/** Payload handed to the native app when the buyer executes the agreed purchase. */
export interface BuyRelistedMessage {
  type: "buyRelisted";
  shareListingId: string;
  assetId: string;
  amount: number;
  /** 9-decimal fixed-point GBP quote per token, decimal string. */
  pricePerToken: string;
  seller: string;
  /** Property name parsed out of the bucket name ("" when unknown). */
  propertyName: string;
  /**
   * The bucket this negotiation lives in, when known — lets the app write the
   * terminal "purchased" status message back after the on-chain buy confirms.
   * Decimal strings; omitted by older dashboards (the status write is skipped then).
   */
  namespaceId?: string;
  bucketId?: string;
}

/** Payload handed to the native app when the seller relists at the agreed price and finalizes. */
export interface DelistAndRelistMessage {
  type: "delistAndRelist";
  shareListingId: string;
  assetId: string;
  amount: number;
  pricePerToken: string;
  seller: string;
}

/**
 * The injected bridge, or null outside the MAUI host (plain browsers) and when
 * the injected object does not quack like a bridge.
 */
export function findMauiMarketplaceBridge(target?: unknown): MauiMarketplaceBridge | null {
  const scope = target ?? (typeof window !== "undefined" ? window : undefined);
  if (!scope || typeof scope !== "object") {
    return null;
  }
  const candidate = (scope as { mauiMarketplace?: unknown }).mauiMarketplace;
  if (!candidate || typeof candidate !== "object") {
    return null;
  }
  const postMessage = (candidate as { postMessage?: unknown }).postMessage;
  return typeof postMessage === "function" ? (candidate as MauiMarketplaceBridge) : null;
}

/** Serializes the buyer's purchase hand-off for postMessage. */
export function buildBuyRelistedPostMessage(input: Omit<BuyRelistedMessage, "type">): string {
  return JSON.stringify({ type: "buyRelisted", ...input });
}

/** Serializes the seller's delist-and-relist hand-off for postMessage. */
export function buildDelistAndRelistPostMessage(input: Omit<DelistAndRelistMessage, "type">): string {
  return JSON.stringify({ type: "delistAndRelist", ...input });
}

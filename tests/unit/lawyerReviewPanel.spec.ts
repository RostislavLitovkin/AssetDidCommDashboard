import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { compileScript, compileTemplate, parse } from "@vue/compiler-sfc";
import { createRenderer, h, nextTick, reactive, type Component } from "vue";
import { transformWithEsbuild } from "vite";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { votingTimeLeftLabel } from "../../app/services/buckets/voting";
import type { LawyerReviewBucketMetadata, LawyerReviewState } from "../../app/services/lawyer/types";

const HASH = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const panelPath = fileURLToPath(new URL("../../app/components/lawyer/LawyerReviewPanel.vue", import.meta.url));
const pagePath = fileURLToPath(new URL("../../app/pages/indexed-bucket/[id]/index.vue", import.meta.url));
const sharedStylesPath = fileURLToPath(new URL("../../app/assets/styles/ib-surfaces.css", import.meta.url));

/** Every rule of the status banner and the bottom sheet both flows must share. */
const SHARED_SURFACE_SELECTORS = [
  ".ib-offer-bar",
  ".ib-offer-inner",
  ".ib-offer-head",
  ".ib-offer-icon",
  ".ib-offer-info",
  ".ib-offer-title",
  ".ib-offer-amount",
  ".ib-offer-actions",
  ".ib-offer-action",
  ".ib-offer-note",
  ".ib-vote-reject",
  ".ib-sheet-overlay",
  ".ib-sheet-handle",
  ".ib-sheet-title",
  ".ib-sheet-desc",
  ".ib-sheet-error",
  ".ib-sheet-actions",
  ".ib-sheet-actions .btn",
  ".ib-sheet-actions .btn-primary",
];

/** Just the trailing <style> block of an SFC: the rest of the file is not CSS. */
function styleBlock(source: string): string {
  return source.slice(source.lastIndexOf("<style"), source.lastIndexOf("</style>"));
}

/** Selector → declarations, with comments dropped and at-rules skipped. */
function ruleBodies(css: string): Map<string, string> {
  const bodies = new Map<string, string>();
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1]!.trim();
    if (selector.startsWith("@") || selector.startsWith("from") || selector.startsWith("to")) continue;
    for (const part of selector.split(",")) {
      const key = part.trim().replace(/\s+/g, " ");
      bodies.set(key, `${bodies.get(key) ?? ""}${match[2]}`);
    }
  }
  return bodies;
}

interface HostNode {
  type: string;
  text: string;
  props: Record<string, any>;
  children: HostNode[];
  parent: HostNode | null;
}

function hostNode(type: string, text = ""): HostNode {
  return { type, text, props: {}, children: [], parent: null };
}

const renderer = createRenderer<HostNode, HostNode>({
  patchProp(element, key, _previous, next) {
    element.props[key] = next;
  },
  insert(child, parent, anchor) {
    child.parent = parent;
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    if (index < 0) parent.children.push(child);
    else parent.children.splice(index, 0, child);
  },
  remove(child) {
    const siblings = child.parent?.children;
    const index = siblings?.indexOf(child) ?? -1;
    if (index >= 0) siblings!.splice(index, 1);
  },
  createElement(type) {
    return hostNode(type);
  },
  createText(text) {
    return hostNode("#text", text);
  },
  createComment(text) {
    return hostNode("#comment", text);
  },
  setText(node, text) {
    node.text = text;
  },
  setElementText(element, text) {
    element.children = text ? [hostNode("#text", text)] : [];
    for (const child of element.children) child.parent = element;
  },
  parentNode(node) {
    return node.parent;
  },
  nextSibling(node) {
    const siblings = node.parent?.children ?? [];
    return siblings[siblings.indexOf(node) + 1] ?? null;
  },
  querySelector() {
    return null;
  },
  setScopeId() {},
});

let Panel: Component;

beforeAll(async () => {
  const filename = panelPath;
  const source = readFileSync(filename, "utf8");
  const { descriptor, errors } = parse(source, { filename });
  if (errors.length) throw errors[0];
  const script = compileScript(descriptor, { id: "lawyer-review-panel" });
  const template = compileTemplate({
    id: "lawyer-review-panel",
    filename,
    source: descriptor.template?.content ?? "",
    compilerOptions: { bindingMetadata: script.bindings, hoistStatic: false },
  });
  if (template.errors.length) throw template.errors[0];
  const combined = `${script.content.replace("export default", "const __sfc__ =")}\n${
    template.code.replace("export function render", "function render")
  }\n__sfc__.render = render;\nexport default __sfc__;`;
  const transformed = await transformWithEsbuild(combined, filename, { loader: "ts", target: "es2022" });
  // The component under test is evaluated as a data: URL module, so relative
  // specifiers have no base to resolve against: pin every runtime import it makes.
  const code = transformed.code
    .replace(/from\s+["']vue["']/g, `from ${JSON.stringify(import.meta.resolve("vue"))}`)
    .replace(/from\s+["']lucide-vue-next["']/g, `from ${JSON.stringify(import.meta.resolve("lucide-vue-next"))}`)
    .replace(
      /from\s+["']\.\.\/\.\.\/services\/buckets\/voting["']/g,
      `from ${JSON.stringify(import.meta.resolve("../../app/services/buckets/voting.ts"))}`,
    )
    .replace(
      /from\s+["']\.\.\/\.\.\/services\/wallet\/addressUtils["']/g,
      `from ${JSON.stringify(import.meta.resolve("../../app/services/wallet/addressUtils.ts"))}`,
    );
  const module = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
  Panel = module.default;
});

afterEach(() => {
  vi.useRealTimers();
});

const metadata: LawyerReviewBucketMetadata = {
  propertyId: "42",
  cluster: "devnet",
  spvLawyer: "SpvWallet",
  developerLawyer: "DeveloperWallet",
};

function review(overrides: Partial<LawyerReviewState> = {}): LawyerReviewState {
  return {
    listingId: "42",
    assetId: "42",
    spv: { role: "spv", wallet: "SpvWallet", verdict: "pending", documentsHash: "0xspv" },
    developer: { role: "developer", wallet: "DeveloperWallet", verdict: "pending", documentsHash: "0xdeveloper" },
    attempt: 1,
    status: "SOLD_OUT",
    legalDeadline: 1_900_000_000,
    counts: { approved: 0, rejected: 0, pending: 2 },
    percentages: { approved: 0, rejected: 0, pending: 100 },
    staleAssignment: false,
    hashMismatch: false,
    settlementReady: false,
    settlement: null,
    ...overrides,
  };
}

function findAll(root: HostNode, predicate: (node: HostNode) => boolean): HostNode[] {
  return [...(predicate(root) ? [root] : []), ...root.children.flatMap((child) => findAll(child, predicate))];
}

function findOne(root: HostNode, predicate: (node: HostNode) => boolean): HostNode {
  const match = findAll(root, predicate).at(0);
  if (!match) throw new Error("Expected host node was not rendered");
  return match;
}

function byType(root: HostNode, type: string): HostNode[] {
  return findAll(root, (node) => node.type === type);
}

/** Rendered element children, with the comment placeholders that v-if leaves behind dropped. */
function elements(node: HostNode): HostNode[] {
  return node.children.filter((child) => !child.type.startsWith("#"));
}

function text(root: HostNode): string {
  return root.type === "#text" ? root.text : root.children.map(text).join(" ").replace(/\s+/g, " ").trim();
}

function mountPanel(overrides: Record<string, unknown> = {}) {
  const current = reactive<Record<string, unknown>>({
    metadata,
    review: review(),
    documentsHash: HASH,
    submissionAllowed: true,
    walletAddress: metadata.spvLawyer,
    debug: true,
    ...overrides,
  });
  const emitted: { confirm: unknown[][]; execute: unknown[][]; upload: unknown[][]; retry: unknown[][] } = {
    confirm: [],
    execute: [],
    upload: [],
    retry: [],
  };
  const listeners = {
    onConfirm: (approve: boolean) => emitted.confirm.push([approve]),
    onExecute: () => emitted.execute.push([]),
    onUpload: () => emitted.upload.push([]),
    onRetry: () => emitted.retry.push([]),
  };
  const root = hostNode("root");
  const app = renderer.createApp({ render: () => h(Panel, { ...current, ...listeners }) });
  app.mount(root);
  return {
    root,
    emitted,
    async update(next: Record<string, unknown>) {
      Object.assign(current, next);
      await nextTick();
    },
  };
}

function click(root: HostNode, label: string): HostNode {
  const button = findOne(root, (node) => node.type === "button" && text(node) === label);
  (button.props.onClick as () => void)();
  return button;
}

async function openSheet(root: HostNode, label: "Approve documents" | "Reject documents" | "Finalize deal"): Promise<HostNode> {
  click(root, label);
  await nextTick();
  return findOne(root, (node) => node.type === "dialog");
}

describe("LawyerReviewPanel", () => {
  it("renders review details only while debug mode is enabled", async () => {
    const { root, update } = mountPanel({
      debug: false,
      review: review({
        attempt: 2,
        spv: { role: "spv", wallet: "SpvWallet", verdict: "approved", documentsHash: "0xspv-approved" },
        developer: { role: "developer", wallet: "DeveloperWallet", verdict: "rejected", documentsHash: "0xdev-rejected" },
      }),
    });
    expect(byType(root, "details")).toHaveLength(0);
    expect(text(root)).not.toContain("Property 42 · devnet");

    await update({ debug: true });
    const content = text(root);
    expect(byType(root, "details")).toHaveLength(1);
    expect(content).toContain("Property 42 · devnet");
    expect(content).toContain("Attempt 2 of 2");
    expect(content).toContain("Sold out");
    expect(content).toContain("2030-03-17 17:46:40 UTC");
    expect(content).toContain("SPV lawyer approved SpvWallet");
    expect(content).toContain("0xspv-approved");
    expect(content).toContain("Developer lawyer rejected DeveloperWallet");
    expect(content).toContain("0xdev-rejected");
  });

  it("shows only the title and time remaining in the banner", () => {
    const { root } = mountPanel();
    const info = findOne(root, (node) => node.props.class === "ib-offer-info");
    expect(elements(info).map((child) => `${child.type} ${child.props.class}`)).toEqual([
      "p ib-offer-title",
      "p ib-offer-amount",
    ]);
    expect(text(findOne(info, (node) => node.props.class === "ib-offer-title"))).toBe("Lawyer document review");
    expect(text(info)).toContain("left");
    expect(text(info)).not.toContain("Sold out");
    expect(text(info)).not.toContain("approved");
    expect(text(info)).not.toContain("Property 42");
    expect(text(info)).not.toContain("devnet");
  });

  it("keeps the banner to the reference flow's head-plus-actions anatomy", () => {
    const { root } = mountPanel({ eligibleLawyer: true });
    const inner = findOne(root, (node) => node.props.class === "ib-offer-inner");
    expect(elements(inner).map((child) => child.props.class)).toEqual(["ib-offer-head", "ib-offer-actions"]);

    const head = findOne(root, (node) => node.props.class === "ib-offer-head");
    const headParts = elements(head).map((child) => String(child.props.class).split(" "));
    expect(headParts.map((classes) => [...new Set(classes.filter((name) => name.startsWith("ib-")))])).toEqual([
      ["ib-offer-icon"],
      ["ib-offer-info"],
    ]);
  });

  it("keeps feedback, links and debug details below the banner, in the follow-up column", () => {
    const { root } = mountPanel({
      debug: true,
      eligibleLawyer: true,
      error: "Indexer unavailable",
      actionError: "Wallet rejected the request",
      transactionSignatures: ["signature-one"],
    });
    const bar = findOne(root, (node) => node.props.class === "ib-offer-bar");
    expect(findAll(bar, (node) => node.type === "details" || node.props.role === "alert" || node.props.role === "status"))
      .toEqual([]);

    const followUp = findOne(root, (node) => node.props.class === "review-follow-up");
    expect(text(followUp)).toContain("Indexer unavailable");
    expect(text(followUp)).toContain("Wallet rejected the request");
    expect(byType(followUp, "a").some((link) => text(link).includes("signature-one"))).toBe(true);
    expect(byType(followUp, "details")).toHaveLength(1);
    expect(text(findOne(followUp, (node) => node.props.class === "review-details"))).toContain("Property 42 · devnet");
  });

  it("stays silent while loading without rendering review actions or details", () => {
    const { root } = mountPanel({ review: null, loading: true });
    expect(byType(root, "section")[0]!.props["aria-busy"]).toBe(true);
    expect(findAll(root, (node) => node.props.role === "status")).toHaveLength(0);
    expect(text(root)).not.toContain("Loading lawyer review");
    expect(byType(root, "dialog")).toHaveLength(0);
    expect(byType(root, "details")).toHaveLength(0);
  });

  it("announces loading errors and emits retry", () => {
    const { root, emitted } = mountPanel({ review: null, error: "Indexer unavailable" });
    expect(text(findOne(root, (node) => node.props.role === "alert"))).toContain("Indexer unavailable");
    click(root, "Retry review");
    expect(emitted.retry).toEqual([[]]);
  });

  it("shows an unavailable state when no active review exists", () => {
    const { root } = mountPanel({ review: null });
    expect(text(root)).toContain("Lawyer review is unavailable");
    expect(byType(root, "dialog")).toHaveLength(0);
  });

  it("keeps the banner out of the paint until a review state arrives", async () => {
    const { root, update } = mountPanel({ review: null });
    expect(findAll(root, (node) => String(node.props.class).includes("ib-offer-bar"))).toHaveLength(0);
    // Nothing has failed yet, so the first paint carries a polite status and no alert.
    expect(findAll(root, (node) => node.props.role === "alert")).toHaveLength(0);
    const status = findOne(root, (node) => node.props.role === "status");
    expect(status.props["aria-live"]).toBe("polite");
    expect(text(status)).toBe("Lawyer review is unavailable.");

    await update({ loading: true });
    expect(text(root)).not.toContain("Loading lawyer review");
    expect(findAll(root, (node) => node.props.role === "status")).toHaveLength(0);
    expect(findAll(root, (node) => node.props.role === "alert")).toHaveLength(0);

    await update({ review: review() });
    expect(findOne(root, (node) => node.props.class === "ib-offer-bar")).toBeDefined();
    expect(findAll(root, (node) => node.props.role === "status" && text(node).includes("review is unavailable"))).toHaveLength(0);
  });

  it("fails closed for stale assignments even if other props look actionable", () => {
    const { root } = mountPanel({
      eligibleLawyer: true,
      walletConnected: true,
      review: review({ staleAssignment: true, settlementReady: true }),
    });
    expect(text(root)).toContain("Lawyer assignments changed");
    expect(findOne(root, (node) => node.type === "button" && text(node) === "Approve documents").props.disabled).toBe(true);
    expect(byType(root, "button").some((button) => text(button).includes("Finalize deal"))).toBe(false);
  });

  it("describes hash mismatches across all decided lawyer seats", () => {
    const { root } = mountPanel({ review: review({ hashMismatch: true }) });
    expect(text(root)).toContain("The decided lawyer seats reference different document hashes");
    expect(text(root)).not.toContain("The approved seats reference different document hashes");
  });

  it("disables confirmation for missing documents and emits the optional upload action", () => {
    const { root, emitted } = mountPanel({ eligibleLawyer: true, missingDocuments: true, canUpload: true });
    expect(text(root)).toContain("One or both lawyer documents are missing");
    expect(text(root)).toContain("hash is unavailable");
    expect(findOne(root, (node) => node.type === "button" && text(node) === "Approve documents").props.disabled).toBe(true);
    click(root, "Upload replacement document");
    expect(emitted.upload).toEqual([[]]);
  });

  it("keeps the full document-set hash available in details and on the approval sheet", async () => {
    const { root } = mountPanel({ eligibleLawyer: true });
    const hash = findOne(root, (node) => node.props.title === HASH);
    expect(text(hash)).toBe("0x01234567…89abcdef");
    const dialog = await openSheet(root, "Approve documents");
    expect(text(dialog)).toContain("approve this exact document set");
    expect(findOne(dialog, (node) => node.props.title === HASH)).toBeDefined();
  });

  it("wears the sheet's own description typography on the document-set line", async () => {
    const { root } = mountPanel({ eligibleLawyer: true });
    const dialog = await openSheet(root, "Approve documents");
    const line = findOne(dialog, (node) => node.props.class === "muted ib-sheet-desc sheet-hash");
    expect(text(line)).toContain("Document set:");
    const code = findOne(line, (node) => node.type === "code");
    expect(code.props.title).toBe(HASH);
    expect(text(code)).toBe("0x01234567…89abcdef");
    // The details disclosure keeps its own hash row styling.
    expect(findOne(root, (node) => node.props.class === "document-hash")).toBeDefined();
  });

  it("exposes action errors assertively without transient notices", () => {
    const { root } = mountPanel({ actionError: "Wallet rejected the request", notice: "Review refreshed" });
    expect(text(findOne(root, (node) => node.props.role === "alert"))).toContain("Wallet rejected the request");
    expect(text(root)).not.toContain("Review refreshed");
  });

  it("keeps non-lawyers read-only without deriving eligibility from bucket metadata", () => {
    const { root } = mountPanel({ eligibleLawyer: false });
    expect(text(root)).toContain("Read-only review");
    expect(text(root)).toContain("currently assigned SPV and developer lawyers");
    expect(byType(root, "button").some((button) => text(button) === "Approve documents")).toBe(false);
  });

  it("opens a native approval sheet from the compact banner instead of rendering an inline verdict form", async () => {
    const { root, emitted } = mountPanel({ eligibleLawyer: true });
    const region = findOne(root, (node) => node.props.role === "region" && node.props["aria-label"] === "Lawyer document review");
    expect(region).toBeDefined();
    expect(byType(root, "form")).toHaveLength(0);

    const dialog = await openSheet(root, "Approve documents");
    expect(dialog.props["aria-labelledby"]).toBeTruthy();
    expect(dialog.props.role).toBeUndefined();
    expect(dialog.props["aria-modal"]).toBeUndefined();
    expect(text(dialog)).toContain("Approve documents");
    expect(findOne(dialog, (node) => node.type === "button" && text(node) === "Cancel").props.autofocus).toBe("");

    click(dialog, "Submit review");
    expect(emitted.confirm).toEqual([[true]]);
  });

  it("emits rejection from its own confirmation sheet", async () => {
    const { root, emitted } = mountPanel({ eligibleLawyer: true });
    const dialog = await openSheet(root, "Reject documents");
    expect(text(dialog)).toContain("Reject documents");
    click(dialog, "Submit review");
    expect(emitted.confirm).toEqual([[false]]);
  });

  it("locks confirmation immediately after submission to prevent duplicates", async () => {
    const { root, emitted } = mountPanel({ eligibleLawyer: true });
    const dialog = await openSheet(root, "Approve documents");
    click(dialog, "Submit review");
    await nextTick();
    expect(findOne(root, (node) => node.type === "button" && text(node) === "Approve documents").props.disabled).toBe(true);
    click(dialog, "Submit review");
    expect(emitted.confirm).toEqual([[true]]);
  });

  it("shows approved instead of review actions when the Indexer reflects the submitted verdict", async () => {
    const { root, emitted, update } = mountPanel({ eligibleLawyer: true });
    const dialog = await openSheet(root, "Approve documents");
    click(dialog, "Submit review");
    await update({
      review: review({ spv: { role: "spv", wallet: "SpvWallet", verdict: "approved", documentsHash: HASH } }),
      confirming: false,
    });
    expect(text(findOne(root, (node) => node.props.class === "ib-offer-actions"))).toBe("approved");
    expect(byType(root, "button").some((button) => text(button) === "Approve documents")).toBe(false);
    click(dialog, "Submit review");
    expect(emitted.confirm).toEqual([[true]]);
  });

  it("shows approved only for the connected lawyer's own verdict", async () => {
    const { root, update } = mountPanel({
      eligibleLawyer: true,
      submissionAllowed: false,
      review: review({ spv: { role: "spv", wallet: "SpvWallet", verdict: "approved", documentsHash: HASH } }),
    });
    expect(text(findOne(root, (node) => node.props.class === "ib-offer-actions"))).toBe("approved");
    expect(byType(root, "button").some((button) => text(button) === "Approve documents")).toBe(false);

    await update({ walletAddress: metadata.developerLawyer, submissionAllowed: true });
    expect(findOne(root, (node) => node.type === "button" && text(node) === "Approve documents").props.disabled).toBe(false);
  });

  it("resets the confirmation lock when the acting wallet changes", async () => {
    const { root, emitted, update } = mountPanel({ eligibleLawyer: true });
    const dialog = await openSheet(root, "Approve documents");
    click(dialog, "Submit review");
    await update({
      walletAddress: metadata.developerLawyer,
      review: review({ spv: { role: "spv", wallet: "SpvWallet", verdict: "approved", documentsHash: HASH } }),
      confirming: false,
    });
    expect(findOne(root, (node) => node.type === "button" && text(node) === "Approve documents").props.disabled).toBe(false);
    click(dialog, "Submit review");
    expect(emitted.confirm).toEqual([[true], [true]]);
  });

  it("allows confirmation for a new review attempt or document set", async () => {
    const attempt = mountPanel({ eligibleLawyer: true });
    const attemptDialog = await openSheet(attempt.root, "Approve documents");
    click(attemptDialog, "Submit review");
    await attempt.update({ review: review({ attempt: 2 }) });
    expect(findOne(attempt.root, (node) => node.type === "button" && text(node) === "Approve documents").props.disabled).toBe(false);

    const documents = mountPanel({ eligibleLawyer: true });
    const documentsDialog = await openSheet(documents.root, "Approve documents");
    click(documentsDialog, "Submit review");
    await documents.update({ documentsHash: `0x${"ab".repeat(32)}` });
    expect(findOne(documents.root, (node) => node.type === "button" && text(node) === "Approve documents").props.disabled).toBe(false);
  });

  it("allows confirmation retry after an action error", async () => {
    const { root, emitted, update } = mountPanel({ eligibleLawyer: true });
    const dialog = await openSheet(root, "Approve documents");
    click(dialog, "Submit review");
    await update({ actionError: "Transaction failed", confirming: false });
    expect(byType(root, "dialog")).toHaveLength(1);
    expect(findOne(root, (node) => node.type === "button" && text(node) === "Approve documents").props.disabled).toBe(false);
    expect(text(dialog)).toContain("Transaction failed");
    expect(findOne(dialog, (node) => node.type === "button" && text(node) === "Submit review").props.disabled).toBe(false);
    click(dialog, "Submit review");
    expect(emitted.confirm).toEqual([[true], [true]]);
  });

  it("reacts to the legal deadline without a refresh and blocks late sheet actions with visible feedback", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_899_999_999_000);
    const { root, emitted } = mountPanel({ eligibleLawyer: true });
    const dialog = await openSheet(root, "Approve documents");

    await vi.advanceTimersByTimeAsync(2_000);
    await nextTick();
    expect(findOne(root, (node) => node.type === "button" && text(node) === "Approve documents").props.disabled).toBe(true);
    expect(findOne(dialog, (node) => node.type === "button" && text(node) === "Submit review").props.disabled).toBe(true);
    expect(text(dialog)).toContain("The legal review deadline has passed");
    click(dialog, "Submit review");
    expect(emitted.confirm).toEqual([]);

    click(dialog, "Cancel");
    await nextTick();
    expect(byType(root, "dialog")).toHaveLength(0);
    click(root, "Approve documents");
    await nextTick();
    expect(byType(root, "dialog")).toHaveLength(0);
    expect(text(root)).toContain("The legal review deadline has passed");
  });

  it("prevents Escape dismissal during submission and explains the delay in a live status", async () => {
    const { root, update } = mountPanel({ eligibleLawyer: true });
    const dialog = await openSheet(root, "Approve documents");
    await update({ confirming: true });
    expect(text(dialog)).not.toContain("Confirm the transaction in your wallet");
    let prevented = false;
    (dialog.props.onCancel as (event: { preventDefault: () => void }) => void)({ preventDefault: () => { prevented = true } });
    await nextTick();
    expect(prevented).toBe(true);
    expect(text(dialog)).toContain("Wait for the wallet transaction to finish");
    expect(findOne(dialog, (node) => node.props.role === "status").props["aria-live"]).toBe("polite");
  });

  it("links submitted signatures to the correct cluster explorer", () => {
    const devnet = mountPanel({ transactionSignatures: ["signature/one"] });
    const devnetLink = findOne(devnet.root, (node) => node.type === "a" && text(node).includes("signature/one"));
    expect(devnetLink.props.href).toBe("https://solscan.io/tx/signature%2Fone?cluster=devnet");
    expect(devnetLink.props.target).toBe("_blank");
    expect(devnetLink.props.rel).toBe("noopener");

    const mainnet = mountPanel({
      metadata: { ...metadata, cluster: "mainnet" },
      transactionSignatures: ["mainnet-signature"],
    });
    expect(findOne(mainnet.root, (node) => node.type === "a").props.href).toBe("https://solscan.io/tx/mainnet-signature");
  });

  it("shows the finalize trigger only to a connected wallet when settlement is ready", async () => {
    const { root, update } = mountPanel({ walletConnected: true });
    expect(byType(root, "button").some((button) => text(button).includes("Finalize deal"))).toBe(false);
    expect(text(root)).toContain("not ready");
    await update({ review: review({ status: "LEGAL", settlementReady: true }), walletConnected: false });
    expect(byType(root, "button").some((button) => text(button).includes("Finalize deal"))).toBe(false);
    expect(text(root)).toContain("Connect a wallet");
    await update({ walletConnected: true });
    expect(byType(root, "button").some((button) => text(button) === "Finalize deal")).toBe(true);
  });

  it("honors the orchestration-derived execute gate for deadlines and eligibility", () => {
    const { root } = mountPanel({
      walletConnected: true,
      executeAllowed: false,
      review: review({ status: "LEGAL", settlementReady: true }),
    });
    expect(byType(root, "button").some((button) => text(button).includes("Finalize deal"))).toBe(false);
    expect(text(root)).toContain("not ready");
  });

  it("confirms execution through a finalize sheet titled like its trigger", async () => {
    const { root, emitted } = mountPanel({
      eligibleLawyer: false,
      walletConnected: true,
      review: review({ status: "LEGAL", settlementReady: true }),
    });
    const dialog = await openSheet(root, "Finalize deal");
    expect(text(findOne(dialog, (node) => node.type === "h3"))).toBe("Finalize deal");
    click(dialog, "Execute deal");
    expect(emitted.execute).toEqual([[]]);
    expect(emitted.confirm).toEqual([]);
  });

  it("disables finalization and announces its busy state while executing", () => {
    const { root } = mountPanel({
      walletConnected: true,
      executing: true,
      review: review({ status: "LEGAL", settlementReady: true }),
    });
    const finalize = findOne(root, (node) => node.type === "button" && text(node) === "Finalizing…");
    expect(finalize.props.disabled).toBe(true);
    expect(finalize.props["aria-busy"]).toBe(true);
  });

  it("counts the legal deadline down in the governance banner's relative format", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-10T10:00:00.000Z"));
    const legalDeadline = Date.parse("2026-10-10T12:15:00.000Z") / 1000;
    const { root } = mountPanel({ review: review({ legalDeadline }) });
    expect(text(root)).toContain(votingTimeLeftLabel(new Date(legalDeadline * 1000).toISOString()));
    expect(text(root)).toContain("2h 15m left");

    await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000);
    await nextTick();
    expect(text(root)).toContain("Closed");
  });

  it("wears the shared banner and sheet rule set instead of a per-component copy", () => {
    const shared = ruleBodies(readFileSync(sharedStylesPath, "utf8"));
    const panel = ruleBodies(styleBlock(readFileSync(panelPath, "utf8")));
    const page = ruleBodies(styleBlock(readFileSync(pagePath, "utf8")));
    for (const selector of SHARED_SURFACE_SELECTORS) {
      expect(shared.get(selector) ?? "", `shared rule for ${selector}`).not.toBe("");
      expect(panel.has(selector), `panel re-declares ${selector}`).toBe(false);
      expect(page.has(selector), `page re-declares ${selector}`).toBe(false);
    }

    // The panel styles nothing of the shared surface itself.
    expect([...panel.keys()].filter((selector) => selector.includes(".ib-"))).toEqual([]);
    // The page keeps only its drag-to-dismiss extras on the shared sheet.
    expect(page.get(".ib-offer-sheet")).toContain("touch-action: none");
    expect(page.get(".ib-offer-sheet")).not.toContain("padding");

    // The values the panel had drifted on, taken from the reference flow.
    expect(shared.get(".ib-offer-inner")).toContain("gap: 12px");
    expect(shared.get(".ib-offer-inner")).toContain("padding: 16px 48px");
    expect(shared.get(".ib-offer-amount")).toContain("font-size: 14px");
    expect(shared.get(".ib-offer-note")).toContain("font-size: 12px");
    expect(shared.get(".ib-offer-note")).toContain("text-align: center");
    expect(shared.get(".ib-offer-action")).toContain("white-space: nowrap");
    expect(shared.get(".ib-offer-action")).not.toContain("min-height");
    expect(shared.get(".ib-sheet-actions .btn")).not.toContain("min-height");
    expect(shared.get(".ib-sheet-error")).toContain("font-size: 13px");
    expect(shared.get(".ib-sheet-error")).not.toContain("background");

    // Buttons stack at the chat column width in both flows.
    expect(readFileSync(sharedStylesPath, "utf8")).toMatch(
      /@media \(max-width: 840px\)[\s\S]*?\.ib-offer-actions\s*\{[^}]*flex-direction: column/,
    );

    const panelSource = readFileSync(panelPath, "utf8");
    expect(panelSource).toContain('class="ib-sheet-error"');
    // The review details grid stacks on the banner's breakpoint, not its own.
    expect(panelSource).toMatch(/@media \(max-width: 840px\) \{[\s\S]*?\.review-summary,[\s\S]*?\.seat-list \{/);
    expect(panelSource).not.toContain("@media (max-width: 640px)");
  });
});

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { compileScript, compileTemplate, parse } from "@vue/compiler-sfc";
import { createRenderer, h, nextTick, reactive, type Component } from "vue";
import { transformWithEsbuild } from "vite";
import { beforeAll, describe, expect, it } from "vitest";
import type { LawyerReviewBucketMetadata, LawyerReviewState } from "../../app/services/lawyer/types";

const HASH = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

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
  const filename = fileURLToPath(new URL("../../app/components/lawyer/LawyerReviewPanel.vue", import.meta.url));
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
  const code = transformed.code.replace(/from\s+["']vue["']/g, `from ${JSON.stringify(import.meta.resolve("vue"))}`);
  const module = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
  Panel = module.default;
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
    legalDeadline: 1_700_000_000,
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

function submit(form: HostNode) {
  (form.props.onSubmit as (event: unknown) => void)({ preventDefault() {} });
}

describe("LawyerReviewPanel", () => {
  it("renders property, cluster, attempt, status, and deadline", () => {
    const { root } = mountPanel({ review: review({ attempt: 2 }) });
    const content = text(root);
    expect(content).toContain("Property 42");
    expect(content).toContain("devnet");
    expect(content).toContain("Attempt 2");
    expect(content).toContain("Sold out");
    expect(content).toContain("2023-11-14 22:13:20 UTC");
  });

  it("renders both seat wallets, verdicts, and document hashes", () => {
    const { root } = mountPanel({
      review: review({
        spv: { role: "spv", wallet: "SpvWallet", verdict: "approved", documentsHash: "0xspv-approved" },
        developer: { role: "developer", wallet: "DeveloperWallet", verdict: "rejected", documentsHash: "0xdev-rejected" },
      }),
    });
    const content = text(root);
    expect(content).toContain("SPV lawyer");
    expect(content).toContain("SpvWallet");
    expect(content).toContain("approved");
    expect(content).toContain("0xspv-approved");
    expect(content).toContain("Developer lawyer");
    expect(content).toContain("DeveloperWallet");
    expect(content).toContain("rejected");
    expect(content).toContain("0xdev-rejected");
  });

  it("uses labelled native progress meters for zero approval, rejection, and full pending", () => {
    const { root } = mountPanel();
    const meters = byType(root, "progress");
    expect(meters).toHaveLength(3);
    expect(meters.map((meter) => [meter.props.value, meter.props.max])).toEqual([[0, "100"], [0, "100"], [100, "100"]]);
    for (const label of byType(root, "label").filter((node) => ["Approved", "Rejected", "Pending"].includes(text(node)))) {
      const meter = findOne(root, (node) => node.type === "progress" && node.props.id === label.props.for);
      expect(meter).toBeDefined();
    }
    expect(text(root)).toContain("0 of 2 · 0%");
    expect(text(root)).toContain("2 of 2 · 100%");
  });

  it("renders 50 percent approved and pending meters", () => {
    const { root } = mountPanel({
      review: review({
        spv: { role: "spv", wallet: "SpvWallet", verdict: "approved", documentsHash: HASH },
        counts: { approved: 1, rejected: 0, pending: 1 },
        percentages: { approved: 50, rejected: 0, pending: 50 },
      }),
    });
    expect(byType(root, "progress").map((meter) => meter.props.value)).toEqual([50, 0, 50]);
    expect(text(root)).toContain("1 of 2 · 50%");
  });

  it("renders full approval and rejection meters at 100 percent", () => {
    const approved = mountPanel({
      review: review({
        counts: { approved: 2, rejected: 0, pending: 0 },
        percentages: { approved: 100, rejected: 0, pending: 0 },
      }),
    });
    expect(byType(approved.root, "progress").map((meter) => meter.props.value)).toEqual([100, 0, 0]);
    const rejected = mountPanel({
      review: review({
        status: "CANCELLED",
        counts: { approved: 0, rejected: 2, pending: 0 },
        percentages: { approved: 0, rejected: 100, pending: 0 },
      }),
    });
    expect(byType(rejected.root, "progress").map((meter) => meter.props.value)).toEqual([0, 100, 0]);
  });

  it("announces loading without rendering review controls", () => {
    const { root } = mountPanel({ review: null, loading: true });
    const section = byType(root, "section")[0]!;
    expect(section.props["aria-busy"]).toBe(true);
    expect(findOne(root, (node) => node.props.role === "status").children.length).toBeGreaterThan(0);
    expect(text(root)).toContain("Loading lawyer review");
    expect(byType(root, "form")).toHaveLength(0);
    expect(byType(root, "progress")).toHaveLength(0);
  });

  it("announces loading errors and emits retry", () => {
    const { root, emitted } = mountPanel({ review: null, error: "Indexer unavailable" });
    const alert = findOne(root, (node) => node.props.role === "alert");
    expect(text(alert)).toContain("Indexer unavailable");
    const retry = findOne(root, (node) => node.type === "button" && text(node) === "Retry review");
    (retry.props.onClick as () => void)();
    expect(emitted.retry).toEqual([[]]);
  });

  it("shows an unavailable state when no active review exists", () => {
    const { root } = mountPanel({ review: null });
    expect(text(root)).toContain("Lawyer review is unavailable");
    expect(byType(root, "form")).toHaveLength(0);
  });

  it("fails closed for stale assignments even if other props look actionable", () => {
    const { root } = mountPanel({
      eligibleLawyer: true,
      walletConnected: true,
      review: review({ staleAssignment: true, settlementReady: true }),
    });
    expect(text(root)).toContain("Lawyer assignments changed");
    expect(byType(root, "fieldset")[0]!.props.disabled).toBe(true);
    expect(byType(root, "button").some((button) => text(button).includes("Execute deal"))).toBe(false);
  });

  it("disables confirmation for missing documents and emits the optional upload action", () => {
    const { root, emitted } = mountPanel({ eligibleLawyer: true, missingDocuments: true, canUpload: true });
    expect(text(root)).toContain("One or both lawyer documents are missing");
    expect(text(root)).toContain("hash is unavailable");
    expect(byType(root, "fieldset")[0]!.props.disabled).toBe(true);
    const upload = findOne(root, (node) => node.type === "button" && text(node) === "Upload replacement document");
    (upload.props.onClick as () => void)();
    expect(emitted.upload).toEqual([[]]);
  });

  it("shows the shortened current document-set hash with the full hash available", () => {
    const { root } = mountPanel({ eligibleLawyer: true });
    const hash = findOne(root, (node) => node.props.title === HASH);
    expect(text(hash)).toBe("0x01234567…89abcdef");
    expect(text(root)).toContain("Confirm this exact document set");
  });

  it("exposes action errors assertively and notices politely", () => {
    const { root } = mountPanel({ actionError: "Wallet rejected the request", notice: "Review refreshed" });
    const alert = findOne(root, (node) => node.props.role === "alert");
    expect(text(alert)).toContain("Wallet rejected the request");
    const status = findOne(root, (node) => node.props.role === "status" && text(node).includes("Review refreshed"));
    expect(status.props["aria-live"]).toBe("polite");
  });

  it("keeps non-lawyers read-only without deriving eligibility from bucket metadata", () => {
    const { root } = mountPanel({ eligibleLawyer: false });
    expect(text(root)).toContain("Read-only review");
    expect(text(root)).toContain("currently assigned SPV and developer lawyers");
    expect(byType(root, "form")).toHaveLength(0);
  });

  it("renders an eligible lawyer form with explicit required radio controls", () => {
    const { root } = mountPanel({ eligibleLawyer: true });
    expect(byType(root, "form")).toHaveLength(1);
    expect(text(byType(root, "legend")[0]!)).toBe("Document verdict");
    const radios = byType(root, "input").filter((input) => input.props.type === "radio");
    expect(radios.map((radio) => radio.props.value)).toEqual(["approve", "reject"]);
    expect(radios.every((radio) => Object.hasOwn(radio.props, "required"))).toBe(true);
    expect(new Set(radios.map((radio) => radio.props.name)).size).toBe(1);
    expect(byType(root, "label").some((label) => text(label) === "Approve")).toBe(true);
    expect(byType(root, "label").some((label) => text(label) === "Reject")).toBe(true);
  });

  it("emits confirm(true) for approval", () => {
    const { root, emitted } = mountPanel({ eligibleLawyer: true });
    submit(byType(root, "form")[0]!);
    expect(emitted.confirm).toEqual([[true]]);
    expect(emitted.execute).toEqual([]);
  });

  it("emits confirm(false) after selecting rejection", async () => {
    const { root, emitted } = mountPanel({ eligibleLawyer: true });
    const reject = findOne(root, (node) => node.type === "input" && node.props.value === "reject");
    (reject.props.onChange as () => void)();
    await nextTick();
    submit(byType(root, "form")[0]!);
    expect(emitted.confirm).toEqual([[false]]);
  });

  it("locks confirmation immediately after submission to prevent duplicates", async () => {
    const { root, emitted } = mountPanel({ eligibleLawyer: true });
    submit(byType(root, "form")[0]!);
    await nextTick();
    const button = findOne(root, (node) => node.type === "button" && text(node).includes("Submit"));
    expect(button.props.disabled).toBe(true);
    submit(byType(root, "form")[0]!);
    expect(emitted.confirm).toEqual([[true]]);
  });

  it("keeps confirmation locked when the Indexer reflects the submitted verdict", async () => {
    const { root, emitted, update } = mountPanel({ eligibleLawyer: true });
    submit(byType(root, "form")[0]!);
    await update({
      review: review({
        spv: { role: "spv", wallet: "SpvWallet", verdict: "approved", documentsHash: HASH },
      }),
      confirming: false,
    });
    const button = findOne(root, (node) => node.type === "button" && text(node).includes("Submit"));
    expect(button.props.disabled).toBe(true);
    submit(byType(root, "form")[0]!);
    expect(emitted.confirm).toEqual([[true]]);
  });

  it("keeps an already-decided lawyer disabled without showing a submitted state", () => {
    const { root, emitted } = mountPanel({
      eligibleLawyer: true,
      submissionAllowed: false,
      review: review({
        spv: { role: "spv", wallet: "SpvWallet", verdict: "approved", documentsHash: HASH },
      }),
    });
    const button = findOne(root, (node) => node.type === "button" && text(node).includes("Submit"));
    expect(button.props.disabled).toBe(true);
    expect(text(button)).toBe("Submit document verdict");
    submit(byType(root, "form")[0]!);
    expect(emitted.confirm).toEqual([]);
  });

  it("resets the confirmation lock when the acting wallet changes", async () => {
    const { root, emitted, update } = mountPanel({ eligibleLawyer: true });
    submit(byType(root, "form")[0]!);
    await update({
      walletAddress: metadata.developerLawyer,
      review: review({
        spv: { role: "spv", wallet: "SpvWallet", verdict: "approved", documentsHash: HASH },
      }),
      confirming: false,
    });
    const button = findOne(root, (node) => node.type === "button" && text(node).includes("Submit"));
    expect(text(button)).toBe("Submit document verdict");
    expect(button.props.disabled).toBe(false);
    submit(byType(root, "form")[0]!);
    expect(emitted.confirm).toEqual([[true], [true]]);
  });

  it("allows confirmation for a new review attempt", async () => {
    const { root, update } = mountPanel({ eligibleLawyer: true });
    submit(byType(root, "form")[0]!);
    await update({ review: review({ attempt: 2 }) });
    const button = findOne(root, (node) => node.type === "button" && text(node).includes("Submit"));
    expect(button.props.disabled).toBe(false);
  });

  it("allows confirmation for a new document set", async () => {
    const { root, update } = mountPanel({ eligibleLawyer: true });
    submit(byType(root, "form")[0]!);
    await update({ documentsHash: `0x${"ab".repeat(32)}` });
    const button = findOne(root, (node) => node.type === "button" && text(node).includes("Submit"));
    expect(button.props.disabled).toBe(false);
  });

  it("allows confirmation retry after an action error", async () => {
    const { root, update } = mountPanel({ eligibleLawyer: true });
    submit(byType(root, "form")[0]!);
    await update({ actionError: "Transaction failed", confirming: false });
    const button = findOne(root, (node) => node.type === "button" && text(node).includes("Submit"));
    expect(button.props.disabled).toBe(false);
  });

  it("links submitted signatures to the devnet explorer with an escaped signature", () => {
    const { root } = mountPanel({ transactionSignatures: ["signature/one"] });
    const link = findOne(root, (node) => node.type === "a" && text(node).includes("signature/one"));
    expect(link.props.href).toBe("https://solscan.io/tx/signature%2Fone?cluster=devnet");
    expect(link.props.target).toBe("_blank");
    expect(link.props.rel).toBe("noopener");
  });

  it("links submitted signatures to mainnet without a devnet cluster override", () => {
    const { root } = mountPanel({
      metadata: { ...metadata, cluster: "mainnet" },
      transactionSignatures: ["mainnet-signature"],
    });
    const link = findOne(root, (node) => node.type === "a" && text(node).includes("mainnet-signature"));
    expect(link.props.href).toBe("https://solscan.io/tx/mainnet-signature");
  });

  it("shows execute deal only to a connected wallet when settlement is ready", async () => {
    const { root, update } = mountPanel({ walletConnected: true });
    expect(byType(root, "button").some((button) => text(button).includes("Execute deal"))).toBe(false);
    expect(text(root)).toContain("not ready");
    await update({ review: review({ status: "LEGAL", settlementReady: true }), walletConnected: false });
    expect(byType(root, "button").some((button) => text(button).includes("Execute deal"))).toBe(false);
    expect(text(root)).toContain("Connect a wallet");
    await update({ walletConnected: true });
    expect(byType(root, "button").some((button) => text(button) === "Execute deal")).toBe(true);
  });

  it("honors the orchestration-derived execute gate for deadlines and eligibility", () => {
    const { root } = mountPanel({
      walletConnected: true,
      executeAllowed: false,
      review: review({ status: "LEGAL", settlementReady: true }),
    });
    expect(byType(root, "button").some((button) => text(button).includes("Execute deal"))).toBe(false);
    expect(text(root)).toContain("not ready");
  });

  it("lets a read-only connected wallet emit execute when ready", () => {
    const { root, emitted } = mountPanel({
      eligibleLawyer: false,
      walletConnected: true,
      review: review({ status: "LEGAL", settlementReady: true }),
    });
    const execute = findOne(root, (node) => node.type === "button" && text(node) === "Execute deal");
    (execute.props.onClick as () => void)();
    expect(emitted.execute).toEqual([[]]);
    expect(emitted.confirm).toEqual([]);
  });

  it("disables execution and announces its busy state while executing", () => {
    const { root } = mountPanel({
      walletConnected: true,
      executing: true,
      review: review({ status: "LEGAL", settlementReady: true }),
    });
    const execute = findOne(root, (node) => node.type === "button" && text(node).includes("Executing deal"));
    expect(execute.props.disabled).toBe(true);
    expect(execute.props["aria-busy"]).toBe(true);
  });
});

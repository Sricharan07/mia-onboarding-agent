import assert from "node:assert/strict";
import test from "node:test";
import { createHash, webcrypto } from "node:crypto";
import { JSDOM } from "jsdom";
import { AgentObservationCollector } from "../src/context/AgentObservationCollector.js";
import { DomAgentActor } from "../src/agent/DomAgentActuator.js";
import type { MiaShadowCursor } from "../src/cursor/MiaShadowCursor.js";
import type { ActionDirective, MiaOptions } from "../src/types/index.js";
import { MiaAssistantPanel } from "../src/ui/MiaAssistantPanel.js";

test("assistant panel preserves its controls across status and voice updates", () => {
  const cleanup = installDom("");
  try {
    const panel = new MiaAssistantPanel({
      voiceEnabled: true,
      onAsk: async () => undefined,
      onToggleVoice: async () => undefined,
      onStop: async () => undefined,
      styleNonce: "test-csp-nonce"
    });
    panel.mount();
    panel.setStatus("thinking");
    panel.setVoiceActive(true);
    panel.setStatus("idle");

    const host = document.querySelector<HTMLElement>("[data-mia-assistant-panel]")!;
    const root = host.shadowRoot!;
    const style = root.querySelector("style")?.textContent ?? "";
    const launcher = root.querySelector<HTMLButtonElement>("[data-launcher]")!;
    assert.ok(launcher);
    assert.equal(root.querySelector("style")?.nonce, "test-csp-nonce");
    assert.match(style, /:host\{[^}]*position:fixed;inset:0;[^}]*pointer-events:none/);
    assert.match(style, /\.mia-shell\{[^}]*position:absolute;[^}]*pointer-events:auto/);
    assert.equal(root.querySelector("[data-status-label]")?.textContent, "Ready");
    assert.equal(root.querySelector("[data-launcher-status]")?.textContent, "Ready");
    assert.equal(root.querySelector("[data-shell]")?.getAttribute("data-status"), "idle");
    assert.equal(root.querySelectorAll("button").length, 5);

    launcher.click();
    assert.equal(root.querySelector("[data-panel]")?.hasAttribute("hidden"), false);
    root.querySelector("[data-composer]")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.equal(root.querySelector("[data-panel]")?.hasAttribute("hidden"), true);
    panel.destroy();
  } finally {
    cleanup();
  }
});

test("semantic observer traverses open shadow roots, preserves stable IDs, and redacts secrets", () => {
  const cleanup = installDom(`
    <main>
      <button data-mia-key="create-lead">Create lead</button>
      <form><button data-mia-key="continue">Continue</button></form>
      <label>Password<input type="password" value="super-secret-password"></label>
      <section data-private>Private customer 4111 1111 1111 1111</section>
      <div id="shadow-host"></div>
    </main>
  `);
  try {
    const host = document.querySelector<HTMLElement>("#shadow-host")!;
    host.attachShadow({ mode: "open" }).innerHTML = `<button aria-label="Shadow action">Internal label</button>`;
    const collector = new AgentObservationCollector(options());
    const first = collector.collect();
    const create = first.nodes.find((node) => node.elementKey === "create-lead");
    assert.ok(create);
    assert.ok(first.nodes.some((node) => node.name === "Shadow action"));
    const submit = first.nodes.find((node) => node.elementKey === "continue");
    assert.equal(submit?.inputType, "submit");
    assert.equal(submit?.formAssociated, true);
    assert.equal(submit?.formSubmitter, true);
    const password = first.nodes.find((node) => node.inputType === "password");
    assert.equal(password?.sensitive, true);
    assert.equal(password?.value, undefined);
    assert.equal(first.pageText?.includes("super-secret-password"), false);
    assert.equal(first.pageText?.includes("Private customer"), false);
    assert.equal(first.pageText?.includes("4111"), false);

    const old = document.querySelector("[data-mia-key='create-lead']")!;
    const replacement = document.createElement("button");
    replacement.dataset.miaKey = "create-lead";
    replacement.textContent = "Create lead";
    old.replaceWith(replacement);
    const second = collector.collect();
    assert.equal(second.nodes.find((node) => node.elementKey === "create-lead")?.nodeId, create.nodeId);
    collector.destroy();
  } finally {
    cleanup();
  }
});

test("semantic observer and actor handle controls from a same-origin iframe realm", async () => {
  const cleanup = installDom(`<main><iframe title="Embedded editor"></iframe></main>`);
  try {
    const frame = document.querySelector<HTMLIFrameElement>("iframe")!;
    const frameWindow = frame.contentWindow!;
    frame.contentDocument!.body.innerHTML = `<label>Company<input data-mia-key="frame-company" value="Northstar"></label>`;
    Object.defineProperty(frameWindow.HTMLElement.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => new frameWindow.DOMRect(12, 16, 190, 40)
    });
    Object.defineProperty(frameWindow.HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => undefined });

    const collector = new AgentObservationCollector(options());
    const observation = collector.collect();
    const input = observation.nodes.find((node) => node.elementKey === "frame-company");
    assert.ok(input);
    assert.equal(input.role, "textbox");
    assert.equal(input.name, "Company");
    assert.equal(input.inputType, "text");
    assert.equal(input.value, "Northstar");
    assert.ok(input.frameId);

    const cursor = { navigateTo: () => undefined, returnToCursor: () => undefined } as unknown as MiaShadowCursor;
    const actor = new DomAgentActor({ collector, cursor, config: options() });
    const result = await actor.executeBatch([
      directive({ type: "fill", targetNode: input.nodeId, value: "Avery Labs", risk: "reversible_write", label: "Company" })
    ], observation, new AbortController().signal);
    assert.equal(result.receipts[0]?.status, "completed");
    assert.equal((frame.contentDocument!.querySelector("input") as HTMLInputElement).value, "Avery Labs");
    collector.destroy();
  } finally {
    cleanup();
  }
});

test("DOM actor fills and verifies a live control and never executes a manual action", async () => {
  const cleanup = installDom(`<main><label>Lead name<input data-mia-key="lead-name"></label><button data-mia-key="save">Save draft</button></main>`);
  try {
    const collector = new AgentObservationCollector(options());
    const observation = collector.collect();
    const input = observation.nodes.find((node) => node.elementKey === "lead-name")!;
    const cursorCalls: string[] = [];
    const cursor = {
      navigateTo: (_x: number, _y: number, label: string) => cursorCalls.push(label),
      returnToCursor: () => undefined
    } as unknown as MiaShadowCursor;
    const actor = new DomAgentActor({ collector, cursor, config: options() });
    const fill = directive({ type: "fill", targetNode: input.nodeId, value: "Avery", risk: "reversible_write" });
    const filled = await actor.executeBatch([fill], observation, new AbortController().signal);
    assert.equal(filled.receipts[0]?.status, "completed");
    assert.equal((document.querySelector("input") as HTMLInputElement).value, "Avery");
    assert.deepEqual(cursorCalls, ["Lead name"]);

    const manual = directive({ type: "fill", targetNode: input.nodeId, value: "should-not-run", risk: "manual" });
    const protectedResult = await actor.executeBatch([manual], collector.collect(), new AbortController().signal);
    assert.equal(protectedResult.receipts[0]?.status, "manual");
    assert.equal((document.querySelector("input") as HTMLInputElement).value, "Avery");
    collector.destroy();
  } finally {
    cleanup();
  }
});

test("DOM actor rejects no-op clicks, stale mapped targets, and immutable controls", async () => {
  const cleanup = installDom(`
    <main>
      <button id="noop">No operation</button>
      <output id="background-status">Idle</output>
      <button id="toggle" aria-expanded="false">Open details</button>
      <input id="disabled" aria-label="Disabled value" disabled value="unchanged">
      <input id="readonly" aria-label="Read-only value" readonly value="unchanged">
      <button id="stale">Replacement action</button>
      <form id="protected-form"><button id="submit">Continue</button></form>
    </main>
  `);
  try {
    document.querySelector("#noop")!.addEventListener("click", () => {
      window.setTimeout(() => { document.querySelector("#background-status")!.textContent = "Background refresh"; }, 40);
    });
    document.querySelector("#toggle")!.addEventListener("click", (event) => {
      (event.currentTarget as HTMLElement).setAttribute("aria-expanded", "true");
    });
    let submitted = 0;
    document.querySelector("#protected-form")!.addEventListener("submit", (event) => { event.preventDefault(); submitted += 1; });
    const collector = new AgentObservationCollector(options());
    const observation = collector.collect();
    const node = (id: string) => observation.nodes.find((candidate) => candidate.locators.some((locator) => locator.strategy === "css" && locator.selector === `#${id}`))!;
    const cursor = { navigateTo: () => undefined, returnToCursor: () => undefined } as unknown as MiaShadowCursor;
    const actor = new DomAgentActor({ collector, cursor, config: options() });

    const noOp = await actor.executeBatch([{
      actionId: "noop_click",
      idempotencyKey: "noop_click_key",
      type: "click",
      message: "Click the no-op control",
      expectedOutcome: "The page state changes",
      risk: "reversible_write",
      target: { ref: `live:${node("noop").nodeId}`, nodeId: node("noop").nodeId, label: "No operation", role: "button", locators: [] }
    }], observation, new AbortController().signal);
    assert.equal(noOp.receipts[0]?.status, "unverified");
    assert.equal(noOp.receipts[0]?.evidence.domChanged, true, "the unrelated background mutation should be observed");
    assert.equal(noOp.receipts[0]?.evidence.immediateScopedDomChanged, false);

    const toggled = await actor.executeBatch([{
      actionId: "toggle_click",
      idempotencyKey: "toggle_click_key",
      type: "click",
      message: "Open details",
      expectedOutcome: "The details expand",
      risk: "reversible_write",
      target: { ref: `live:${node("toggle").nodeId}`, nodeId: node("toggle").nodeId, label: "Open details", role: "button", locators: [] }
    }], collector.collect(), new AbortController().signal);
    assert.equal(toggled.receipts[0]?.status, "completed");
    assert.equal(toggled.receipts[0]?.evidence.expandedChanged, true);

    const submitTarget = node("submit");
    const protectedSubmit = await actor.executeBatch([{
      actionId: "protected_submit",
      idempotencyKey: "protected_submit_key",
      type: "click",
      message: "Continue",
      expectedOutcome: "The form advances",
      risk: "reversible_write",
      target: {
        ref: `live:${submitTarget.nodeId}`,
        nodeId: submitTarget.nodeId,
        label: "Continue",
        role: "button",
        inputType: "submit",
        formAssociated: true,
        formSubmitter: true,
        locators: []
      }
    }], collector.collect(), new AbortController().signal);
    assert.equal(protectedSubmit.receipts[0]?.status, "failed");
    assert.match(protectedSubmit.receipts[0]?.message ?? "", /cannot activate native form submission/i);
    assert.equal(submitted, 0);

    document.querySelector("#noop")!.textContent = "Different operation";
    const staleLive = await actor.executeBatch([{
      actionId: "stale_live_point",
      idempotencyKey: "stale_live_point_key",
      type: "point",
      message: "Point to the original control",
      expectedOutcome: "The original control is highlighted",
      risk: "read",
      target: {
        ref: `live:${node("noop").nodeId}`,
        nodeId: node("noop").nodeId,
        tagName: "button",
        role: "button",
        label: "No operation",
        locators: []
      }
    }], observation, new AbortController().signal);
    assert.equal(staleLive.receipts[0]?.status, "failed");
    assert.match(staleLive.receipts[0]?.message ?? "", /no longer matches/i);

    for (const id of ["disabled", "readonly"] as const) {
      const target = node(id);
      const result = await actor.executeBatch([{
        actionId: `${id}_fill`,
        idempotencyKey: `${id}_fill_key`,
        type: "fill",
        message: `Fill ${id}`,
        expectedOutcome: "The field changes",
        risk: "reversible_write",
        target: { ref: `live:${target.nodeId}`, nodeId: target.nodeId, label: target.name, role: "textbox", locators: [] },
        value: "changed"
      }], collector.collect(), new AbortController().signal);
      assert.equal(result.receipts[0]?.status, "failed");
      assert.match(result.receipts[0]?.message ?? "", id === "disabled" ? /disabled/i : /read-only/i);
      assert.equal((document.querySelector(`#${id}`) as HTMLInputElement).value, "unchanged");
    }

    const staleFingerprint = createHash("sha256").update(JSON.stringify({
      route: "/dashboard/crm",
      role: "button",
      name: "Original action",
      tag: "button",
      type: undefined
    })).digest("hex");
    const stale = await actor.executeBatch([{
      actionId: "stale_point",
      idempotencyKey: "stale_point_key",
      type: "point",
      message: "Point to the scanned action",
      expectedOutcome: "The reviewed control is highlighted",
      risk: "read",
      target: {
        ref: "map:stale",
        elementKey: "stale",
        fingerprint: staleFingerprint,
        tagName: "button",
        role: "button",
        route: "/dashboard/crm",
        label: "Original action",
        locators: [{ strategy: "css", selector: "#stale" }]
      }
    }], collector.collect(), new AbortController().signal);
    assert.equal(stale.receipts[0]?.status, "failed");
    assert.match(stale.receipts[0]?.message ?? "", /no longer matches/i);
    collector.destroy();
  } finally {
    cleanup();
  }
});

test("DOM actor waits for normal-motion scrolling before positioning Mia's cursor", async () => {
  const cleanup = installDom(`<main><button id="moving-target">Stage filter</button></main>`);
  try {
    const target = document.querySelector<HTMLElement>("#moving-target")!;
    let top = 640;
    Object.defineProperty(target, "getBoundingClientRect", {
      configurable: true,
      value: () => new DOMRect(120, top, 180, 40)
    });
    Object.defineProperty(target, "scrollIntoView", {
      configurable: true,
      value: () => {
        [540, 440, 340, 240, 140].forEach((value, index) => {
          window.setTimeout(() => { top = value; }, (index + 1) * 100);
        });
      }
    });
    const collector = new AgentObservationCollector(options());
    const observation = collector.collect();
    const node = observation.nodes.find((candidate) => candidate.role === "button" && candidate.name === "Stage filter")!;
    let pointedAt: { x: number; y: number } | undefined;
    const cursor = {
      navigateTo: (x: number, y: number) => { pointedAt = { x, y }; },
      isPointingAt: () => true,
      returnToCursor: () => undefined
    } as unknown as MiaShadowCursor;
    const actor = new DomAgentActor({ collector, cursor, config: options() });
    const result = await actor.executeBatch([{
      actionId: "point_after_scroll",
      idempotencyKey: "point_after_scroll_key",
      type: "point",
      message: "Point to the Stage filter",
      expectedOutcome: "Mia's cursor reaches the Stage filter",
      risk: "read",
      target: {
        ref: `live:${node.nodeId}`,
        nodeId: node.nodeId,
        label: node.name,
        role: node.role,
        inputType: node.inputType,
        formAssociated: node.formAssociated,
        formSubmitter: node.formSubmitter,
        locators: node.locators
      }
    }], observation, new AbortController().signal);
    assert.equal(result.receipts[0]?.status, "completed", JSON.stringify(result.receipts[0]));
    assert.ok(pointedAt);
    assert.equal(Math.round(pointedAt.y), 160);
    assert.equal(result.receipts[0]?.evidence.targetVisible, true);
    collector.destroy();
  } finally {
    cleanup();
  }
});

function options(): MiaOptions {
  return {
    backendUrl: "http://localhost:4000",
    tokenProvider: async () => "test-token",
    privacy: { redactedSelectors: ["[data-private]"] }
  };
}

function directive(input: { type: "fill"; targetNode: string; value: string; risk: "manual" | "reversible_write"; label?: string }): ActionDirective {
  return {
    actionId: `action_${input.risk}`,
    idempotencyKey: `key_${input.risk}`,
    type: input.type,
    message: "Enter the lead name",
    expectedOutcome: "The lead name field contains Avery",
    risk: input.risk,
    target: { ref: `live:${input.targetNode}`, nodeId: input.targetNode, label: input.label ?? "Lead name", locators: [] },
    value: input.value
  };
}

function installDom(html: string): () => void {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
    url: "http://localhost:3001/dashboard/crm",
    pretendToBeVisual: true
  });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const globals: Record<string, unknown> = {
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    history: dom.window.history,
    navigator: dom.window.navigator,
    Document: dom.window.Document,
    ShadowRoot: dom.window.ShadowRoot,
    Node: dom.window.Node,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    HTMLSelectElement: dom.window.HTMLSelectElement,
    HTMLOptionElement: dom.window.HTMLOptionElement,
    HTMLAnchorElement: dom.window.HTMLAnchorElement,
    HTMLIFrameElement: dom.window.HTMLIFrameElement,
    MutationObserver: dom.window.MutationObserver,
    NodeFilter: dom.window.NodeFilter,
    DOMRect: dom.window.DOMRect,
    Event: dom.window.Event,
    InputEvent: dom.window.InputEvent,
    KeyboardEvent: dom.window.KeyboardEvent,
    MouseEvent: dom.window.MouseEvent,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    sessionStorage: dom.window.sessionStorage,
    innerWidth: 1280,
    innerHeight: 800,
    scrollX: 0,
    scrollY: 0,
    crypto: webcrypto
  };
  for (const [name, value] of Object.entries(globals)) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  Object.defineProperty(dom.window.HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => new dom.window.DOMRect(20, 20, 180, 40)
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => undefined });
  Object.defineProperty(dom.window, "scrollBy", { configurable: true, value: () => undefined });
  return () => {
    dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete (globalThis as Record<string, unknown>)[name];
    }
  };
}

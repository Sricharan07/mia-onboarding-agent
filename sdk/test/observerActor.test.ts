import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";
import { JSDOM } from "jsdom";
import { AgentObservationCollector } from "../src/context/AgentObservationCollector.js";
import { DomAgentActor } from "../src/agent/DomAgentActuator.js";
import type { MiaShadowCursor } from "../src/cursor/MiaShadowCursor.js";
import type { ActionDirective, MiaOptions } from "../src/types/index.js";

test("semantic observer traverses open shadow roots, preserves stable IDs, and redacts secrets", () => {
  const cleanup = installDom(`
    <main>
      <button data-mia-key="create-lead">Create lead</button>
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
      directive({ type: "fill", targetNode: input.nodeId, value: "Avery Labs", risk: "reversible_write" })
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

function options(): MiaOptions {
  return {
    backendUrl: "http://localhost:4000",
    tokenProvider: async () => "test-token",
    privacy: { redactedSelectors: ["[data-private]"] }
  };
}

function directive(input: { type: "fill"; targetNode: string; value: string; risk: "manual" | "reversible_write" }): ActionDirective {
  return {
    actionId: `action_${input.risk}`,
    idempotencyKey: `key_${input.risk}`,
    type: input.type,
    message: "Enter the lead name",
    expectedOutcome: "The lead name field contains Avery",
    risk: input.risk,
    target: { ref: `live:${input.targetNode}`, nodeId: input.targetNode, label: "Lead name", locators: [] },
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

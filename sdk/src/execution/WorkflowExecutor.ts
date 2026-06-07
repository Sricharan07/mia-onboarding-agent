import type { BackendClient } from "../client/backendClient.js";
import { CursorOverlay } from "../cursor/CursorOverlay.js";
import { highlightElement } from "../cursor/highlight.js";
import type { AssistantUI } from "../ui/AssistantUI.js";
import type { Workflow, WorkflowStep } from "../types/index.js";
import { findElement } from "./elementResolution.js";

export class WorkflowExecutor {
  private values: Record<string, string> = {};
  private cancelled = false;
  private runtimeSessionId?: string;

  constructor(private readonly options: {
    workflow: Workflow;
    backendClient: BackendClient;
    cursor: CursorOverlay;
    ui: AssistantUI;
    clientSessionId: string;
  }) {}

  async start(): Promise<void> {
    if (this.options.workflow.status !== "published") {
      throw new Error("SDK refuses to execute unpublished workflows.");
    }
    const session = await this.options.backendClient.createWorkflowSession({
      workflowId: this.options.workflow.workflowId,
      clientSessionId: this.options.clientSessionId
    });
    this.runtimeSessionId = session.runtimeSessionId;

    for (const step of this.options.workflow.steps) {
      if (this.cancelled) break;
      await this.runStep(step);
    }
    await this.options.backendClient.updateWorkflowSession({
      runtimeSessionId: this.runtimeSessionId,
      status: this.cancelled ? "cancelled" : "completed",
      values: this.values
    });
  }

  pause(): void {
    this.cancelled = true;
  }

  resume(): void {
    this.cancelled = false;
  }

  cancel(): void {
    this.cancelled = true;
  }

  private async runStep(step: WorkflowStep): Promise<void> {
    await this.log("step_started", step);
    try {
      await this.executeStep(step);
      await this.log("step_completed", step);
    } catch (error) {
      await this.log("step_failed", step, { error: error instanceof Error ? error.message : String(error) });
      if (this.runtimeSessionId) {
        await this.options.backendClient.updateWorkflowSession({
          runtimeSessionId: this.runtimeSessionId,
          status: "failed",
          currentStepId: step.id,
          values: this.values,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      throw error;
    }
  }

  private async executeStep(step: WorkflowStep): Promise<void> {
    if ("executionPolicy" in step && step.executionPolicy === "blocked") {
      throw new Error("Blocked step cannot be executed.");
    }

    if (step.type === "navigate") {
      window.history.pushState({}, "", step.route);
      window.dispatchEvent(new PopStateEvent("popstate"));
      return;
    }

    if (step.type === "ask_user") {
      this.values[step.field] = await this.options.ui.ask(step.prompt, step.inputType, step.choices);
      return;
    }

    if (step.type === "confirm") {
      const approved = await this.options.ui.confirm(step.message, step.confirmLabel, step.cancelLabel);
      if (!approved) throw new Error("User denied confirmation.");
      return;
    }

    if (step.type === "complete") {
      this.options.ui.say(step.message);
      return;
    }

    const element = step.type === "wait_for_element"
      ? await waitForElement(step.target.selector, step.target.fallbackSelectors, step.timeoutMs)
      : findElement(step.target.selector, step.target.fallbackSelectors);
    if (!element) throw new Error(`Target element not found: ${step.target.elementId}`);
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    await this.options.cursor.moveToElement(element, step.target.label ?? step.target.elementId);
    const cleanup = highlightElement(element);

    try {
      if ("executionPolicy" in step && step.executionPolicy === "requires_confirmation") {
        const approved = await this.options.ui.confirm(`Should I continue with ${step.target.label ?? step.target.elementId}?`);
        if (!approved) throw new Error("User denied confirmation.");
      }

      if ("executionPolicy" in step && step.executionPolicy === "manual_only") {
        this.options.ui.say(`Please complete ${step.target.label ?? step.target.elementId}.`);
        return;
      }

      if (step.type === "click") (element as HTMLElement).click();
      if (step.type === "focus") (element as HTMLElement).focus();
      if (step.type === "fill") setNativeValue(element, this.values[step.valueFrom] ?? "");
      if (step.type === "select") setNativeValue(element, this.values[step.valueFrom] ?? "");
      if (step.type === "wait_for_element") return;
    } finally {
      window.setTimeout(cleanup, 800);
    }
  }

  private async log(eventType: string, step: WorkflowStep, payload: Record<string, unknown> = {}): Promise<void> {
    await this.options.backendClient.logExecution({
      sessionId: this.options.clientSessionId,
      workflowId: this.options.workflow.workflowId,
      stepId: step.id,
      eventType,
      payload: { type: step.type, ...payload }
    });
  }
}

function setNativeValue(element: Element, value: string): void {
  const input = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  const valueSetter = Object.getOwnPropertyDescriptor(input, "value")?.set;
  const prototype = Object.getPrototypeOf(input);
  const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;

  if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
    prototypeValueSetter.call(input, value);
  } else if (valueSetter) {
    valueSetter.call(input, value);
  } else {
    input.value = value;
  }

  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function waitForElement(selector: string, fallbackSelectors: string[] | undefined, timeoutMs: number): Promise<Element | null> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const element = findElement(selector, fallbackSelectors);
    if (element) return element;
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }

  return null;
}

import type { BackendClient } from "../client/backendClient.js";
import type { MiaShadowCursor } from "../cursor/MiaShadowCursor.js";
import type { MiaPromptUI } from "../ui/MiaPromptUI.js";
import type { Workflow, WorkflowStep } from "../types/index.js";
import { findElement } from "./elementResolution.js";

export class WorkflowExecutor {
  private values: Record<string, string> = {};
  private cancelled = false;
  private runtimeSessionId?: string;

  constructor(private readonly options: {
    workflow: Workflow;
    backendClient: BackendClient;
    cursor: MiaShadowCursor;
    promptUi: MiaPromptUI;
    clientSessionId: string;
    onWorkflowEvent?: (event: { type: string; workflowId?: string; stepId?: string; message?: string }) => void;
  }) {}

  async start(): Promise<void> {
    if (this.options.workflow.status !== "published") {
      throw new Error("SDK refuses to execute unpublished workflows.");
    }
    this.options.onWorkflowEvent?.({ type: "workflow_started", workflowId: this.options.workflow.workflowId });
    this.options.cursor.setState("guiding");
    this.options.cursor.setBubbleText(this.options.workflow.name);
    const session = await this.options.backendClient.createWorkflowSession({
      workflowId: this.options.workflow.workflowId,
      clientSessionId: this.options.clientSessionId
    });
    this.runtimeSessionId = session.runtimeSessionId;

    for (const step of this.options.workflow.steps) {
      if (this.cancelled) break;
      await this.runStep(step);
    }
    this.options.cursor.setBubbleText("Workflow complete");
    this.options.cursor.startBubbleFade();
    this.options.cursor.returnToCursor();
    this.options.onWorkflowEvent?.({ type: "workflow_completed", workflowId: this.options.workflow.workflowId });
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
    this.options.onWorkflowEvent?.({ type: "step_started", workflowId: this.options.workflow.workflowId, stepId: step.id });
    await this.log("step_started", step);
    try {
      await this.executeStep(step);
      await this.log("step_completed", step);
      this.options.onWorkflowEvent?.({ type: "step_completed", workflowId: this.options.workflow.workflowId, stepId: step.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.options.cursor.setState("error");
      this.options.cursor.setBubbleText(message);
      this.options.promptUi.showError(message);
      this.options.onWorkflowEvent?.({ type: "step_failed", workflowId: this.options.workflow.workflowId, stepId: step.id, message });
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
      this.options.cursor.setState("guiding");
      this.options.cursor.setBubbleText(step.label ?? `Navigate to ${step.route}`);
      window.history.pushState({}, "", step.route);
      window.dispatchEvent(new PopStateEvent("popstate"));
      return;
    }

    if (step.type === "ask_user") {
      this.options.cursor.setState("guiding");
      this.options.cursor.setBubbleText(step.label ?? step.prompt);
      this.values[step.field] = await this.options.promptUi.ask(step.prompt, step.inputType, step.choices);
      return;
    }

    if (step.type === "confirm") {
      this.options.cursor.setState("guiding");
      this.options.cursor.setBubbleText(step.label ?? step.message);
      const approved = await this.options.promptUi.confirm(step.message, step.confirmLabel, step.cancelLabel);
      if (!approved) throw new Error("User denied confirmation.");
      return;
    }

    if (step.type === "complete") {
      this.options.cursor.setState("guiding");
      this.options.cursor.setBubbleText(step.message);
      this.options.cursor.startBubbleFade();
      return;
    }

    this.options.cursor.setState(step.type === "wait_for_element" ? "thinking" : "guiding");
    this.options.cursor.setBubbleText(step.label ?? step.target.label ?? step.target.elementId);
    const element = step.type === "wait_for_element"
      ? await waitForElement(step.target.selector, step.target.fallbackSelectors, step.timeoutMs)
      : findElement(step.target.selector, step.target.fallbackSelectors);
    if (!element) throw new Error(`Target element not found: ${step.target.elementId}`);
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    await wait(260);
    const center = getElementCenter(element);
    this.options.cursor.navigateTo(center.x, center.y, step.label ?? step.target.label ?? step.target.elementId);
    await wait(560);
    const cleanup = highlight(element);

    try {
      if ("executionPolicy" in step && step.executionPolicy === "requires_confirmation") {
        this.options.cursor.setState("guiding");
        this.options.cursor.setBubbleText(`Should I continue with ${step.target.label ?? step.target.elementId}?`);
        const approved = await this.options.promptUi.confirm(`Should I continue with ${step.target.label ?? step.target.elementId}?`);
        if (!approved) throw new Error("User denied confirmation.");
      }

      if ("executionPolicy" in step && step.executionPolicy === "manual_only") {
        const message = `Please complete ${step.target.label ?? step.target.elementId}.`;
        this.options.cursor.setState("guiding");
        this.options.cursor.setBubbleText(message);
        const completed = await this.options.promptUi.confirm(message, "I completed it", "Cancel");
        if (!completed) throw new Error("User cancelled manual step.");
        return;
      }

      if (step.type === "click") {
        this.options.cursor.setBubbleText(`Click ${step.target.label ?? step.target.elementId}`);
        (element as HTMLElement).click();
      }
      if (step.type === "focus") (element as HTMLElement).focus();
      if (step.type === "fill") {
        this.options.cursor.setBubbleText(`Fill ${step.target.label ?? step.target.elementId}`);
        setNativeValue(element, this.values[step.valueFrom] ?? "");
      }
      if (step.type === "select") {
        this.options.cursor.setBubbleText(`Select ${step.target.label ?? step.target.elementId}`);
        setNativeValue(element, this.values[step.valueFrom] ?? "");
      }
      if (step.type === "wait_for_element") return;
    } finally {
      window.setTimeout(cleanup, 800);
      this.options.cursor.returnToCursor();
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

function getElementCenter(element: Element): { x: number; y: number } {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2
  };
}

function highlight(element: Element): () => void {
  const target = element as HTMLElement;
  const previousOutline = target.style.outline;
  const previousOffset = target.style.outlineOffset;
  target.style.outline = "3px solid #38bdf8";
  target.style.outlineOffset = "3px";
  return () => {
    target.style.outline = previousOutline;
    target.style.outlineOffset = previousOffset;
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
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

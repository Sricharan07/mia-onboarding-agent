import type { BackendClient } from "../client/backendClient.js";
import type { MiaShadowCursor } from "../cursor/MiaShadowCursor.js";
import type { MiaPromptUI } from "../ui/MiaPromptUI.js";
import type { Workflow, WorkflowStep } from "../types/index.js";
import { prefersReducedMotion } from "../accessibility/motion.js";
import { activateElement } from "./activateElement.js";
import { findElement } from "./elementResolution.js";

export class WorkflowExecutor {
  private values: Record<string, string> = {};
  private cancelled = false;
  private paused = false;
  private abortController = new AbortController();
  private resumeWaiter?: () => void;
  private runtimeSessionId?: string;
  private currentStepId?: string;

  constructor(private readonly options: {
    workflow: Workflow;
    backendClient: BackendClient;
    cursor: MiaShadowCursor;
    promptUi: MiaPromptUI;
    clientSessionId: string;
    navigate?: (route: string) => void | Promise<void>;
    requestUserInput?: (input: { prompt: string; inputType?: string; choices?: string[]; signal?: AbortSignal }) => Promise<string>;
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
    if (!this.cancelled) {
      await this.options.backendClient.updateWorkflowSession({
        runtimeSessionId: this.runtimeSessionId,
        status: "running"
      });
    }

    for (const step of this.options.workflow.steps) {
      if (this.cancelled) break;
      await this.waitWhilePaused();
      if (this.cancelled) break;
      await this.runStep(step);
    }

    this.options.cursor.setBubbleText(this.cancelled ? "Workflow cancelled" : "Workflow complete");
    this.options.cursor.startBubbleFade();
    this.options.cursor.returnToCursor();
    this.options.onWorkflowEvent?.({ type: this.cancelled ? "workflow_cancelled" : "workflow_completed", workflowId: this.options.workflow.workflowId });
    try {
      await this.options.backendClient.updateWorkflowSession({
        runtimeSessionId: this.runtimeSessionId,
        status: this.cancelled ? "cancelled" : "completed"
      });
    } finally {
      this.clearValues();
    }
  }

  async pause(): Promise<void> {
    if (this.cancelled || this.paused) return;
    this.paused = true;
    this.options.cursor.setBubbleText("Workflow paused");
    await this.updateRuntimeStatus("paused");
  }

  async resume(): Promise<void> {
    if (this.cancelled) return;
    this.paused = false;
    const resume = this.resumeWaiter;
    this.resumeWaiter = undefined;
    resume?.();
    this.options.cursor.setBubbleText("Resuming workflow");
    await this.updateRuntimeStatus("running");
  }

  async cancel(): Promise<void> {
    this.cancelled = true;
    this.paused = false;
    this.abortController.abort();
    const resume = this.resumeWaiter;
    this.resumeWaiter = undefined;
    resume?.();
    this.options.cursor.cancelNavigation();
    this.options.cursor.setBubbleText("Workflow cancelled");
    try {
      await this.updateRuntimeStatus("cancelled");
    } finally {
      this.clearValues();
    }
  }

  private async runStep(step: WorkflowStep): Promise<void> {
    this.currentStepId = step.id;
    this.options.onWorkflowEvent?.({ type: "step_started", workflowId: this.options.workflow.workflowId, stepId: step.id });
    await this.log("step_started", step);
    await this.updateRuntimeStatus("running");
    try {
      await this.executeStep(step);
      await this.log("step_completed", step);
      await this.updateRuntimeStatus("running");
      this.options.onWorkflowEvent?.({ type: "step_completed", workflowId: this.options.workflow.workflowId, stepId: step.id });
    } catch (error) {
      if (this.cancelled) {
        await this.log("step_cancelled", step);
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.options.cursor.setState("error");
      this.options.cursor.setBubbleText(message);
      this.options.promptUi.showError(message);
      this.options.onWorkflowEvent?.({ type: "step_failed", workflowId: this.options.workflow.workflowId, stepId: step.id, message });
      await this.log("step_failed", step, { error: error instanceof Error ? error.message : String(error) });
      if (this.runtimeSessionId) {
        try {
          await this.options.backendClient.updateWorkflowSession({
            runtimeSessionId: this.runtimeSessionId,
            status: "failed",
            currentStepId: step.id,
            error: error instanceof Error ? error.message : String(error)
          });
        } finally {
          this.clearValues();
        }
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
      await this.navigate(step.route);
      return;
    }

    if (step.type === "ask_user") {
      this.options.cursor.setState("guiding");
      this.options.cursor.setBubbleText(step.label ?? step.prompt);
      this.values[step.field] = await (this.options.requestUserInput
        ? this.options.requestUserInput({ prompt: step.prompt, inputType: step.inputType, choices: step.choices, signal: this.abortController.signal })
        : this.options.promptUi.ask(step.prompt, step.inputType, step.choices, this.abortController.signal));
      return;
    }

    if (step.type === "confirm") {
      this.options.cursor.setState("guiding");
      this.options.cursor.setBubbleText(step.label ?? step.message);
      const approved = await this.options.promptUi.confirm(step.message, step.confirmLabel, step.cancelLabel, this.abortController.signal);
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
      ? await waitForElement(step.target.selector, step.target.fallbackSelectors, step.timeoutMs, this.abortController.signal)
      : findElement(step.target.selector, step.target.fallbackSelectors);
    if (!element) throw new Error(`Target element not found: ${step.target.elementId}`);
    const reduceMotion = prefersReducedMotion();
    element.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    await wait(reduceMotion ? 0 : 260, this.abortController.signal);
    const center = getElementCenter(element);
    this.options.cursor.navigateTo(center.x, center.y, step.label ?? step.target.label ?? step.target.elementId);
    await wait(reduceMotion ? 0 : 560, this.abortController.signal);
    const cleanup = highlight(element);

    try {
      if ("executionPolicy" in step && step.executionPolicy === "requires_confirmation") {
        this.options.cursor.setState("guiding");
        this.options.cursor.setBubbleText(`Should I continue with ${step.target.label ?? step.target.elementId}?`);
        const approved = await this.options.promptUi.confirm(`Should I continue with ${step.target.label ?? step.target.elementId}?`, undefined, undefined, this.abortController.signal);
        if (!approved) throw new Error("User denied confirmation.");
      }

      if ("executionPolicy" in step && step.executionPolicy === "manual_only") {
        const message = `Please complete ${step.target.label ?? step.target.elementId}.`;
        this.options.cursor.setState("guiding");
        this.options.cursor.setBubbleText(message);
        const completed = await this.options.promptUi.confirm(message, "I completed it", "Cancel", this.abortController.signal);
        if (!completed) throw new Error("User cancelled manual step.");
        return;
      }

      if (step.type === "click") {
        this.options.cursor.setBubbleText(`Click ${step.target.label ?? step.target.elementId}`);
        activateElement(element as HTMLElement);
      }
      if (step.type === "focus") (element as HTMLElement).focus();
      if (step.type === "fill") {
        const value = this.values[step.valueFrom];
        if (value === undefined) throw new Error(`Missing collected value for ${step.valueFrom}.`);
        this.options.cursor.setBubbleText(`Fill ${step.target.label ?? step.target.elementId}`);
        setNativeValue(element, value);
      }
      if (step.type === "select") {
        const value = this.values[step.valueFrom];
        if (value === undefined) throw new Error(`Missing collected value for ${step.valueFrom}.`);
        this.options.cursor.setBubbleText(`Select ${step.target.label ?? step.target.elementId}`);
        setNativeValue(element, value);
      }
      if (step.type === "wait_for_element") return;
    } finally {
      window.setTimeout(cleanup, 800);
      this.options.cursor.returnToCursor();
    }
  }

  private async log(eventType: string, step: WorkflowStep, payload: Record<string, unknown> = {}): Promise<void> {
    try {
      await this.options.backendClient.logExecution({
        sessionId: this.options.clientSessionId,
        workflowId: this.options.workflow.workflowId,
        stepId: step.id,
        eventType,
        payload: { type: step.type, ...payload }
      });
    } catch (error) {
      this.options.onWorkflowEvent?.({
        type: "workflow_log_failed",
        workflowId: this.options.workflow.workflowId,
        stepId: step.id,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async waitWhilePaused(): Promise<void> {
    while (this.paused && !this.cancelled) {
      await new Promise<void>((resolve) => {
        this.resumeWaiter = resolve;
      });
    }
  }

  private async updateRuntimeStatus(status: "running" | "paused" | "cancelled"): Promise<void> {
    if (!this.runtimeSessionId) return;
    await this.options.backendClient.updateWorkflowSession({
      runtimeSessionId: this.runtimeSessionId,
      status,
      currentStepId: this.currentStepId
    });
  }

  private clearValues(): void {
    for (const key of Object.keys(this.values)) {
      this.values[key] = "";
      delete this.values[key];
    }
  }

  private async navigate(route: string): Promise<void> {
    if (this.options.navigate) {
      await this.options.navigate(route);
      return;
    }
    window.history.pushState({}, "", route);
    window.dispatchEvent(new PopStateEvent("popstate"));
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

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let timeout: number | undefined;
    const abort = () => {
      if (timeout !== undefined) window.clearTimeout(timeout);
      reject(new Error("Workflow cancelled."));
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    timeout = window.setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
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

async function waitForElement(selector: string, fallbackSelectors: string[] | undefined, timeoutMs: number, signal?: AbortSignal): Promise<Element | null> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const element = findElement(selector, fallbackSelectors);
    if (element) return element;
    await wait(100, signal);
  }

  return null;
}

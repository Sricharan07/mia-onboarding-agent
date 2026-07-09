import type { BrowserActionResult, TargetLocator } from "../types/index.js";
import { isElementInteractable } from "./elementResolution.js";

type SupportedAction = BrowserActionResult["action"];

type ElementSnapshot = {
  url: string;
  activeElement: Element | null;
  value?: string;
  checked?: boolean;
  selectedIndex?: number;
  expanded?: string | null;
  selected?: string | null;
  pressed?: string | null;
  open?: boolean;
};

export async function executeElementAction(input: {
  element: HTMLElement;
  action: SupportedAction;
  value?: string;
  locator?: TargetLocator;
}): Promise<BrowserActionResult> {
  const preflightError = validateActionTarget(input.element, input.action);
  if (preflightError) return result("failed", input.action, preflightError, input.locator);

  const before = snapshot(input.element);
  let domMutations = 0;
  const observer = new MutationObserver((records) => {
    domMutations += records.filter((record) => !isSdkMutationTarget(record.target)).length;
  });
  observer.observe(document.documentElement, { attributes: true, childList: true, characterData: true, subtree: true });

  try {
    if (input.action === "click") input.element.click();
    if (input.action === "focus") input.element.focus({ preventScroll: true });
    if (input.action === "fill" || input.action === "select") {
      if (input.value === undefined) return result("failed", input.action, "No value was provided for this action.", input.locator);
      setNativeValue(input.element, input.value);
    }
    await settle();
  } catch (error) {
    return result("failed", input.action, error instanceof Error ? error.message : String(error), input.locator);
  } finally {
    observer.disconnect();
  }

  const after = snapshot(input.element);
  const evidence = {
    locator: input.locator,
    urlChanged: before.url !== after.url,
    focusChanged: before.activeElement !== after.activeElement,
    valueChanged: before.value !== after.value,
    checkedChanged: before.checked !== after.checked,
    selectedIndexChanged: before.selectedIndex !== after.selectedIndex,
    expandedChanged: before.expanded !== after.expanded,
    selectedChanged: before.selected !== after.selected,
    pressedChanged: before.pressed !== after.pressed,
    openChanged: before.open !== after.open,
    domMutations
  };

  if (input.action === "focus") {
    const focused = document.activeElement === input.element || input.element.contains(document.activeElement);
    return focused
      ? { status: "completed", action: input.action, message: "Focus was verified.", evidence }
      : { status: "failed", action: input.action, message: "The target did not receive focus.", evidence };
  }

  if (input.action === "fill" || input.action === "select") {
    const verified = currentValue(input.element) === input.value;
    return verified
      ? { status: "completed", action: input.action, message: "The entered value was verified.", evidence }
      : { status: "failed", action: input.action, message: "The page did not retain the entered value.", evidence };
  }

  const changed = evidence.urlChanged
    || evidence.checkedChanged
    || evidence.selectedIndexChanged
    || evidence.expandedChanged
    || evidence.selectedChanged
    || evidence.pressedChanged
    || evidence.openChanged
    || domMutations > 0;
  return changed
    ? { status: "completed", action: input.action, message: "The page response was verified.", evidence }
    : { status: "unverified", action: input.action, message: "The click was sent, but the page did not expose a verifiable change.", evidence };
}

function validateActionTarget(element: HTMLElement, action: SupportedAction): string | undefined {
  if (!isElementInteractable(element)) return "The target is not currently visible and interactive.";
  if (isDisabledElement(element)) return "The target is disabled.";
  if (action === "click" && isCoveredAtCenter(element)) return "Another page element is covering the reviewed target.";
  if (action === "fill" && !(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element.isContentEditable)) {
    return "The reviewed target is not a text input.";
  }
  if (action === "select" && !(element instanceof HTMLSelectElement)) return "The reviewed target is not a select control.";
  return undefined;
}

function isCoveredAtCenter(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return false;
  const top = document.elementFromPoint(x, y);
  return Boolean(top && top !== element && !element.contains(top));
}

function isSdkMutationTarget(node: Node): boolean {
  const element = node instanceof Element ? node : node.parentElement;
  return Boolean(element?.closest([
    "[data-mia-prompt-ui='true']",
    "[data-mia-shadow-cursor='true']",
    "[data-mia-ignore]",
    ".mia-root"
  ].join(",")));
}

function isDisabledElement(element: HTMLElement): boolean {
  if (element.closest("[inert]")) return true;
  if ("disabled" in element && Boolean(element.disabled)) return true;
  return element.getAttribute("aria-disabled") === "true";
}

function snapshot(element: HTMLElement): ElementSnapshot {
  return {
    url: window.location.href,
    activeElement: document.activeElement,
    value: currentValue(element),
    checked: element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type) ? element.checked : undefined,
    selectedIndex: element instanceof HTMLSelectElement ? element.selectedIndex : undefined,
    expanded: element.getAttribute("aria-expanded"),
    selected: element.getAttribute("aria-selected"),
    pressed: element.getAttribute("aria-pressed"),
    open: element instanceof HTMLDetailsElement ? element.open : undefined
  };
}

function currentValue(element: HTMLElement): string | undefined {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return element.value;
  if (element.isContentEditable) return element.textContent ?? "";
  return undefined;
}

function setNativeValue(element: HTMLElement, value: string): void {
  if (element.isContentEditable && !(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) {
    element.textContent = value;
  } else {
    const input = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    const ownSetter = Object.getOwnPropertyDescriptor(input, "value")?.set;
    const prototypeSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
    if (prototypeSetter && ownSetter !== prototypeSetter) prototypeSetter.call(input, value);
    else if (ownSetter) ownSetter.call(input, value);
    else input.value = value;
  }
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function settle(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 300));
}

function result(status: BrowserActionResult["status"], action: SupportedAction, message: string, locator?: TargetLocator): BrowserActionResult {
  return { status, action, message, evidence: { locator } };
}

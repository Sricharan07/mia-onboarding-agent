import type { TargetLocator } from "../types/index.js";

export type ElementTarget = {
  selector?: string;
  fallbackSelectors?: string[];
  locators?: TargetLocator[];
};

export type ElementResolution =
  | { status: "resolved"; element: HTMLElement; locator: TargetLocator }
  | { status: "not_found" | "ambiguous" | "not_interactable"; message: string };

export function resolveElement(target: ElementTarget): ElementResolution {
  const locators = targetLocators(target);
  let ambiguous = false;
  let nonInteractable = false;

  for (const locator of locators) {
    const matches = queryLocator(locator).filter((element) => !isSdkOwnedElement(element));
    const usable = matches.filter(isElementInteractable);
    if (usable.length === 1) return { status: "resolved", element: usable[0], locator };
    if (usable.length > 1) ambiguous = true;
    if (matches.length > 0 && usable.length === 0) nonInteractable = true;
  }

  if (ambiguous) {
    return { status: "ambiguous", message: "The reviewed target matches multiple visible elements on this page." };
  }
  if (nonInteractable) {
    return { status: "not_interactable", message: "The reviewed target exists but is not currently visible and interactive." };
  }
  return { status: "not_found", message: "The reviewed target is not present on this page." };
}

export function findElement(selector: string, fallbacks: string[] = []): Element | null {
  const resolution = resolveElement({ selector, fallbackSelectors: fallbacks });
  return resolution.status === "resolved" ? resolution.element : null;
}

export function isElementInteractable(element: HTMLElement): boolean {
  if (!element.isConnected) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || Number(style.opacity) === 0) return false;
  if (element.closest("[hidden],[inert],[aria-hidden='true']")) return false;
  return true;
}

function targetLocators(target: ElementTarget): TargetLocator[] {
  const configured = target.locators ?? [];
  const legacyCss = [target.selector, ...(target.fallbackSelectors ?? [])]
    .filter((selector): selector is string => Boolean(selector))
    .filter(isStandardCssSelector)
    .map((selector) => ({ strategy: "css" as const, selector }));
  const seen = new Set<string>();
  return [...configured, ...legacyCss].filter((locator) => {
    const key = JSON.stringify(locator);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function queryLocator(locator: TargetLocator): HTMLElement[] {
  if (locator.strategy === "css") return queryCss(locator.selector);
  if (locator.strategy === "role") {
    return allPotentialTargets().filter((element) => {
      if (roleForElement(element) !== locator.role.toLowerCase()) return false;
      return !locator.name || normalized(accessibleName(element)) === normalized(locator.name);
    });
  }
  if (locator.strategy === "label") {
    return allPotentialTargets().filter((element) => normalized(accessibleName(element)) === normalized(locator.label));
  }
  const selector = locator.tagName && /^[a-z][a-z0-9-]*$/i.test(locator.tagName) ? locator.tagName : "button,a,summary,[role]";
  return queryCss(selector).filter((element) => normalized(readableText(element)) === normalized(locator.text));
}

function queryCss(selector: string): HTMLElement[] {
  if (!isStandardCssSelector(selector)) return [];
  try {
    return Array.from(document.querySelectorAll(selector)).filter((element): element is HTMLElement => element instanceof HTMLElement);
  } catch {
    return [];
  }
}

function isStandardCssSelector(selector: string): boolean {
  return Boolean(selector.trim()) && !selector.includes(":has-text(") && !/^\s*(role|text|label)=/i.test(selector);
}

function allPotentialTargets(): HTMLElement[] {
  return Array.from(document.querySelectorAll([
    "button",
    "a[href]",
    "input",
    "textarea",
    "select",
    "summary",
    "[contenteditable='true']",
    "[role]"
  ].join(","))).filter((element): element is HTMLElement => element instanceof HTMLElement);
}

function roleForElement(element: HTMLElement): string | undefined {
  const explicit = element.getAttribute("role")?.trim().toLowerCase();
  if (explicit) return explicit;
  if (element instanceof HTMLButtonElement || element.tagName === "SUMMARY") return "button";
  if (element instanceof HTMLAnchorElement && element.hasAttribute("href")) return "link";
  if (element instanceof HTMLTextAreaElement) return "textbox";
  if (element instanceof HTMLSelectElement) return "combobox";
  if (element instanceof HTMLInputElement) {
    if (element.type === "checkbox") return "checkbox";
    if (element.type === "radio") return "radio";
    if (element.type !== "hidden") return "textbox";
  }
  return undefined;
}

function accessibleName(element: HTMLElement): string {
  const ariaLabel = element.getAttribute("aria-label")?.trim();
  if (ariaLabel) return ariaLabel;
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const value = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim())
      .filter(Boolean)
      .join(" ");
    if (value) return value;
  }
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    const label = Array.from(element.labels ?? []).map((item) => item.textContent?.trim()).filter(Boolean).join(" ");
    if (label) return label;
    return element.getAttribute("placeholder")?.trim() || element.getAttribute("name")?.trim() || "";
  }
  return readableText(element);
}

function readableText(element: HTMLElement): string {
  return element.innerText?.trim() || element.textContent?.trim() || element.getAttribute("title")?.trim() || "";
}

function normalized(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function isSdkOwnedElement(element: HTMLElement): boolean {
  return Boolean(element.closest([
    "[data-mia-prompt-ui='true']",
    "[data-mia-shadow-cursor='true']",
    "[data-mia-ignore]",
    ".mia-root"
  ].join(",")));
}

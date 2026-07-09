import type { Page } from "playwright";
import type { RawElement } from "./selector.js";

const interactiveSelector = [
  "button",
  "a",
  "input",
  "textarea",
  "select",
  "summary",
  "[data-ai-id]",
  "[data-testid]",
  "[role='button']",
  "[role='checkbox']",
  "[role='combobox']",
  "[role='link']",
  "[role='tab']",
  "[role='menuitem']",
  "[role='menuitemcheckbox']",
  "[role='menuitemradio']",
  "[role='option']",
  "[role='switch']",
  "[contenteditable='true']"
].join(",");

const sdkOwnedSelectors = [
  "[data-mia-prompt-ui='true']",
  "[data-mia-shadow-cursor='true']",
  "[data-mia-ignore]",
  ".mia-root",
  ".mia-cursor",
  ".mia-bubble",
  ".mia-nav-bubble"
];

export async function scanVisibleElements(page: Page, options: { ignoredSelectors?: string[]; redactedSelectors?: string[] } = {}): Promise<RawElement[]> {
  const scanOptions = JSON.stringify({
    interactiveSelector,
    ignoredSelectors: [...sdkOwnedSelectors, ...(options.ignoredSelectors ?? [])],
    redactedSelectors: options.redactedSelectors ?? []
  });

  return page.evaluate(`((scanOptions) => {
    const ignoredSelectors = Array.isArray(scanOptions.ignoredSelectors) ? scanOptions.ignoredSelectors : [];
    const redactedSelectors = Array.isArray(scanOptions.redactedSelectors) ? scanOptions.redactedSelectors : [];
    const nodes = Array.from(document.querySelectorAll(scanOptions.interactiveSelector));
    const text = (value) => {
      const normalized = value?.replace(/\\s+/g, " ").trim();
      return normalized || undefined;
    };
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0
        && rect.height > 0
        && style.visibility !== "hidden"
        && style.display !== "none"
        && style.pointerEvents !== "none";
    };
    const matchesAny = (element, selectors) => selectors.some((selector) => {
      try {
        return Boolean(selector) && (element.matches(selector) || element.closest(selector));
      } catch {
        return false;
      }
    });
    const labelledBy = (element) => {
      const id = element.getAttribute("aria-labelledby");
      if (!id) return undefined;
      return text(id.split(/\\s+/).map((part) => document.getElementById(part)?.textContent).filter(Boolean).join(" "));
    };
    const nearestHeading = (element) => {
      const container = element.closest("section,main,aside,nav,header,footer,form,[role='dialog'],[role='menu'],[role='listbox'],[data-state]");
      const heading = container?.querySelector("h1,h2,h3,h4,h5,h6,[role='heading']");
      return text(heading?.textContent);
    };
    const nearestForm = (element) => {
      const form = element.closest("form");
      if (!form) return undefined;
      return text(form.getAttribute("aria-label"))
        ?? labelledBy(form)
        ?? text(form.querySelector("legend,h1,h2,h3,h4,h5,h6")?.textContent);
    };
    const nearestDialog = (element) => {
      const dialog = element.closest("dialog,[role='dialog'],[aria-modal='true']");
      if (!dialog) return undefined;
      return text(dialog.getAttribute("aria-label"))
        ?? labelledBy(dialog)
        ?? text(dialog.querySelector("h1,h2,h3,h4,h5,h6")?.textContent);
    };
    const nearestTable = (element) => {
      const table = element.closest("table,[role='table'],[role='grid']");
      if (!table) return undefined;
      return text(table.getAttribute("aria-label"))
        ?? labelledBy(table)
        ?? text(table.querySelector("caption,h1,h2,h3,h4,h5,h6")?.textContent);
    };
    const cssString = (value) => Array.from(value).map((character) => {
      const code = character.codePointAt(0) ?? 0;
      if (character === "\\\\" || character === "'") return "\\\\" + character;
      if (code === 0) return "\\\\fffd ";
      if (code < 0x20 || code === 0x7f) return "\\\\" + code.toString(16) + " ";
      return character;
    }).join("");
    const domPath = (element) => {
      const parts = [];
      let current = element;
      while (current instanceof HTMLElement && current !== document.documentElement) {
        const tag = current.tagName.toLowerCase();
        if (current.id) {
          parts.unshift("[id='" + cssString(current.id) + "']");
          break;
        }
        const parent = current.parentElement;
        if (!parent) {
          parts.unshift(tag);
          break;
        }
        const siblings = Array.from(parent.children).filter((sibling) => sibling.tagName === current.tagName);
        const position = siblings.indexOf(current) + 1;
        parts.unshift(siblings.length > 1 ? tag + ":nth-of-type(" + position + ")" : tag);
        current = parent;
      }
      return parts.join(" > ");
    };
    return nodes
      .filter((node) => node instanceof HTMLElement && visible(node) && !matchesAny(node, ignoredSelectors))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const redacted = matchesAny(element, redactedSelectors);
        const label = redacted ? undefined : text(element.getAttribute("aria-label"))
          ?? labelledBy(element)
          ?? text(element.labels?.[0]?.textContent)
          ?? text(element.innerText)
          ?? text(element.textContent)
          ?? text(element.getAttribute("title"));
        return {
          tagName: element.tagName,
          role: element.getAttribute("role") ?? undefined,
          label,
          text: redacted ? undefined : text(element.innerText) ?? text(element.textContent),
          redacted,
          dataAiId: element.getAttribute("data-ai-id") ?? undefined,
          testId: element.getAttribute("data-testid") ?? undefined,
          dataSlot: element.getAttribute("data-slot") ?? undefined,
          dataSidebar: element.getAttribute("data-sidebar") ?? undefined,
          dataState: element.getAttribute("data-state") ?? undefined,
          id: element.id || undefined,
          name: element.name || undefined,
          placeholder: redacted ? undefined : element.placeholder || undefined,
          ariaLabel: redacted ? undefined : element.getAttribute("aria-label") ?? undefined,
          inputType: element.type || undefined,
          title: redacted ? undefined : element.getAttribute("title") ?? undefined,
          href: element.href || undefined,
          domPath: domPath(element),
          sectionName: redacted ? undefined : nearestHeading(element),
          formName: redacted ? undefined : nearestForm(element),
          dialogName: redacted ? undefined : nearestDialog(element),
          tableName: redacted ? undefined : nearestTable(element),
          boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        };
      });
  })(${scanOptions})`) as Promise<RawElement[]>;
}

import type { Page } from "playwright";
import type { RawElement } from "./selector.js";

const interactiveSelector = [
  "button",
  "a",
  "input",
  "textarea",
  "select",
  "summary",
  "[role='button']",
  "[role='link']",
  "[role='tab']",
  "[role='menuitem']",
  "[role='option']",
  "[role='combobox']",
  "[contenteditable='true']"
].join(",");

export async function scanVisibleElements(page: Page): Promise<RawElement[]> {
  return page.evaluate(`(() => {
    const nodes = Array.from(document.querySelectorAll(${JSON.stringify(interactiveSelector)}));
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
    return nodes
      .filter((node) => node instanceof HTMLElement && visible(node))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const label = text(element.getAttribute("aria-label"))
          ?? labelledBy(element)
          ?? text(element.labels?.[0]?.textContent)
          ?? text(element.innerText)
          ?? text(element.textContent)
          ?? text(element.getAttribute("title"));
        return {
          tagName: element.tagName,
          role: element.getAttribute("role") ?? undefined,
          label,
          text: text(element.innerText) ?? text(element.textContent),
          dataAiId: element.getAttribute("data-ai-id") ?? undefined,
          testId: element.getAttribute("data-testid") ?? undefined,
          id: element.id || undefined,
          name: element.name || undefined,
          placeholder: element.placeholder || undefined,
          ariaLabel: element.getAttribute("aria-label") ?? undefined,
          inputType: element.type || undefined,
          title: element.getAttribute("title") ?? undefined,
          href: element.href || undefined,
          sectionName: nearestHeading(element),
          formName: nearestForm(element),
          dialogName: nearestDialog(element),
          tableName: nearestTable(element),
          boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        };
      });
  })()`) as Promise<RawElement[]>;
}

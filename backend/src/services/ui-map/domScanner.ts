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
  return page.$$eval(interactiveSelector, (nodes) => {
    function text(value: string | null | undefined): string | undefined {
      const normalized = value?.replace(/\s+/g, " ").trim();
      return normalized || undefined;
    }

    function visible(element: HTMLElement): boolean {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0
        && rect.height > 0
        && style.visibility !== "hidden"
        && style.display !== "none"
        && style.pointerEvents !== "none";
    }

    function labelledBy(element: HTMLElement): string | undefined {
      const id = element.getAttribute("aria-labelledby");
      if (!id) return undefined;
      return text(id.split(/\s+/).map((part) => document.getElementById(part)?.textContent).filter(Boolean).join(" "));
    }

    function nearestHeading(element: HTMLElement): string | undefined {
      const container = element.closest("section,main,aside,nav,header,footer,form,[role='dialog'],[role='menu'],[role='listbox'],[data-state]");
      const heading = container?.querySelector("h1,h2,h3,h4,h5,h6,[role='heading']");
      return text(heading?.textContent);
    }

    function nearestForm(element: HTMLElement): string | undefined {
      const form = element.closest("form");
      if (!form) return undefined;
      return text(form.getAttribute("aria-label"))
        ?? labelledBy(form as HTMLElement)
        ?? text(form.querySelector("legend,h1,h2,h3,h4,h5,h6")?.textContent);
    }

    function nearestDialog(element: HTMLElement): string | undefined {
      const dialog = element.closest("dialog,[role='dialog'],[aria-modal='true']");
      if (!dialog) return undefined;
      return text(dialog.getAttribute("aria-label"))
        ?? labelledBy(dialog as HTMLElement)
        ?? text(dialog.querySelector("h1,h2,h3,h4,h5,h6")?.textContent);
    }

    function nearestTable(element: HTMLElement): string | undefined {
      const table = element.closest("table,[role='table'],[role='grid']");
      if (!table) return undefined;
      return text(table.getAttribute("aria-label"))
        ?? labelledBy(table as HTMLElement)
        ?? text(table.querySelector("caption,h1,h2,h3,h4,h5,h6")?.textContent);
    }

    return nodes
      .filter((node): node is HTMLElement => node instanceof HTMLElement && visible(node))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const input = element as HTMLInputElement;
        const label = text(element.getAttribute("aria-label"))
          ?? labelledBy(element)
          ?? text(input.labels?.[0]?.textContent)
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
          name: input.name || undefined,
          placeholder: input.placeholder || undefined,
          ariaLabel: element.getAttribute("aria-label") ?? undefined,
          inputType: input.type || undefined,
          title: element.getAttribute("title") ?? undefined,
          href: (element as HTMLAnchorElement).href || undefined,
          sectionName: nearestHeading(element),
          formName: nearestForm(element),
          dialogName: nearestDialog(element),
          tableName: nearestTable(element),
          boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        };
      });
  }) as Promise<RawElement[]>;
}

export function findElement(selector: string, fallbacks: string[] = []): Element | null {
  const selectors = [selector, ...fallbacks].filter(Boolean);
  for (const candidate of selectors) {
    const textMatch = candidate.match(/^([a-zA-Z0-9_-]+):has-text\(['"](.+)['"]\)$/);
    if (textMatch) {
      const [, tag, text] = textMatch;
      const element = Array.from(document.querySelectorAll(tag)).find((node) => node.textContent?.includes(text));
      if (element) return element;
      continue;
    }

    try {
      const element = document.querySelector(candidate);
      if (element) return element;
    } catch {
      continue;
    }
  }
  return null;
}

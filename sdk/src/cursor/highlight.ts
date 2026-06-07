export function highlightElement(element: Element): () => void {
  const target = element as HTMLElement;
  const previousOutline = target.style.outline;
  const previousOffset = target.style.outlineOffset;
  target.style.outline = "3px solid #2563eb";
  target.style.outlineOffset = "3px";
  return () => {
    target.style.outline = previousOutline;
    target.style.outlineOffset = previousOffset;
  };
}

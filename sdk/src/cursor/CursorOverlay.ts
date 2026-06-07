export class CursorOverlay {
  private readonly cursor: HTMLDivElement;
  private readonly label: HTMLDivElement;

  constructor() {
    this.cursor = document.createElement("div");
    this.label = document.createElement("div");
    this.cursor.style.cssText = [
      "position:fixed",
      "z-index:2147483647",
      "width:18px",
      "height:18px",
      "border-radius:50%",
      "background:#111827",
      "box-shadow:0 0 0 4px rgba(17,24,39,.16)",
      "transform:translate(-50%,-50%)",
      "pointer-events:none",
      "transition:left 220ms ease, top 220ms ease"
    ].join(";");
    this.label.style.cssText = [
      "position:fixed",
      "z-index:2147483647",
      "padding:4px 8px",
      "border-radius:6px",
      "background:#111827",
      "color:white",
      "font:12px/1.3 sans-serif",
      "pointer-events:none",
      "transition:left 220ms ease, top 220ms ease"
    ].join(";");
    this.label.hidden = true;
    document.body.append(this.cursor, this.label);
    this.moveTo(24, 24);
  }

  async moveToElement(element: Element, label?: string): Promise<void> {
    const rect = element.getBoundingClientRect();
    await this.moveTo(rect.left + rect.width / 2, rect.top + rect.height / 2, label);
  }

  async moveTo(x: number, y: number, label?: string): Promise<void> {
    this.cursor.style.left = `${x}px`;
    this.cursor.style.top = `${y}px`;
    if (label) {
      this.label.textContent = label;
      this.label.hidden = false;
      this.label.style.left = `${x + 14}px`;
      this.label.style.top = `${y + 14}px`;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 240));
  }

  destroy(): void {
    this.cursor.remove();
    this.label.remove();
  }
}

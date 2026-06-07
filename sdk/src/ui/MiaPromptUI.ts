export class MiaPromptUI {
  private readonly root = document.createElement("div");
  private readonly card = document.createElement("div");
  private readonly body = document.createElement("div");

  constructor() {
    this.mount();
  }

  ask(prompt: string, inputType = "text", choices?: string[]): Promise<string> {
    this.open(prompt);
    return new Promise((resolve) => {
      const form = document.createElement("form");
      form.style.cssText = "display:flex;gap:10px;margin-top:14px";
      const input = choices ? document.createElement("select") : document.createElement("input");
      if (choices) {
        for (const choice of choices) {
          const option = document.createElement("option");
          option.value = choice;
          option.textContent = choice;
          input.append(option);
        }
      } else {
        (input as HTMLInputElement).type = inputType;
      }
      input.style.cssText = "flex:1;min-width:0;border:1px solid rgba(148,163,184,.45);border-radius:12px;padding:10px 12px;background:#fff;color:#0f172a";
      const submit = document.createElement("button");
      submit.type = "submit";
      submit.textContent = "Continue";
      submit.style.cssText = buttonCss("#2563eb");
      form.append(input, submit);
      form.onsubmit = (event) => {
        event.preventDefault();
        const value = (input as HTMLInputElement | HTMLSelectElement).value;
        this.clear();
        resolve(value);
      };
      this.body.append(form);
      input.focus();
    });
  }

  confirm(message: string, confirmLabel = "Confirm", cancelLabel = "Cancel"): Promise<boolean> {
    this.open(message);
    return new Promise((resolve) => {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;justify-content:flex-end;gap:10px;margin-top:14px";
      const cancel = document.createElement("button");
      const confirm = document.createElement("button");
      cancel.type = "button";
      confirm.type = "button";
      cancel.textContent = cancelLabel;
      confirm.textContent = confirmLabel;
      cancel.style.cssText = buttonCss("#475569");
      confirm.style.cssText = buttonCss("#2563eb");
      cancel.onclick = () => {
        this.clear();
        resolve(false);
      };
      confirm.onclick = () => {
        this.clear();
        resolve(true);
      };
      row.append(cancel, confirm);
      this.body.append(row);
      confirm.focus();
    });
  }

  showError(message: string): void {
    this.open(message, "Mia needs attention");
  }

  showListening(message: string): void {
    this.open(message, "Mia is listening");
    const hint = document.createElement("div");
    hint.textContent = "Speak your answer now.";
    hint.style.cssText = "margin-top:10px;color:#93c5fd;font:700 13px/1.35 system-ui,sans-serif";
    this.body.append(hint);
  }

  clear(): void {
    this.body.replaceChildren();
    this.root.style.display = "none";
  }

  destroy(): void {
    this.root.remove();
  }

  private mount(): void {
    this.root.dataset.miaPromptUi = "true";
    this.root.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:2147483646",
      "display:none",
      "align-items:center",
      "justify-content:center",
      "padding:20px",
      "background:rgba(2,6,23,.22)",
      "font-family:system-ui,sans-serif"
    ].join(";");
    this.card.style.cssText = [
      "width:min(440px,100%)",
      "border-radius:18px",
      "padding:18px",
      "background:rgba(15,23,42,.94)",
      "color:#f8fafc",
      "box-shadow:0 24px 70px rgba(2,6,23,.42)",
      "border:1px solid rgba(148,163,184,.26)",
      "backdrop-filter:blur(14px)"
    ].join(";");
    this.body.style.cssText = "font:14px/1.45 system-ui,sans-serif";
    this.card.append(this.body);
    this.root.append(this.card);
    document.body.append(this.root);
  }

  private open(message: string, title = "Mia needs your input"): void {
    this.body.replaceChildren();
    const heading = document.createElement("div");
    heading.textContent = title;
    heading.style.cssText = "font:800 15px/1.2 system-ui,sans-serif;margin-bottom:8px";
    const text = document.createElement("div");
    text.textContent = message;
    text.style.cssText = "color:#dbeafe";
    this.body.append(heading, text);
    this.root.style.display = "flex";
  }
}

function buttonCss(background: string): string {
  return `border:0;border-radius:999px;padding:10px 14px;background:${background};color:#fff;font:800 13px/1 system-ui,sans-serif;cursor:pointer;white-space:nowrap`;
}

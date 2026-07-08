export class AssistantUI {
  private readonly panel: HTMLDivElement;

  constructor(private readonly onSubmit: (text: string) => void) {
    this.panel = document.createElement("div");
    this.panel.style.cssText = [
      "position:fixed",
      "right:20px",
      "bottom:20px",
      "z-index:2147483646",
      "width:min(360px,calc(100vw - 40px))",
      "font:14px/1.4 sans-serif",
      "background:white",
      "border:1px solid #d1d5db",
      "box-shadow:0 16px 40px rgba(0,0,0,.16)",
      "border-radius:8px",
      "padding:12px"
    ].join(";");
    this.render();
    document.body.append(this.panel);
  }

  say(message: string): void {
    const output = this.panel.querySelector<HTMLDivElement>("[data-mia-output]");
    if (output) output.textContent = message;
  }

  ask(prompt: string, inputType = "text", choices?: string[]): Promise<string> {
    this.say(prompt);
    return new Promise((resolve) => {
      const form = this.createInputForm(inputType, choices, resolve);
      this.panel.append(form);
    });
  }

  confirm(message: string, confirmLabel = "Confirm", cancelLabel = "Cancel"): Promise<boolean> {
    this.say(message);
    return new Promise((resolve) => {
      const wrapper = document.createElement("div");
      wrapper.style.cssText = "display:flex;gap:8px;margin-top:10px";
      const confirm = document.createElement("button");
      const cancel = document.createElement("button");
      confirm.textContent = confirmLabel;
      cancel.textContent = cancelLabel;
      confirm.onclick = () => { wrapper.remove(); resolve(true); };
      cancel.onclick = () => { wrapper.remove(); resolve(false); };
      wrapper.append(confirm, cancel);
      this.panel.append(wrapper);
    });
  }

  destroy(): void {
    this.panel.remove();
  }

  private render(): void {
    const output = document.createElement("div");
    output.dataset.miaOutput = "true";
    output.textContent = "How can I help?";
    const form = this.createInputForm("text", undefined, this.onSubmit);
    this.panel.append(output, form);
  }

  private createInputForm(inputType: string, choices: string[] | undefined, onValue: (value: string) => void): HTMLFormElement {
    const form = document.createElement("form");
    form.style.cssText = "display:flex;gap:8px;margin-top:10px";
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
    const button = document.createElement("button");
    button.textContent = "Send";
    form.append(input, button);
    form.onsubmit = (event) => {
      event.preventDefault();
      const value = (input as HTMLInputElement | HTMLSelectElement).value;
      form.remove();
      onValue(value);
    };
    return form;
  }
}

export class MiaPromptUI {
  private readonly root = document.createElement("div");
  private readonly card = document.createElement("div");
  private readonly body = document.createElement("div");
  private readonly themeQuery = window.matchMedia?.("(prefers-color-scheme: light)");
  private lightTheme = this.themeQuery?.matches ?? false;
  private readonly handleThemeChange = (event: MediaQueryListEvent) => {
    this.lightTheme = event.matches;
    this.applyCardTheme();
  };
  private readonly titleId = "mia-prompt-title";
  private readonly messageId = "mia-prompt-message";
  private previousFocus?: HTMLElement;
  private cancelCurrent?: () => void;
  private idSequence = 0;
  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (this.root.style.display === "none") return;
    if (event.key === "Escape" && this.cancelCurrent) {
      event.preventDefault();
      this.cancelCurrent();
      return;
    }
    if (event.key === "Tab") this.trapFocus(event);
  };

  constructor() {
    this.mount();
  }

  ask(prompt: string, inputType = "text", choices?: string[], signal?: AbortSignal): Promise<string> {
    this.open(prompt);
    return new Promise((resolve, reject) => {
      let settled = false;
      const abort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        this.clear();
        reject(new Error("Workflow cancelled."));
      };
      const cleanup = () => {
        signal?.removeEventListener("abort", abort);
        if (this.cancelCurrent === abort) this.cancelCurrent = undefined;
      };
      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener("abort", abort, { once: true });
      this.cancelCurrent = abort;
      const form = document.createElement("form");
      form.style.cssText = "display:flex;gap:10px;margin-top:14px";
      const input: HTMLInputElement | HTMLSelectElement = choices ? document.createElement("select") : document.createElement("input");
      const inputId = `mia-prompt-field-${++this.idSequence}`;
      input.id = inputId;
      input.setAttribute("aria-describedby", this.messageId);
      input.setAttribute("aria-label", "Response");
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
      input.style.cssText = "flex:1;min-width:0;border:1px solid rgba(148,163,184,.45);border-radius:8px;padding:10px 12px;background:#fff;color:#0f172a";
      const submit = document.createElement("button");
      submit.type = "submit";
      submit.textContent = "Continue";
      submit.style.cssText = buttonCss("#2563eb");
      form.append(input, submit);
      form.onsubmit = (event) => {
        event.preventDefault();
        if (settled) return;
        settled = true;
        const value = (input as HTMLInputElement | HTMLSelectElement).value;
        cleanup();
        this.clear();
        resolve(value);
      };
      this.body.append(form);
      input.focus();
    });
  }

  confirm(message: string, confirmLabel = "Confirm", cancelLabel = "Cancel", signal?: AbortSignal): Promise<boolean> {
    this.open(message);
    return new Promise((resolve, reject) => {
      let settled = false;
      const abort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        this.clear();
        reject(new Error("Workflow cancelled."));
      };
      const cleanup = () => {
        signal?.removeEventListener("abort", abort);
        if (this.cancelCurrent === abort) this.cancelCurrent = undefined;
      };
      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener("abort", abort, { once: true });
      this.cancelCurrent = abort;
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
        if (settled) return;
        settled = true;
        cleanup();
        this.clear();
        resolve(false);
      };
      confirm.onclick = () => {
        if (settled) return;
        settled = true;
        cleanup();
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
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.textContent = "Dismiss";
    dismiss.style.cssText = `${buttonCss("#2563eb")};display:block;margin:14px 0 0 auto`;
    const close = () => this.clear();
    dismiss.onclick = close;
    this.cancelCurrent = close;
    this.body.append(dismiss);
    dismiss.focus();
  }

  showListening(message: string, cancel: () => void): void {
    this.open(message, "Mia is listening");
    const hint = document.createElement("div");
    hint.textContent = "Speak your answer now.";
    hint.style.cssText = `margin-top:10px;color:${this.lightTheme ? "#1d4ed8" : "#93c5fd"};font:700 13px/1.35 system-ui,sans-serif`;
    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.textContent = "Cancel";
    cancelButton.style.cssText = `${buttonCss("#475569")};display:block;margin:14px 0 0 auto`;
    const cancelListening = () => {
      cancel();
      this.clear();
    };
    cancelButton.onclick = cancelListening;
    this.cancelCurrent = cancelListening;
    this.body.append(hint, cancelButton);
  }

  clear(): void {
    this.body.replaceChildren();
    this.root.style.display = "none";
    this.cancelCurrent = undefined;
    document.removeEventListener("keydown", this.handleKeyDown);
    const previousFocus = this.previousFocus;
    this.previousFocus = undefined;
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  }

  cancel(): void {
    this.cancelCurrent?.();
  }

  destroy(): void {
    this.clear();
    this.themeQuery?.removeEventListener?.("change", this.handleThemeChange);
    this.root.remove();
  }

  private applyCardTheme(): void {
    this.card.style.cssText = [
      "width:min(440px,100%)",
      "border-radius:10px",
      "padding:18px",
      this.lightTheme ? "background:rgba(255,255,255,.98)" : "background:rgba(15,23,42,.94)",
      this.lightTheme ? "color:#0f172a" : "color:#f8fafc",
      "box-shadow:0 24px 70px rgba(2,6,23,.42)",
      this.lightTheme ? "border:1px solid rgba(15,23,42,.14)" : "border:1px solid rgba(148,163,184,.26)",
      "backdrop-filter:blur(14px)"
    ].join(";");
  }

  private mount(): void {
    this.root.dataset.miaPromptUi = "true";
    this.card.role = "dialog";
    this.card.ariaModal = "true";
    this.card.setAttribute("aria-labelledby", this.titleId);
    this.card.setAttribute("aria-describedby", this.messageId);
    this.card.tabIndex = -1;
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
    this.applyCardTheme();
    this.themeQuery?.addEventListener?.("change", this.handleThemeChange);
    this.body.style.cssText = "font:14px/1.45 system-ui,sans-serif";
    this.card.append(this.body);
    this.root.append(this.card);
    document.body.append(this.root);
  }

  private open(message: string, title = "Mia needs your input"): void {
    this.cancelCurrent?.();
    const activeElement = document.activeElement;
    this.previousFocus = activeElement instanceof HTMLElement ? activeElement : undefined;
    this.body.replaceChildren();
    const heading = document.createElement("div");
    heading.id = this.titleId;
    heading.textContent = title;
    heading.style.cssText = "font:800 15px/1.2 system-ui,sans-serif;margin-bottom:8px";
    const text = document.createElement("div");
    text.id = this.messageId;
    text.textContent = message;
    text.style.cssText = this.lightTheme ? "color:#334155" : "color:#dbeafe";
    this.body.append(heading, text);
    this.root.style.display = "flex";
    document.addEventListener("keydown", this.handleKeyDown);
    this.card.focus({ preventScroll: true });
  }

  private trapFocus(event: KeyboardEvent): void {
    const focusable = Array.from(
      this.card.querySelectorAll<HTMLElement>(
        "a[href],button,input,select,textarea,[tabindex]:not([tabindex='-1'])"
      )
    ).filter((element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true");
    if (!focusable.length) {
      event.preventDefault();
      this.card.focus({ preventScroll: true });
      return;
    }

    const first = focusable[0];
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}

function buttonCss(background: string): string {
  return `border:0;border-radius:8px;padding:10px 14px;background:${background};color:#fff;font:800 13px/1 system-ui,sans-serif;cursor:pointer;white-space:nowrap;outline-offset:2px`;
}

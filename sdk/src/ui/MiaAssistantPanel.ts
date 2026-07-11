import { Check, ChevronDown, createElement, Mic, MicOff, SendHorizontal, Square, X } from "lucide";
import type { ConfirmationRequest, MiaStatus } from "../types/index.js";

export type MiaTranscriptEntry = { role: "user" | "assistant" | "system"; text: string; at?: Date };

type PanelOptions = {
  voiceEnabled: boolean;
  onAsk: (text: string) => Promise<void>;
  onToggleVoice: () => Promise<void>;
  onStop: () => Promise<void>;
  styleNonce?: string;
};
type PendingConfirmation = { resolve: (approved: boolean) => void; settled: boolean };
type PendingInput = { resolve: (value: string) => void; reject: (error: Error) => void; settled: boolean };

const STATUS: Record<MiaStatus, string> = {
  idle: "Ready", connecting: "Connecting", listening: "Listening", thinking: "Thinking",
  speaking: "Speaking", guiding: "Guiding", offline: "Offline", error: "Needs attention", ended: "Voice off"
};

export class MiaAssistantPanel {
  private readonly host = document.createElement("div");
  private readonly shadow = this.host.attachShadow({ mode: "open" });
  private status: MiaStatus = "idle";
  private open = false;
  private voiceActive = false;
  private busy = false;
  private entries: MiaTranscriptEntry[] = [];
  private progress = "";
  private pendingConfirmation?: PendingConfirmation;
  private pendingInput?: PendingInput;
  private abortCleanup?: () => void;

  constructor(private readonly options: PanelOptions) {}

  mount(): void {
    this.host.dataset.miaAssistantPanel = "true";
    document.body.append(this.host);
    this.render();
  }

  destroy(): void {
    this.cancelPending(new Error("Mia was closed."));
    this.host.remove();
  }

  setStatus(status: MiaStatus): void {
    this.status = status;
    this.busy = ["connecting", "thinking", "guiding"].includes(status);
    this.updateState();
  }

  setVoiceActive(active: boolean): void {
    this.voiceActive = active;
    this.updateState();
  }

  setProgress(progress: string): void {
    this.progress = progress.trim();
    const element = this.shadow.querySelector<HTMLElement>("[data-progress]");
    if (element) {
      element.textContent = this.progress;
      element.hidden = !this.progress;
    }
  }

  addTranscript(entry: MiaTranscriptEntry): void {
    const text = entry.text.replace(/\s+/g, " ").trim();
    if (!text) return;
    this.entries = [...this.entries, { ...entry, text, at: entry.at ?? new Date() }].slice(-60);
    this.renderTranscript();
  }

  showError(error: Error): void {
    this.addTranscript({ role: "system", text: friendlyError(error) });
    this.setStatus("error");
    this.openPanel();
  }

  requestConfirmation(request: ConfirmationRequest, signal: AbortSignal): Promise<boolean> {
    this.cancelPending(new Error("A newer request replaced the pending confirmation."));
    this.openPanel();
    this.renderConfirmation(request);
    return new Promise((resolve, reject) => {
      const pending: PendingConfirmation = { resolve, settled: false };
      this.pendingConfirmation = pending;
      const abort = () => {
        if (pending.settled) return;
        pending.settled = true;
        this.pendingConfirmation = undefined;
        this.clearContext();
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      };
      signal.addEventListener("abort", abort, { once: true });
      this.abortCleanup = () => signal.removeEventListener("abort", abort);
    });
  }

  resolveConfirmation(approved: boolean): boolean {
    const pending = this.pendingConfirmation;
    if (!pending || pending.settled) return false;
    pending.settled = true;
    this.pendingConfirmation = undefined;
    this.abortCleanup?.();
    this.abortCleanup = undefined;
    this.clearContext();
    pending.resolve(approved);
    return true;
  }

  requestInput(input: { message: string; inputType?: string; choices?: string[] }, signal: AbortSignal): Promise<string> {
    this.cancelPending(new Error("A newer request replaced the pending input."));
    this.openPanel();
    this.renderInput(input);
    return new Promise((resolve, reject) => {
      const pending: PendingInput = { resolve, reject, settled: false };
      this.pendingInput = pending;
      const abort = () => {
        if (pending.settled) return;
        pending.settled = true;
        this.pendingInput = undefined;
        this.clearContext();
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      };
      signal.addEventListener("abort", abort, { once: true });
      this.abortCleanup = () => signal.removeEventListener("abort", abort);
    });
  }

  resolveInput(value: string): boolean {
    const pending = this.pendingInput;
    const normalized = value.trim();
    if (!pending || pending.settled || !normalized) return false;
    pending.settled = true;
    this.pendingInput = undefined;
    this.abortCleanup?.();
    this.abortCleanup = undefined;
    this.clearContext();
    pending.resolve(normalized);
    return true;
  }

  hasPendingConfirmation(): boolean {
    return Boolean(this.pendingConfirmation && !this.pendingConfirmation.settled);
  }

  hasPendingInput(): boolean {
    return Boolean(this.pendingInput && !this.pendingInput.settled);
  }

  openPanel(): void {
    this.open = true;
    this.shadow.querySelector<HTMLElement>("[data-shell]")?.setAttribute("data-open", "true");
    this.shadow.querySelector<HTMLElement>("[data-panel]")?.removeAttribute("hidden");
    this.shadow.querySelector<HTMLButtonElement>("[data-launcher]")?.setAttribute("aria-expanded", "true");
    queueMicrotask(() => this.shadow.querySelector<HTMLTextAreaElement>("[data-composer]")?.focus({ preventScroll: true }));
  }

  closePanel(): void {
    this.open = false;
    this.shadow.querySelector<HTMLElement>("[data-shell]")?.setAttribute("data-open", "false");
    this.shadow.querySelector<HTMLElement>("[data-panel]")?.setAttribute("hidden", "");
    this.shadow.querySelector<HTMLButtonElement>("[data-launcher]")?.setAttribute("aria-expanded", "false");
    queueMicrotask(() => this.shadow.querySelector<HTMLButtonElement>("[data-launcher]")?.focus({ preventScroll: true }));
  }

  private render(): void {
    this.shadow.innerHTML = `
      <div class="mia-shell" data-shell data-open="false">
        <section class="mia-panel" data-panel role="dialog" aria-label="Mia" hidden>
          <header class="mia-header">
            <div class="mia-brand"><span class="mia-mark" aria-hidden="true">M</span><div><strong>Mia</strong><span data-status-label>${STATUS[this.status]}</span></div></div>
            <button class="mia-icon" type="button" data-close title="Close" aria-label="Close Mia"></button>
          </header>
          <div class="mia-progress" data-progress role="status" aria-live="polite" hidden></div>
          <div class="mia-transcript" data-transcript aria-live="polite"></div>
          <div class="mia-context" data-context hidden></div>
          <form class="mia-composer" data-form>
            <textarea data-composer rows="1" maxlength="4000" placeholder="Ask Mia" aria-label="Ask Mia"></textarea>
            <button class="mia-icon mia-mic" type="button" data-voice title="${this.voiceActive ? "Stop voice" : "Start voice"}" aria-label="${this.voiceActive ? "Stop voice" : "Start voice"}" ${this.options.voiceEnabled ? "" : "hidden"}></button>
            <button class="mia-icon mia-send" type="submit" data-send title="Send" aria-label="Send"></button>
            <button class="mia-icon mia-stop" type="button" data-stop title="Stop Mia" aria-label="Stop Mia"></button>
          </form>
        </section>
        <button class="mia-launcher" type="button" data-launcher aria-expanded="false" aria-label="Open Mia">
          <span class="mia-launcher-mark" aria-hidden="true">M</span>
          <span class="mia-launcher-copy"><strong>Mia</strong><span data-launcher-status>${STATUS[this.status]}</span></span>
          <span class="mia-dot" data-dot aria-hidden="true"></span>
          <span class="mia-chevron" data-chevron aria-hidden="true"></span>
        </button>
      </div>
    `;
    const style = document.createElement("style");
    if (this.options.styleNonce) style.nonce = this.options.styleNonce;
    style.textContent = styles;
    this.shadow.prepend(style);
    icon(this.shadow.querySelector("[data-close]"), X);
    icon(this.shadow.querySelector("[data-send]"), SendHorizontal);
    icon(this.shadow.querySelector("[data-stop]"), Square);
    icon(this.shadow.querySelector("[data-voice]"), this.voiceActive ? MicOff : Mic);
    icon(this.shadow.querySelector("[data-chevron]"), ChevronDown);
    this.shadow.querySelector("[data-launcher]")?.addEventListener("click", () => this.open ? this.closePanel() : this.openPanel());
    this.shadow.querySelector("[data-close]")?.addEventListener("click", () => this.closePanel());
    this.shadow.addEventListener("keydown", (event) => {
      if (event instanceof KeyboardEvent && event.key === "Escape" && this.open) {
        event.preventDefault();
        this.closePanel();
      }
    });
    this.shadow.querySelector("[data-form]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const composer = this.shadow.querySelector<HTMLTextAreaElement>("[data-composer]");
      const value = composer?.value.trim() ?? "";
      if (!value || this.busy) return;
      if (this.resolveInput(value)) {
        if (composer) composer.value = "";
        return;
      }
      if (composer) composer.value = "";
      void this.run(() => this.options.onAsk(value));
    });
    this.shadow.querySelector("[data-composer]")?.addEventListener("keydown", (event) => {
      if (event instanceof KeyboardEvent && event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        this.shadow.querySelector<HTMLFormElement>("[data-form]")?.requestSubmit();
      }
    });
    this.shadow.querySelector("[data-voice]")?.addEventListener("click", () => void this.run(() => this.options.onToggleVoice()));
    this.shadow.querySelector("[data-stop]")?.addEventListener("click", () => void this.options.onStop().catch((error) => this.showError(toError(error))));
    this.renderTranscript();
    this.updateState();
  }

  private renderTranscript(): void {
    const container = this.shadow.querySelector<HTMLElement>("[data-transcript]");
    if (!container) return;
    container.replaceChildren();
    if (this.entries.length === 0) {
      const empty = document.createElement("p");
      empty.className = "mia-empty";
      empty.textContent = "Ready when you are.";
      container.append(empty);
      return;
    }
    for (const entry of this.entries) {
      const message = document.createElement("div");
      message.className = `mia-message ${entry.role}`;
      const label = document.createElement("strong");
      label.textContent = entry.role === "user" ? "You" : entry.role === "assistant" ? "Mia" : "Status";
      const text = document.createElement("span");
      text.textContent = entry.text;
      message.append(label, text);
      container.append(message);
    }
    container.scrollTop = container.scrollHeight;
  }

  private renderConfirmation(request: ConfirmationRequest): void {
    const container = this.contextContainer();
    const text = document.createElement("p");
    text.textContent = request.prompt;
    const controls = document.createElement("div");
    controls.className = "mia-context-actions";
    const decline = document.createElement("button");
    decline.type = "button";
    decline.className = "mia-secondary";
    decline.textContent = "Decline";
    const approve = document.createElement("button");
    approve.type = "button";
    approve.className = "mia-primary";
    approve.append(createElement(Check), document.createTextNode("Approve"));
    decline.onclick = () => this.resolveConfirmation(false);
    approve.onclick = () => this.resolveConfirmation(true);
    controls.append(decline, approve);
    container.append(text, controls);
    queueMicrotask(() => approve.focus({ preventScroll: true }));
  }

  private renderInput(input: { message: string; inputType?: string; choices?: string[] }): void {
    const container = this.contextContainer();
    const text = document.createElement("p");
    text.textContent = input.message;
    const form = document.createElement("form");
    form.className = "mia-context-input";
    const control = input.choices?.length ? document.createElement("select") : document.createElement("input");
    if (control instanceof HTMLSelectElement) {
      for (const choice of input.choices ?? []) {
        const option = document.createElement("option");
        option.value = choice;
        option.textContent = choice;
        control.append(option);
      }
    } else {
      control.type = input.inputType === "email" || input.inputType === "number" || input.inputType === "date" ? input.inputType : "text";
    }
    control.setAttribute("aria-label", "Response");
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "mia-primary";
    submit.textContent = "Continue";
    form.onsubmit = (event) => { event.preventDefault(); this.resolveInput(control.value); };
    form.append(control, submit);
    container.append(text, form);
    queueMicrotask(() => control.focus({ preventScroll: true }));
  }

  private contextContainer(): HTMLElement {
    const container = this.shadow.querySelector<HTMLElement>("[data-context]")!;
    container.replaceChildren();
    container.hidden = false;
    return container;
  }

  private clearContext(): void {
    const container = this.shadow.querySelector<HTMLElement>("[data-context]");
    if (!container) return;
    container.replaceChildren();
    container.hidden = true;
  }

  private cancelPending(error: Error): void {
    this.abortCleanup?.();
    this.abortCleanup = undefined;
    if (this.pendingConfirmation && !this.pendingConfirmation.settled) {
      this.pendingConfirmation.settled = true;
      this.pendingConfirmation.resolve(false);
    }
    if (this.pendingInput && !this.pendingInput.settled) {
      this.pendingInput.settled = true;
      this.pendingInput.reject(error);
    }
    this.pendingConfirmation = undefined;
    this.pendingInput = undefined;
    this.clearContext();
  }

  private async run(task: () => Promise<void>): Promise<void> {
    try { await task(); } catch (error) { this.showError(toError(error)); }
  }

  private updateState(): void {
    const label = STATUS[this.status];
    const status = this.shadow.querySelector<HTMLElement>("[data-status-label]");
    const launcherStatus = this.shadow.querySelector<HTMLElement>("[data-launcher-status]");
    if (status) status.textContent = label;
    if (launcherStatus) launcherStatus.textContent = label;
    this.shadow.querySelector("[data-shell]")?.setAttribute("data-status", this.status);
    const composer = this.shadow.querySelector<HTMLTextAreaElement>("[data-composer]");
    const send = this.shadow.querySelector<HTMLButtonElement>("[data-send]");
    if (composer) composer.disabled = this.busy && !this.hasPendingInput();
    if (send) send.disabled = this.busy && !this.hasPendingInput();
    const voice = this.shadow.querySelector<HTMLButtonElement>("[data-voice]");
    if (voice) {
      voice.title = this.voiceActive ? "Stop voice" : "Start voice";
      voice.setAttribute("aria-label", voice.title);
      voice.replaceChildren(createElement(this.voiceActive ? MicOff : Mic));
    }
  }
}

function icon(target: Element | null, node: Parameters<typeof createElement>[0]): void {
  target?.append(createElement(node, { width: 18, height: 18, "stroke-width": 2 }));
}

function friendlyError(error: Error): string {
  if (error.name === "AbortError") return "Stopped.";
  if (/fetch|network|load failed/i.test(error.message)) return "Mia could not connect. Try again in a moment.";
  if (/microphone|permission|notallowed/i.test(error.message)) return "Microphone access is unavailable for this page.";
  return error.message.replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[redacted]").slice(0, 500);
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

const styles = `
:host{all:initial;color-scheme:dark;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:0}
*{box-sizing:border-box;letter-spacing:0}button,textarea,input,select{font:inherit}button{cursor:pointer}
.mia-shell{position:fixed;right:24px;bottom:24px;z-index:2147483645;color:#f7f9fc}
.mia-launcher{width:164px;height:58px;display:flex;align-items:center;gap:11px;padding:8px 12px;border:1px solid rgba(255,255,255,.25);border-radius:8px;color:inherit;background:linear-gradient(145deg,rgba(22,28,40,.86),rgba(12,16,24,.78));box-shadow:0 18px 50px rgba(5,9,16,.28),inset 0 1px 0 rgba(255,255,255,.18);backdrop-filter:blur(22px) saturate(145%);transition:opacity .16s ease,transform .2s ease,border-color .2s ease}
.mia-launcher:hover{transform:translateY(-2px);border-color:rgba(105,229,197,.5)}.mia-launcher:focus-visible,.mia-icon:focus-visible,button:focus-visible,textarea:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #6ce8c9;outline-offset:2px}
.mia-shell[data-open="true"] .mia-launcher{visibility:hidden;pointer-events:none;opacity:0;transform:translateY(6px) scale(.97)}
.mia-launcher-mark,.mia-mark{display:grid;place-items:center;width:38px;height:38px;flex:0 0 auto;border-radius:7px;background:linear-gradient(145deg,#5876ff,#5f47d8 62%,#28b99a);font-weight:800;color:white;box-shadow:inset 0 1px 0 rgba(255,255,255,.3)}
.mia-launcher-copy{min-width:0;display:flex;flex:1;flex-direction:column;align-items:flex-start;line-height:1.15}.mia-launcher-copy strong{font-size:15px}.mia-launcher-copy span{margin-top:3px;color:#bcc6d7;font-size:12px}
.mia-dot{width:8px;height:8px;border-radius:50%;background:#45d6a9;box-shadow:0 0 0 4px rgba(69,214,169,.1)}.mia-chevron{display:none}
.mia-panel{position:absolute;right:0;bottom:0;width:390px;max-height:min(680px,calc(100vh - 48px));display:grid;grid-template-rows:auto auto minmax(120px,1fr) auto auto;overflow:hidden;border:1px solid rgba(255,255,255,.22);border-radius:8px;background:linear-gradient(155deg,rgba(27,34,47,.82),rgba(11,15,23,.9) 56%,rgba(14,21,29,.84));box-shadow:0 28px 90px rgba(3,7,13,.4),inset 0 1px 0 rgba(255,255,255,.2);backdrop-filter:blur(28px) saturate(155%);animation:mia-panel-in .2s cubic-bezier(.22,1,.36,1)}
.mia-panel[hidden]{display:none}.mia-header{height:66px;display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.1)}
.mia-brand{display:flex;align-items:center;gap:11px}.mia-brand>div{display:flex;flex-direction:column;line-height:1.15}.mia-brand strong{font-size:16px}.mia-brand span{margin-top:3px;color:#aeb9ca;font-size:12px}.mia-mark{width:36px;height:36px}
.mia-icon{width:38px;height:38px;display:grid;place-items:center;flex:0 0 auto;padding:0;border:1px solid rgba(255,255,255,.14);border-radius:7px;color:#e9eef7;background:rgba(255,255,255,.07)}.mia-icon:hover{background:rgba(255,255,255,.13);border-color:rgba(255,255,255,.24)}
.mia-progress{min-height:34px;padding:9px 14px;border-bottom:1px solid rgba(255,255,255,.08);color:#8ee7cf;background:rgba(53,214,178,.055);font-size:12px;line-height:1.3}.mia-progress[hidden]{display:none}
.mia-transcript{min-height:120px;overflow:auto;padding:15px 14px 10px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.2) transparent}.mia-empty{margin:18px 0;color:#aab5c6;text-align:center;font-size:13px}
.mia-message{display:grid;grid-template-columns:42px minmax(0,1fr);gap:8px;padding:8px 0;color:#e7ecf5;font-size:13px;line-height:1.45}.mia-message+ .mia-message{border-top:1px solid rgba(255,255,255,.07)}.mia-message strong{color:#8fe5ce;font-size:11px;text-transform:uppercase}.mia-message span{white-space:pre-wrap;overflow-wrap:anywhere}.mia-message.user strong{color:#9eb1ff}.mia-message.system{color:#b8c2d1}
.mia-context{padding:13px 14px;border-top:1px solid rgba(255,255,255,.1);background:rgba(6,10,16,.24)}.mia-context[hidden]{display:none}.mia-context p{margin:0 0 11px;color:#edf1f8;font-size:13px;line-height:1.45}
.mia-context-actions{display:flex;justify-content:flex-end;gap:8px}.mia-primary,.mia-secondary{min-height:36px;padding:0 13px;border-radius:6px}.mia-primary{display:inline-flex;align-items:center;gap:7px;border:1px solid rgba(132,246,216,.6);color:#071812;background:#70e7c6;font-weight:700}.mia-primary svg{width:16px}.mia-secondary{border:1px solid rgba(255,255,255,.17);color:#e3e9f2;background:rgba(255,255,255,.07)}
.mia-context-input{display:flex;gap:8px}.mia-context-input input,.mia-context-input select{min-width:0;flex:1;height:38px;padding:0 10px;border:1px solid rgba(255,255,255,.18);border-radius:6px;color:#f5f7fb;background:rgba(7,11,18,.62)}
.mia-composer{display:grid;grid-template-columns:minmax(0,1fr) 38px 38px 38px;gap:7px;padding:11px 12px;border-top:1px solid rgba(255,255,255,.11);background:rgba(5,8,13,.2)}.mia-composer textarea{height:38px;max-height:92px;resize:none;padding:9px 11px;border:1px solid rgba(255,255,255,.16);border-radius:7px;color:#f6f8fb;background:rgba(6,10,17,.58);line-height:1.35}.mia-composer textarea::placeholder{color:#8f9bad}.mia-send{color:#071812;background:#70e7c6;border-color:rgba(132,246,216,.6)}.mia-stop{color:#ffb7bd}.mia-icon:disabled,button:disabled,textarea:disabled{cursor:not-allowed;opacity:.45}
.mia-shell[data-status="thinking"] .mia-dot,.mia-shell[data-status="connecting"] .mia-dot{background:#f2c96f;animation:mia-pulse 1.2s ease-in-out infinite}.mia-shell[data-status="error"] .mia-dot{background:#ff7781}.mia-shell[data-status="offline"] .mia-dot,.mia-shell[data-status="ended"] .mia-dot{background:#8792a3}.mia-shell[data-status="listening"] .mia-dot{animation:mia-pulse .8s ease-in-out infinite}
@keyframes mia-pulse{50%{transform:scale(1.35);box-shadow:0 0 0 7px rgba(69,214,169,.06)}}
@keyframes mia-panel-in{from{opacity:0;transform:translateY(8px) scale(.985)}to{opacity:1;transform:none}}
@media(max-width:520px){.mia-shell{right:10px;bottom:10px;left:10px}.mia-launcher{width:154px;margin-left:auto}.mia-panel{position:fixed;left:10px;right:10px;bottom:10px;width:auto;max-height:calc(100vh - 20px)}.mia-composer{grid-template-columns:minmax(0,1fr) 38px 38px}.mia-stop{grid-column:3}.mia-mic[hidden]+.mia-send{grid-column:2}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
`;

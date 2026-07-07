import type { MiaStatus } from "../types/index.js";

export type MiaTranscriptEntry = {
  role: "user" | "assistant" | "system";
  text: string;
  at?: Date;
};

type MiaAssistantPanelOptions = {
  enableVoice: boolean;
  enableScreenShare: boolean;
  textRedacted: boolean;
  getSuggestions: () => string[];
  onAsk: (text: string) => Promise<void>;
  onStartVoice: () => Promise<void>;
  onStopVoice: () => Promise<void>;
  onCancel: () => Promise<void>;
};

const STATUS_LABELS: Record<MiaStatus, string> = {
  idle: "Ready",
  connecting: "Connecting",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  guiding: "Guiding",
  fading: "Ready",
  offline: "Offline",
  error: "Needs attention",
  ended: "Voice stopped"
};

const STATUS_TONES: Record<MiaStatus, "green" | "yellow" | "red" | "gray"> = {
  idle: "green",
  connecting: "yellow",
  listening: "green",
  thinking: "yellow",
  speaking: "green",
  guiding: "green",
  fading: "gray",
  offline: "gray",
  error: "red",
  ended: "gray"
};

export class MiaAssistantPanel {
  private readonly host = document.createElement("div");
  private readonly shadow = this.host.attachShadow({ mode: "open" });
  private status: MiaStatus = "idle";
  private open = false;
  private busy = false;
  private entries: MiaTranscriptEntry[] = [];

  constructor(private readonly options: MiaAssistantPanelOptions) {}

  mount(): void {
    this.host.dataset.miaAssistantPanel = "true";
    document.body.append(this.host);
    this.render();
  }

  destroy(): void {
    this.host.remove();
  }

  setStatus(status: MiaStatus): void {
    this.status = status;
    this.updateStatus();
    this.updateControls();
  }

  addTranscript(entry: MiaTranscriptEntry): void {
    const text = entry.text.trim();
    if (!text) return;
    this.entries = [...this.entries, { ...entry, at: entry.at ?? new Date() }].slice(-24);
    this.renderTranscript();
  }

  setError(message: string): void {
    this.addTranscript({ role: "system", text: friendlyErrorText(message) });
    this.setStatus("error");
    this.openPanel();
  }

  private render(): void {
    this.shadow.innerHTML = `
      <style>${styles}</style>
      <div class="mia-panel-root" data-open="${this.open}">
        <button class="mia-launcher" type="button" aria-expanded="${this.open}" aria-controls="mia-assistant-panel">
          <span class="mia-mark" aria-hidden="true">M</span>
          <span class="mia-launcher-copy">
            <strong>Mia</strong>
            <span data-status-label>${STATUS_LABELS[this.status]}</span>
          </span>
          <span class="mia-status-dot ${STATUS_TONES[this.status]}" aria-hidden="true"></span>
        </button>

        <section id="mia-assistant-panel" class="mia-panel" aria-label="Mia assistant" ${this.open ? "" : "hidden"}>
          <header class="mia-panel-header">
            <div>
              <strong>Mia</strong>
              <span>Help for this app</span>
            </div>
            <button class="mia-icon-button" type="button" data-close aria-label="Close Mia">&times;</button>
          </header>

          <div class="mia-state-row">
            <span class="mia-status-pill ${STATUS_TONES[this.status]}" data-status-pill>${STATUS_LABELS[this.status]}</span>
            <span class="mia-privacy-pill">${this.options.textRedacted ? "Page text hidden from Mia" : "Mia can see this page"}</span>
            ${this.options.enableScreenShare ? `<span class="mia-privacy-pill">Screen share off by default</span>` : ""}
          </div>

          <form class="mia-ask-form">
            <label for="mia-ask-input">Ask Mia</label>
            <div class="mia-input-row">
              <input id="mia-ask-input" name="ask" autocomplete="off" placeholder="Ask about this page&hellip;" />
              <button class="mia-send" type="submit">Ask</button>
            </div>
          </form>

          <div class="mia-suggestions" aria-label="Suggested prompts"></div>

          <div class="mia-controls">
            ${this.options.enableVoice ? `<button class="mia-control" type="button" data-voice>${this.isVoiceActive() ? "Stop voice" : "Start voice"}</button>` : ""}
            <button class="mia-control" type="button" data-cancel>Stop Mia</button>
          </div>

          ${this.options.enableVoice ? `<p class="mia-hotkey">Hold Ctrl+Space anywhere to talk. Release to pause the mic.</p>` : ""}

          <div class="mia-thinking" role="status" hidden>Mia is thinking&hellip;</div>

          <div class="mia-transcript" aria-live="polite"></div>
        </section>
      </div>
    `;

    this.shadow.querySelector(".mia-launcher")?.addEventListener("click", () => this.togglePanel());
    this.shadow.querySelector("[data-close]")?.addEventListener("click", () => this.closePanel());
    this.shadow.querySelector(".mia-ask-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const input = this.shadow.querySelector<HTMLInputElement>("#mia-ask-input");
      const text = input?.value.trim() ?? "";
      if (!text) return;
      if (input) input.value = "";
      void this.runTask(() => this.options.onAsk(text));
    });
    this.shadow.querySelector("[data-voice]")?.addEventListener("click", () => {
      void this.runTask(() => this.isVoiceActive() ? this.options.onStopVoice() : this.options.onStartVoice());
    });
    // Stop must work while Mia is busy, so it bypasses the busy gate that guards other tasks.
    this.shadow.querySelector("[data-cancel]")?.addEventListener("click", () => {
      void this.options.onCancel().catch((error) => {
        this.setError(error instanceof Error ? error.message : String(error));
      });
    });
    this.renderSuggestions();
    this.renderTranscript();
    this.updateControls();
  }

  private async runTask(task: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.updateControls();
    try {
      await task();
    } catch (error) {
      this.setError(error instanceof Error ? error.message : String(error));
    } finally {
      this.busy = false;
      this.updateControls();
    }
  }

  private togglePanel(): void {
    this.open ? this.closePanel() : this.openPanel();
  }

  private openPanel(): void {
    this.open = true;
    const panel = this.shadow.querySelector<HTMLElement>(".mia-panel");
    const launcher = this.shadow.querySelector<HTMLButtonElement>(".mia-launcher");
    panel?.removeAttribute("hidden");
    this.shadow.querySelector(".mia-panel-root")?.setAttribute("data-open", "true");
    launcher?.setAttribute("aria-expanded", "true");
    this.renderSuggestions();
    window.setTimeout(() => this.shadow.querySelector<HTMLInputElement>("#mia-ask-input")?.focus({ preventScroll: true }), 0);
  }

  private closePanel(): void {
    this.open = false;
    const panel = this.shadow.querySelector<HTMLElement>(".mia-panel");
    const launcher = this.shadow.querySelector<HTMLButtonElement>(".mia-launcher");
    panel?.setAttribute("hidden", "");
    this.shadow.querySelector(".mia-panel-root")?.setAttribute("data-open", "false");
    launcher?.setAttribute("aria-expanded", "false");
  }

  private renderSuggestions(): void {
    const suggestions = this.options.getSuggestions().slice(0, 4);
    const container = this.shadow.querySelector<HTMLElement>(".mia-suggestions");
    if (!container) return;
    container.replaceChildren();
    for (const suggestion of suggestions) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = suggestion;
      button.addEventListener("click", () => void this.runTask(() => this.options.onAsk(suggestion)));
      container.append(button);
    }
  }

  private renderTranscript(): void {
    const container = this.shadow.querySelector<HTMLElement>(".mia-transcript");
    if (!container) return;
    container.replaceChildren();
    if (this.entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "mia-empty";
      empty.textContent = "Ask where something is, what a screen means, or say what you're trying to do.";
      container.append(empty);
      return;
    }

    for (const entry of this.entries) {
      const item = document.createElement("article");
      item.className = `mia-message ${entry.role}`;
      const role = document.createElement("strong");
      role.textContent = entry.role === "user" ? "You" : entry.role === "assistant" ? "Mia" : "System";
      const text = document.createElement("span");
      text.textContent = entry.text;
      item.append(role, text);
      container.append(item);
    }
    container.scrollTop = container.scrollHeight;
  }

  private updateStatus(): void {
    const label = this.shadow.querySelector<HTMLElement>("[data-status-label]");
    const dot = this.shadow.querySelector<HTMLElement>(".mia-status-dot");
    const pill = this.shadow.querySelector<HTMLElement>("[data-status-pill]");
    label && (label.textContent = STATUS_LABELS[this.status]);
    if (dot) dot.className = `mia-status-dot ${STATUS_TONES[this.status]}${this.status === "listening" ? " is-listening" : ""}`;
    if (pill) {
      pill.className = `mia-status-pill ${STATUS_TONES[this.status]}`;
      pill.textContent = STATUS_LABELS[this.status];
    }
  }

  private updateControls(): void {
    const voice = this.shadow.querySelector<HTMLButtonElement>("[data-voice]");
    const send = this.shadow.querySelector<HTMLButtonElement>(".mia-send");
    const thinking = this.shadow.querySelector<HTMLElement>(".mia-thinking");
    if (voice) {
      voice.textContent = this.isVoiceActive() ? "Stop voice" : "Start voice";
      voice.disabled = this.busy || !this.options.enableVoice;
    }
    if (send) send.disabled = this.busy;
    if (thinking) thinking.hidden = !this.busy;
  }

  private isVoiceActive(): boolean {
    return ["connecting", "listening", "thinking", "speaking", "guiding"].includes(this.status);
  }
}

function friendlyErrorText(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("failed to fetch") || lower.includes("networkerror") || lower.includes("load failed") || lower.includes("fetch failed")) {
    return "Mia couldn't connect. Check your internet connection and try again.";
  }
  if (lower.includes("401") || lower.includes("403") || lower.includes("unauthorized") || lower.includes("forbidden")) {
    return "Mia isn't available right now. Please let your team know if this keeps happening.";
  }
  if (lower.includes("microphone") || lower.includes("notallowederror") || lower.includes("permission denied")) {
    return "Mia can't use your microphone. Allow microphone access in your browser to use voice.";
  }
  if (/\b50[0-9]\b/.test(lower) || lower.includes("internal")) {
    return "Something went wrong on Mia's side. Try again in a moment.";
  }
  return `Something went wrong: ${message}`;
}

const styles = `
:host {
  all: initial;
  color-scheme: light dark;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
}

* {
  box-sizing: border-box;
}

.mia-panel-root {
  /* Dark theme is the default; light hosts get the override below. */
  --mia-surface: rgba(15, 23, 42, 0.94);
  --mia-surface-2: rgba(30, 41, 59, 0.84);
  --mia-inset: rgba(2, 6, 23, 0.32);
  --mia-border: rgba(148, 163, 184, 0.28);
  --mia-border-soft: rgba(148, 163, 184, 0.2);
  --mia-text: #f8fafc;
  --mia-text-2: #cbd5e1;
  --mia-message-text: #dbeafe;
  --mia-input-bg: rgba(15, 23, 42, 0.74);
  --mia-placeholder: #94a3b8;
  --mia-send-bg: #e2e8f0;
  --mia-send-text: #0f172a;
  --mia-message-bg: rgba(15, 23, 42, 0.58);
  --mia-user-bg: rgba(78, 110, 242, 0.22);
  --mia-system-bg: rgba(245, 158, 11, 0.14);
  --mia-focus: #93c5fd;
  --mia-accent: #4e6ef2;
  --mia-accent-text: #ffffff;
  position: fixed;
  right: max(16px, env(safe-area-inset-right));
  bottom: max(16px, env(safe-area-inset-bottom));
  z-index: 2147483645;
  color: var(--mia-text);
}

@media (prefers-color-scheme: light) {
  .mia-panel-root {
    --mia-surface: rgba(255, 255, 255, 0.98);
    --mia-surface-2: #f1f5f9;
    --mia-inset: #f8fafc;
    --mia-border: rgba(15, 23, 42, 0.16);
    --mia-border-soft: rgba(15, 23, 42, 0.1);
    --mia-text: #0f172a;
    --mia-text-2: #43536b;
    --mia-message-text: #1e293b;
    --mia-input-bg: #ffffff;
    --mia-placeholder: #64748b;
    --mia-send-bg: #0f172a;
    --mia-send-text: #f8fafc;
    --mia-message-bg: #f8fafc;
    --mia-user-bg: rgba(58, 85, 224, 0.09);
    --mia-system-bg: rgba(217, 119, 6, 0.1);
    --mia-focus: #2563eb;
    --mia-accent: #3a55e0;
    --mia-accent-text: #ffffff;
  }
}

.mia-launcher,
.mia-panel {
  border: 1px solid var(--mia-border);
  background: var(--mia-surface);
  box-shadow: 0 18px 48px rgba(2, 6, 23, 0.22);
}

.mia-launcher {
  display: flex;
  min-width: 172px;
  min-height: 52px;
  align-items: center;
  gap: 10px;
  border-radius: 12px;
  color: inherit;
  padding: 8px 11px;
  cursor: pointer;
  transition: border-color 140ms ease, background-color 140ms ease;
}

.mia-launcher:hover {
  border-color: var(--mia-accent);
}

.mia-launcher:focus-visible,
button:focus-visible,
input:focus-visible {
  outline: 2px solid var(--mia-focus);
  outline-offset: 2px;
}

.mia-mark {
  display: grid;
  width: 32px;
  height: 32px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 9px;
  background: var(--mia-accent);
  color: var(--mia-accent-text);
  font: 800 14px/1 system-ui, sans-serif;
}

.mia-launcher-copy {
  display: grid;
  flex: 1;
  gap: 2px;
  min-width: 0;
  text-align: left;
}

.mia-launcher-copy strong {
  font: 700 13px/1.1 system-ui, sans-serif;
}

.mia-launcher-copy span {
  color: var(--mia-text-2);
  font: 500 12px/1.1 system-ui, sans-serif;
}

.mia-status-dot {
  width: 9px;
  height: 9px;
  border-radius: 999px;
  background: #94a3b8;
}

.mia-status-dot.green { background: #34d399; }
.mia-status-dot.yellow { background: #fbbf24; }
.mia-status-dot.red { background: #fb7185; }

.mia-panel {
  position: absolute;
  right: 0;
  bottom: 62px;
  display: flex;
  flex-direction: column;
  width: min(390px, calc(100vw - 32px));
  max-height: min(680px, calc(100vh - 100px));
  gap: 12px;
  overflow: hidden;
  border-radius: 12px;
  padding: 14px;
  animation: mia-panel-in 170ms cubic-bezier(0.22, 1, 0.36, 1);
}

.mia-panel[hidden] {
  display: none;
}

@keyframes mia-panel-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
}

@keyframes mia-dot-pulse {
  50% {
    opacity: 0.35;
  }
}

.mia-status-dot.is-listening {
  animation: mia-dot-pulse 1.4s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .mia-panel {
    animation: none;
  }

  .mia-status-dot.is-listening {
    animation: none;
  }

  .mia-launcher,
  .mia-send,
  .mia-control,
  .mia-suggestions button {
    transition: none;
  }
}

.mia-panel-header,
.mia-state-row,
.mia-controls,
.mia-input-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mia-panel-header {
  justify-content: space-between;
}

.mia-panel-header div {
  display: grid;
  gap: 2px;
}

.mia-panel-header strong {
  font: 750 15px/1.2 system-ui, sans-serif;
}

.mia-panel-header span,
.mia-hotkey,
.mia-thinking,
.mia-empty {
  color: var(--mia-text-2);
  font: 500 12px/1.4 system-ui, sans-serif;
}

.mia-icon-button {
  width: 32px;
  height: 32px;
  border: 1px solid var(--mia-border);
  border-radius: 8px;
  background: var(--mia-surface-2);
  color: var(--mia-text);
  cursor: pointer;
  font: 700 18px/1 system-ui, sans-serif;
}

.mia-state-row {
  flex-wrap: wrap;
}

.mia-status-pill,
.mia-privacy-pill {
  display: inline-flex;
  min-height: 24px;
  align-items: center;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 7px;
  padding: 3px 7px;
  font: 700 12px/1.1 system-ui, sans-serif;
}

.mia-status-pill.green { border-color: rgba(52, 211, 153, 0.35); background: rgba(16, 185, 129, 0.16); color: #86efac; }
.mia-status-pill.yellow { border-color: rgba(251, 191, 36, 0.34); background: rgba(245, 158, 11, 0.16); color: #fde68a; }
.mia-status-pill.red { border-color: rgba(251, 113, 133, 0.36); background: rgba(244, 63, 94, 0.16); color: #fecdd3; }
.mia-status-pill.gray { background: rgba(51, 65, 85, 0.78); color: #cbd5e1; }

@media (prefers-color-scheme: light) {
  .mia-status-pill.green { border-color: rgba(22, 163, 74, 0.3); background: rgba(22, 163, 74, 0.1); color: #166534; }
  .mia-status-pill.yellow { border-color: rgba(217, 119, 6, 0.3); background: rgba(217, 119, 6, 0.11); color: #92400e; }
  .mia-status-pill.red { border-color: rgba(220, 38, 38, 0.3); background: rgba(220, 38, 38, 0.1); color: #991b1b; }
  .mia-status-pill.gray { background: #e2e8f0; color: #334155; }
}

.mia-privacy-pill {
  background: var(--mia-surface-2);
  color: var(--mia-text-2);
  font-weight: 600;
}

.mia-ask-form {
  display: grid;
  gap: 7px;
}

.mia-ask-form label {
  color: var(--mia-text);
  font: 700 12px/1.2 system-ui, sans-serif;
}

.mia-input-row {
  align-items: stretch;
}

.mia-input-row input {
  min-width: 0;
  flex: 1;
  min-height: 42px;
  border: 1px solid var(--mia-border);
  border-radius: 9px;
  background: var(--mia-input-bg);
  color: var(--mia-text);
  padding: 0 10px;
  font: 500 13px/1.2 system-ui, sans-serif;
}

.mia-input-row input::placeholder {
  color: var(--mia-placeholder);
}

.mia-send,
.mia-control,
.mia-suggestions button {
  min-height: 42px;
  border: 1px solid var(--mia-border);
  border-radius: 9px;
  background: var(--mia-send-bg);
  color: var(--mia-send-text);
  padding: 0 12px;
  cursor: pointer;
  font: 750 13px/1 system-ui, sans-serif;
  transition: background-color 140ms ease, border-color 140ms ease, color 140ms ease;
}

.mia-send {
  border-color: var(--mia-accent);
  background: var(--mia-accent);
  color: var(--mia-accent-text);
}

.mia-control {
  flex: 1;
  background: var(--mia-surface-2);
  color: var(--mia-text);
}

.mia-send:hover:not(:disabled) {
  filter: brightness(1.08);
}

.mia-control:hover:not(:disabled),
.mia-suggestions button:hover:not(:disabled) {
  border-color: var(--mia-accent);
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.56;
}

.mia-suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.mia-suggestions button {
  min-height: 32px;
  max-width: 100%;
  overflow: hidden;
  background: var(--mia-surface-2);
  color: var(--mia-text);
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 650;
}

.mia-hotkey {
  margin: -4px 0 0;
}

.mia-transcript {
  display: grid;
  align-content: start;
  flex: 1;
  min-height: 120px;
  gap: 8px;
  overflow: auto;
  border: 1px solid var(--mia-border-soft);
  border-radius: 10px;
  background: var(--mia-inset);
  padding: 10px;
}

.mia-message {
  display: grid;
  gap: 3px;
  border: 1px solid var(--mia-border-soft);
  border-radius: 9px;
  background: var(--mia-message-bg);
  padding: 8px 9px;
}

.mia-message strong {
  color: var(--mia-text);
  font: 750 12px/1.2 system-ui, sans-serif;
}

.mia-message span {
  color: var(--mia-message-text);
  font: 500 13px/1.4 system-ui, sans-serif;
  white-space: pre-wrap;
}

.mia-message.user {
  background: var(--mia-user-bg);
}

.mia-message.system {
  background: var(--mia-system-bg);
}

@media (max-width: 520px) {
  .mia-panel-root {
    left: 12px;
    right: 12px;
  }

  .mia-launcher {
    margin-left: auto;
  }

  .mia-panel {
    left: 0;
    right: 0;
    width: auto;
  }
}
`;

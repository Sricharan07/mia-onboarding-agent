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
  onStartScreenShare: () => Promise<void>;
  onStopScreenShare: () => void;
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
  ended: "Voice off"
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
  private voiceActive = false;
  private screenShareActive = false;
  private entries: MiaTranscriptEntry[] = [];
  private readonly handleDocumentPointerDown = (event: PointerEvent): void => {
    if (!this.open) return;
    if (event.composedPath().includes(this.host)) return;
    this.closePanel();
  };
  private readonly handleDocumentKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && this.open) {
      this.closePanel(true);
    }
  };

  constructor(private readonly options: MiaAssistantPanelOptions) {}

  mount(): void {
    this.host.dataset.miaAssistantPanel = "true";
    document.body.append(this.host);
    document.addEventListener("pointerdown", this.handleDocumentPointerDown, { capture: true });
    document.addEventListener("keydown", this.handleDocumentKeyDown);
    this.render();
  }

  destroy(): void {
    document.removeEventListener("pointerdown", this.handleDocumentPointerDown, { capture: true });
    document.removeEventListener("keydown", this.handleDocumentKeyDown);
    this.host.remove();
  }

  setStatus(status: MiaStatus): void {
    this.status = status;
    this.updateStatus();
    this.updateControls();
  }

  setVoiceActive(active: boolean): void {
    this.voiceActive = active;
    this.updateControls();
  }

  setScreenShareActive(active: boolean): void {
    this.screenShareActive = active;
    const state = this.shadow.querySelector<HTMLElement>("[data-screen-state]");
    if (state) state.textContent = active ? "Screen sharing on" : "Screen not shared";
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
        <button class="mia-launcher" type="button" aria-expanded="${this.open}" aria-controls="mia-assistant-panel" aria-haspopup="dialog" aria-label="${this.open ? "Close Mia" : "Open Mia"}">
          <span class="mia-mark" aria-hidden="true">M</span>
          <span class="mia-launcher-copy">
            <strong>Mia</strong>
            <span data-status-label>${STATUS_LABELS[this.status]}</span>
          </span>
          <span class="mia-status-dot ${STATUS_TONES[this.status]}" aria-hidden="true"></span>
        </button>

        <section id="mia-assistant-panel" class="mia-panel" role="dialog" aria-modal="false" aria-label="Mia assistant" ${this.open ? "" : "hidden"}>
          <header class="mia-panel-header">
            <div class="mia-title-lockup">
              <span class="mia-panel-mark" aria-hidden="true">M</span>
              <div class="mia-title-copy">
                <strong>Mia</strong>
                <span>Help for this page</span>
              </div>
            </div>
            <button class="mia-icon-button" type="button" data-close aria-label="Close Mia">&times;</button>
          </header>

          <div class="mia-state-row">
            <span class="mia-status-pill ${STATUS_TONES[this.status]}" data-status-pill>${STATUS_LABELS[this.status]}</span>
            <span class="mia-privacy-pill">${this.options.textRedacted ? "Page text hidden from Mia" : "Mia can see this page"}</span>
            ${this.options.enableScreenShare ? `<span class="mia-privacy-pill" data-screen-state>${this.screenShareActive ? "Screen sharing on" : "Screen not shared"}</span>` : ""}
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
            ${this.options.enableScreenShare ? `<button class="mia-control" type="button" data-screen aria-pressed="${this.screenShareActive}">${this.screenShareActive ? "Stop sharing" : "Share screen"}</button>` : ""}
            <button class="mia-control" type="button" data-cancel>Stop Mia</button>
          </div>

          ${this.options.enableVoice ? `<p class="mia-hotkey">Hold Ctrl+Space anywhere to talk. Release to pause the mic.</p>` : ""}

          <div class="mia-thinking" role="status" hidden>Mia is thinking&hellip;</div>

          <div class="mia-transcript" aria-live="polite"></div>
        </section>
      </div>
    `;

    this.shadow.querySelector(".mia-launcher")?.addEventListener("click", () => this.togglePanel());
    this.shadow.querySelector("[data-close]")?.addEventListener("click", () => this.closePanel(true));
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
    this.shadow.querySelector("[data-screen]")?.addEventListener("click", () => {
      void this.runTask(async () => {
        if (this.screenShareActive) this.options.onStopScreenShare();
        else await this.options.onStartScreenShare();
      });
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
    launcher?.setAttribute("aria-label", "Close Mia");
    this.renderSuggestions();
    window.setTimeout(() => this.shadow.querySelector<HTMLInputElement>("#mia-ask-input")?.focus({ preventScroll: true }), 0);
  }

  private closePanel(restoreFocus = false): void {
    this.open = false;
    const panel = this.shadow.querySelector<HTMLElement>(".mia-panel");
    const launcher = this.shadow.querySelector<HTMLButtonElement>(".mia-launcher");
    panel?.setAttribute("hidden", "");
    this.shadow.querySelector(".mia-panel-root")?.setAttribute("data-open", "false");
    launcher?.setAttribute("aria-expanded", "false");
    launcher?.setAttribute("aria-label", "Open Mia");
    if (restoreFocus) launcher?.focus({ preventScroll: true });
  }

  private renderSuggestions(): void {
    const suggestions = this.options.getSuggestions().slice(0, 4);
    const container = this.shadow.querySelector<HTMLElement>(".mia-suggestions");
    if (!container) return;
    container.replaceChildren();
    for (const suggestion of suggestions) {
      const label = suggestion.replace(/\s+/g, " ").trim();
      if (!label) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", () => void this.runTask(() => this.options.onAsk(label)));
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
    const screen = this.shadow.querySelector<HTMLButtonElement>("[data-screen]");
    const send = this.shadow.querySelector<HTMLButtonElement>(".mia-send");
    const thinking = this.shadow.querySelector<HTMLElement>(".mia-thinking");
    if (voice) {
      voice.textContent = this.isVoiceActive() ? "Stop voice" : "Start voice";
      voice.disabled = this.busy || !this.options.enableVoice;
    }
    if (screen) {
      screen.textContent = this.screenShareActive ? "Stop sharing" : "Share screen";
      screen.setAttribute("aria-pressed", String(this.screenShareActive));
      screen.disabled = this.busy || !this.options.enableScreenShare;
    }
    if (send) send.disabled = this.busy;
    if (thinking) thinking.hidden = !this.busy;
  }

  private isVoiceActive(): boolean {
    return this.voiceActive;
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
  if (lower.includes("screen sharing") || lower.includes("display media")) {
    return "Screen sharing was not started. Choose Share screen when you want to try again.";
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
  color-scheme: dark;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
}

* {
  box-sizing: border-box;
}

button,
input {
  font-family: inherit;
}

.mia-panel-root {
  --mia-ease: cubic-bezier(0.22, 1, 0.36, 1);
  --mia-shell: rgba(14, 16, 24, 0.72);
  --mia-shell-strong: rgba(11, 13, 20, 0.9);
  --mia-glass: rgba(255, 255, 255, 0.1);
  --mia-glass-strong: rgba(255, 255, 255, 0.16);
  --mia-glass-soft: rgba(255, 255, 255, 0.065);
  --mia-border: rgba(255, 255, 255, 0.2);
  --mia-border-strong: rgba(174, 243, 226, 0.52);
  --mia-text: #f9fbff;
  --mia-text-2: #d9e0ed;
  --mia-text-3: #aeb8c9;
  --mia-message-text: #e6ecf7;
  --mia-placeholder: #aeb8c9;
  --mia-accent: #78f1d7;
  --mia-accent-2: #6474ff;
  --mia-accent-3: #c08cff;
  --mia-accent-text: #ffffff;
  --mia-success: #70efbf;
  --mia-warning: #ffd36a;
  --mia-danger: #ff8aa5;
  --mia-radius: 30px;
  position: fixed;
  right: max(18px, env(safe-area-inset-right));
  bottom: max(18px, env(safe-area-inset-bottom));
  z-index: 2147483645;
  color: var(--mia-text);
}

.mia-launcher,
.mia-panel {
  position: relative;
  border: 1px solid var(--mia-border);
  background:
    linear-gradient(142deg, rgba(255, 255, 255, 0.18), rgba(255, 255, 255, 0.055) 38%, rgba(255, 255, 255, 0.12)),
    linear-gradient(180deg, rgba(28, 30, 42, 0.8), rgba(10, 12, 19, 0.82));
  backdrop-filter: blur(30px) saturate(1.65);
  -webkit-backdrop-filter: blur(30px) saturate(1.65);
  isolation: isolate;
  box-shadow:
    0 22px 70px rgba(0, 0, 0, 0.32),
    inset 0 1px 0 rgba(255, 255, 255, 0.22),
    inset 0 -1px 0 rgba(255, 255, 255, 0.08);
}

.mia-launcher::before,
.mia-panel::before {
  position: absolute;
  inset: 1px;
  border-radius: inherit;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.22), transparent 36%),
    linear-gradient(315deg, rgba(120, 241, 215, 0.14), transparent 42%),
    linear-gradient(35deg, transparent 46%, rgba(192, 140, 255, 0.1));
  content: "";
  pointer-events: none;
  z-index: -1;
}

.mia-launcher::after,
.mia-panel::after {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(112deg, transparent 0%, rgba(255, 255, 255, 0.2) 18%, transparent 38%);
  content: "";
  opacity: 0.4;
  pointer-events: none;
  transform: translateX(-42%);
  transition: transform 360ms var(--mia-ease), opacity 180ms ease;
}

.mia-launcher {
  display: flex;
  width: 170px;
  min-height: 58px;
  align-items: center;
  gap: 12px;
  overflow: hidden;
  border-radius: 22px;
  color: inherit;
  padding: 10px 12px;
  cursor: pointer;
  transform-origin: 100% 100%;
  transition:
    width 520ms var(--mia-ease),
    border-color 180ms ease,
    border-radius 520ms var(--mia-ease),
    transform 220ms var(--mia-ease),
    box-shadow 220ms ease;
}

.mia-launcher:hover {
  border-color: var(--mia-border-strong);
  transform: translateY(-1px);
  box-shadow:
    0 24px 72px rgba(0, 0, 0, 0.34),
    0 0 0 1px rgba(120, 241, 215, 0.11),
    inset 0 1px 0 rgba(255, 255, 255, 0.24);
}

.mia-launcher:hover::after,
.mia-panel-root[data-open="true"] .mia-launcher::after {
  opacity: 0.68;
  transform: translateX(28%);
}

.mia-panel-root[data-open="true"] .mia-launcher {
  width: min(314px, calc(100vw - 36px));
  border-color: rgba(255, 255, 255, 0.24);
  border-radius: 24px;
  background:
    linear-gradient(142deg, rgba(255, 255, 255, 0.18), rgba(255, 255, 255, 0.07) 40%, rgba(255, 255, 255, 0.11)),
    linear-gradient(180deg, rgba(29, 31, 43, 0.86), rgba(10, 12, 20, 0.88));
}

.mia-launcher:focus-visible,
button:focus-visible,
input:focus-visible {
  outline: 2px solid rgba(147, 197, 253, 0.9);
  outline-offset: 2px;
}

.mia-mark {
  display: grid;
  width: 38px;
  height: 38px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.24);
  border-radius: 14px;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.44), transparent 30%),
    linear-gradient(145deg, var(--mia-accent), var(--mia-accent-2) 62%, var(--mia-accent-3));
  color: var(--mia-accent-text);
  font: 820 16px/1 system-ui, sans-serif;
  box-shadow:
    0 10px 24px rgba(100, 116, 255, 0.26),
    inset 0 1px 0 rgba(255, 255, 255, 0.36);
}

.mia-launcher-copy {
  display: grid;
  flex: 1;
  gap: 2px;
  min-width: 0;
  text-align: left;
}

.mia-launcher-copy strong {
  font: 770 15px/1.1 system-ui, sans-serif;
  letter-spacing: 0;
}

.mia-launcher-copy span {
  color: var(--mia-text-2);
  font: 650 12px/1.15 system-ui, sans-serif;
}

.mia-status-dot {
  width: 9px;
  height: 9px;
  flex: 0 0 auto;
  border-radius: 999px;
  background: #94a3b8;
  box-shadow:
    0 0 0 5px rgba(255, 255, 255, 0.07),
    0 0 18px currentColor;
}

.mia-status-dot.green { background: var(--mia-success); }
.mia-status-dot.yellow { background: var(--mia-warning); }
.mia-status-dot.red { background: var(--mia-danger); }
.mia-status-dot.gray { background: #aeb8c9; }

.mia-panel {
  position: absolute;
  right: 0;
  bottom: 76px;
  display: flex;
  flex-direction: column;
  width: min(458px, calc(100vw - 36px));
  max-height: min(680px, calc(100vh - 116px));
  gap: 12px;
  overflow: auto;
  border-radius: var(--mia-radius);
  padding: 18px;
  transform-origin: calc(100% - 58px) calc(100% + 58px);
  animation: mia-liquid-open 620ms var(--mia-ease);
  scrollbar-color: rgba(217, 224, 237, 0.28) transparent;
  scrollbar-width: thin;
}

.mia-panel[hidden] {
  display: none;
}

@keyframes mia-liquid-open {
  0% {
    opacity: 0;
    transform: translateY(18px) scale(0.64, 0.28);
    clip-path: inset(76% 4% 0 44% round 999px);
  }
  58% {
    opacity: 1;
    transform: translateY(-3px) scale(1.012, 1.012);
    clip-path: inset(0 round 34px);
  }
  100% {
    opacity: 1;
    transform: translateY(0) scale(1);
    clip-path: inset(0 round var(--mia-radius));
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

  .mia-launcher::after,
  .mia-panel::after {
    transition: none;
  }
}

.mia-panel-header,
.mia-state-row,
.mia-controls,
.mia-input-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.mia-panel-header {
  justify-content: space-between;
  min-height: 46px;
}

.mia-title-lockup {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 12px;
}

.mia-panel-mark {
  display: grid;
  width: 44px;
  height: 44px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 16px;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.42), transparent 30%),
    linear-gradient(145deg, var(--mia-accent), var(--mia-accent-2) 62%, var(--mia-accent-3));
  box-shadow:
    0 14px 34px rgba(100, 116, 255, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.36);
  color: var(--mia-accent-text);
  font: 840 17px/1 system-ui, sans-serif;
}

.mia-title-copy {
  display: grid;
  min-width: 0;
  gap: 4px;
}

.mia-panel-header strong {
  font: 780 21px/1.08 system-ui, sans-serif;
  letter-spacing: 0;
}

.mia-panel-header span,
.mia-hotkey,
.mia-thinking,
.mia-empty {
  color: var(--mia-text-2);
  font: 650 13px/1.42 system-ui, sans-serif;
}

.mia-icon-button {
  width: 42px;
  height: 42px;
  flex: 0 0 auto;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 16px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.055));
  color: var(--mia-text);
  cursor: pointer;
  font: 780 25px/1 system-ui, sans-serif;
  transition: background-color 180ms ease, border-color 180ms ease, transform 180ms var(--mia-ease);
}

.mia-icon-button:hover {
  border-color: rgba(255, 255, 255, 0.32);
  background: rgba(255, 255, 255, 0.16);
  transform: translateY(-1px);
}

.mia-state-row {
  flex-wrap: wrap;
  align-items: center;
}

.mia-status-pill,
.mia-privacy-pill {
  display: inline-flex;
  min-height: 30px;
  align-items: center;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.075);
  padding: 6px 10px;
  font: 740 12px/1.1 system-ui, sans-serif;
}

.mia-status-pill.green { border-color: rgba(112, 239, 191, 0.44); background: rgba(20, 184, 166, 0.18); color: #c7f9e5; }
.mia-status-pill.yellow { border-color: rgba(255, 211, 106, 0.38); background: rgba(245, 158, 11, 0.16); color: #ffe8a6; }
.mia-status-pill.red { border-color: rgba(255, 138, 165, 0.42); background: rgba(244, 63, 94, 0.17); color: #ffd1dc; }
.mia-status-pill.gray { background: rgba(255, 255, 255, 0.08); color: var(--mia-text-2); }

.mia-privacy-pill {
  background: rgba(255, 255, 255, 0.07);
  color: var(--mia-text-2);
  font-weight: 650;
}

.mia-ask-form {
  display: grid;
  gap: 10px;
  margin-top: 2px;
}

.mia-ask-form label {
  color: var(--mia-text);
  font: 760 15px/1.2 system-ui, sans-serif;
  letter-spacing: 0;
}

.mia-input-row {
  align-items: stretch;
  padding: 4px;
  border: 1px solid rgba(174, 243, 226, 0.5);
  border-radius: 22px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.055), rgba(255, 255, 255, 0.02)),
    rgba(8, 10, 16, 0.58);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.14),
    0 0 0 4px rgba(120, 241, 215, 0.07);
  transition: border-color 180ms ease, background-color 180ms ease, box-shadow 180ms ease;
}

.mia-input-row:focus-within {
  border-color: rgba(120, 241, 215, 0.82);
  background: rgba(8, 10, 16, 0.68);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.18),
    0 0 0 5px rgba(120, 241, 215, 0.12);
}

.mia-input-row input {
  min-width: 0;
  flex: 1;
  min-height: 58px;
  border: 0;
  border-radius: 18px;
  background: transparent;
  color: var(--mia-text);
  padding: 0 14px;
  font: 660 17px/1.2 system-ui, sans-serif;
  outline: 0;
}

.mia-input-row input::placeholder {
  color: var(--mia-placeholder);
}

.mia-send,
.mia-control,
.mia-suggestions button {
  min-height: 46px;
  border: 1px solid rgba(255, 255, 255, 0.13);
  border-radius: 16px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.105), rgba(255, 255, 255, 0.045));
  color: var(--mia-text);
  padding: 0 14px;
  cursor: pointer;
  font: 760 14px/1.12 system-ui, sans-serif;
  transition: background-color 180ms ease, border-color 180ms ease, color 180ms ease, transform 180ms var(--mia-ease), box-shadow 180ms ease;
}

.mia-send {
  min-width: 92px;
  min-height: 58px;
  border-color: rgba(255, 255, 255, 0.24);
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.36), transparent 30%),
    linear-gradient(145deg, var(--mia-accent), var(--mia-accent-2) 72%);
  color: var(--mia-accent-text);
  padding: 0 20px;
  box-shadow: 0 14px 30px rgba(100, 116, 255, 0.24);
}

.mia-control {
  flex: 1;
  min-height: 54px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.11), rgba(255, 255, 255, 0.05));
  color: var(--mia-text);
  font-size: 15px;
}

.mia-send:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 18px 38px rgba(100, 116, 255, 0.3);
}

.mia-control:hover:not(:disabled),
.mia-suggestions button:hover:not(:disabled) {
  border-color: rgba(174, 243, 226, 0.42);
  background: rgba(255, 255, 255, 0.13);
  transform: translateY(-1px);
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.56;
}

.mia-suggestions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.mia-suggestions button {
  display: flex;
  min-height: 52px;
  max-width: 100%;
  align-items: center;
  justify-content: center;
  overflow-wrap: anywhere;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.095), rgba(255, 255, 255, 0.04));
  color: var(--mia-text);
  line-height: 1.18;
  text-align: center;
  white-space: normal;
}

.mia-hotkey {
  margin: -1px 0 0;
  color: var(--mia-text-2);
  text-align: center;
}

.mia-transcript {
  display: grid;
  align-content: start;
  flex: 1;
  min-height: 132px;
  gap: 9px;
  overflow: auto;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 22px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.055), rgba(255, 255, 255, 0.02)),
    rgba(8, 10, 16, 0.44);
  padding: 14px;
  scrollbar-color: rgba(217, 224, 237, 0.28) transparent;
  scrollbar-width: thin;
}

.mia-empty {
  align-self: start;
  color: var(--mia-text-2);
  font: 760 16px/1.42 system-ui, sans-serif;
}

.mia-message {
  display: grid;
  gap: 5px;
  border: 1px solid rgba(255, 255, 255, 0.11);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.07);
  padding: 10px 12px;
}

.mia-message strong {
  color: var(--mia-text);
  font: 770 12px/1.2 system-ui, sans-serif;
}

.mia-message span {
  color: var(--mia-message-text);
  font: 570 13px/1.44 system-ui, sans-serif;
  white-space: pre-wrap;
}

.mia-message.user {
  background: rgba(100, 116, 255, 0.14);
}

.mia-message.system {
  background: rgba(255, 211, 106, 0.11);
}

.mia-controls {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

@media (max-width: 520px) {
  .mia-panel-root {
    left: 12px;
    right: 12px;
    bottom: max(12px, env(safe-area-inset-bottom));
  }

  .mia-launcher {
    width: 170px;
    margin-left: auto;
  }

  .mia-panel-root[data-open="true"] .mia-launcher {
    width: 100%;
  }

  .mia-panel {
    left: 0;
    right: 0;
    width: auto;
    bottom: 76px;
    max-height: min(666px, calc(100vh - 100px));
    padding: 16px;
    border-radius: 28px;
  }
}

@media (max-width: 360px) {
  .mia-input-row {
    flex-wrap: wrap;
  }

  .mia-send {
    flex: 1 1 100%;
  }

  .mia-suggestions,
  .mia-controls {
    grid-template-columns: 1fr;
  }
}

@media (max-height: 720px) {
  .mia-panel {
    gap: 10px;
    padding: 14px;
  }

  .mia-input-row input,
  .mia-send {
    min-height: 50px;
  }

  .mia-suggestions button,
  .mia-control {
    min-height: 46px;
  }

  .mia-transcript {
    min-height: 96px;
  }
}
`;

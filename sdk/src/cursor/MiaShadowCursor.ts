import { MIA_SHADOW_CURSOR_STYLES } from "./miaShadowCursorStyles.js";
import type { MiaCursorState, MiaTheme } from "../types/index.js";
import { prefersReducedMotion } from "../accessibility/motion.js";

type CursorNavMode = "followingCursor" | "navigatingToTarget" | "pointingAtTarget" | "returningToCursor";
type CursorOffset = { x: number; y: number };

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function expLerp(current: number, target: number, rate: number, dt: number): number {
  const k = 1 - Math.exp(-rate * dt);
  return current + (target - current) * k;
}

function expLerpAngle(current: number, target: number, rate: number, dt: number): number {
  const delta = ((((target - current) % 360) + 540) % 360) - 180;
  const k = 1 - Math.exp(-rate * dt);
  return current + delta * k;
}

export class MiaShadowCursor {
  private host: HTMLDivElement | null = null;
  private shadow: ShadowRoot | null = null;
  private root: HTMLDivElement | null = null;
  private icon: HTMLDivElement | null = null;
  private iconInner: HTMLDivElement | null = null;
  private iconImg: HTMLImageElement | null = null;
  private shimmer: HTMLDivElement | null = null;
  private bubble: HTMLDivElement | null = null;
  private bubbleText: HTMLDivElement | null = null;
  private navBubble: HTMLDivElement | null = null;
  private navBubbleText: HTMLDivElement | null = null;
  private bars: HTMLDivElement[] = [];

  private cursor = { x: 0, y: 0 };
  private cursorInitialized = false;
  private offset: CursorOffset = { x: 20, y: 20 };
  private bubbleMaxWidth = 320;
  private bubbleLingerMs = 3000;
  private fadeDurationMs = 3000;
  private theme: MiaTheme = "auto";
  private reducedMotion = false;

  private bubbleQueue = "";
  private typeTimer: number | null = null;
  private fadeTimer: number | null = null;
  private hideTimer: number | null = null;
  private typewriterCharsPerSecond = 12;
  private typewriterCarry = 0;
  private typewriterLastTs = 0;

  private state: MiaCursorState = "idle";
  private navMode: CursorNavMode = "followingCursor";
  private navTarget: { x: number; y: number; label: string } | null = null;
  private navBubblePos = { x: 0, y: 0 };
  private navBubbleOpacity = 0;
  private navBubbleOpacityTarget = 0;
  private navBubbleScale = 0.9;
  private navBubbleScaleTarget = 0.9;
  private isReturningToCursor = false;

  private iconPos = { x: 0, y: 0 };
  private bubblePos = { x: 0, y: 0 };
  private vel = { x: 0, y: 0 };
  private cursorOpacity = 0.55;
  private cursorOpacityTarget = 0.55;
  private flightScale = 1;
  private flightScaleTarget = 1;
  private rotationDeg = 0;
  private rotationTarget = 0;
  private shimmerTurnDeg = 0;
  private shimmerTurnTarget = 0;
  private listeningLevel = 0;
  private listeningLevelTarget = 0;
  private speakingLevel = 0;
  private speakingLevelTarget = 0;
  private energy = 0;

  private renderRaf: number | null = null;
  private lastFrameTs = 0;

  mount(): void {
    if (this.host) return;
    this.host = document.createElement("div");
    this.host.dataset.miaShadowCursor = "true";
    this.host.className = "mia-shadow-cursor-host";
    this.shadow = this.host.attachShadow({ mode: "open" });
    this.shadow.innerHTML = this.template();
    document.body.append(this.host);

    this.root = this.shadow.querySelector(".mia-root") as HTMLDivElement;
    this.icon = this.shadow.querySelector(".mia-cursor") as HTMLDivElement;
    this.iconInner = this.shadow.querySelector(".mia-cursor-inner") as HTMLDivElement;
    this.iconImg = this.shadow.querySelector(".mia-cursor-img") as HTMLImageElement;
    this.shimmer = this.shadow.querySelector(".mia-shimmer") as HTMLDivElement;
    this.bubble = this.shadow.querySelector(".mia-bubble") as HTMLDivElement;
    this.bubbleText = this.shadow.querySelector(".mia-bubble-text") as HTMLDivElement;
    this.navBubble = this.shadow.querySelector(".mia-nav-bubble") as HTMLDivElement;
    this.navBubbleText = this.shadow.querySelector(".mia-nav-bubble-text") as HTMLDivElement;
    this.bars = Array.from(this.shadow.querySelectorAll(".mia-listening-bar")) as HTMLDivElement[];

    this.reducedMotion = prefersReducedMotion();
    this.root.toggleAttribute("data-reduced-motion", this.reducedMotion);
    this.applyTheme();
    this.setBubbleMaxWidth(this.bubbleMaxWidth);
    this.setState(this.state);
    this.attachListeners();
    this.startRenderLoop();
  }

  destroy(): void {
    this.detachListeners();
    this.stopRenderLoop();
    this.clearTimers();
    this.host?.remove();
    this.host = null;
    this.shadow = null;
    this.root = null;
    this.icon = null;
    this.iconInner = null;
    this.iconImg = null;
    this.shimmer = null;
    this.bubble = null;
    this.bubbleText = null;
    this.navBubble = null;
    this.navBubbleText = null;
    this.bars = [];
  }

  setState(state: MiaCursorState): void {
    this.state = state;
    this.root?.setAttribute("data-state", state);
    this.syncStateTargets();
  }

  setTheme(theme?: MiaTheme): void {
    if (!theme) return;
    this.theme = theme;
    this.applyTheme();
  }

  setCursorIcon(url?: string): void {
    if (!this.iconImg || !this.iconInner) return;
    if (url) {
      this.iconImg.src = url;
      this.iconImg.style.display = "block";
      this.iconInner.style.display = "none";
      if (this.shimmer) this.shimmer.style.display = "none";
    } else {
      this.iconImg.removeAttribute("src");
      this.iconImg.style.display = "none";
      this.iconInner.style.display = "block";
      if (this.shimmer) this.shimmer.style.display = "block";
    }
  }

  setOffset(offset?: CursorOffset): void {
    if (offset) this.offset = offset;
  }

  setBubbleMaxWidth(px?: number): void {
    if (!px) return;
    this.bubbleMaxWidth = px;
    this.root?.style.setProperty("--mia-bubble-max-width", `${px}px`);
  }

  setBubbleLingerMs(ms?: number): void {
    if (ms) this.bubbleLingerMs = ms;
  }

  setListeningLevel(level: number): void {
    this.listeningLevelTarget = clamp(level, 0, 1);
  }

  setSpeakingLevel(level: number): void {
    this.speakingLevelTarget = clamp(level, 0, 1);
  }

  setBubbleText(text: string): void {
    if (!this.bubbleText) return;
    this.clearTypewriter();
    this.showBubble();
    this.bubbleQueue = text || "";
    this.bubbleText.textContent = "";
    if (this.reducedMotion) {
      this.bubbleText.textContent = this.bubbleQueue;
      this.bubbleQueue = "";
      return;
    }
    this.startTypewriter();
  }

  appendBubbleText(delta: string): void {
    if (!delta || !this.bubbleText) return;
    this.showBubble();
    if (this.reducedMotion) {
      this.bubbleText.textContent = (this.bubbleText.textContent || "") + delta;
      return;
    }
    this.bubbleQueue += delta;
    this.startTypewriter();
  }

  resetBubble(): void {
    this.clearTypewriter();
    this.clearFadeTimers();
    this.bubbleQueue = "";
    if (this.bubbleText) this.bubbleText.textContent = "";
    this.bubble?.removeAttribute("data-visible");
    this.bubble?.removeAttribute("data-fade");
  }

  startBubbleFade(): number {
    if (!this.bubble) return 0;
    this.clearFadeTimers();
    this.setState("fading");
    this.fadeTimer = window.setTimeout(() => {
      this.bubble?.setAttribute("data-fade", "true");
    }, this.bubbleLingerMs);
    this.hideTimer = window.setTimeout(() => this.resetBubble(), this.bubbleLingerMs + this.fadeDurationMs);
    return this.bubbleLingerMs + this.fadeDurationMs;
  }

  navigateTo(targetX: number, targetY: number, label?: string): void {
    const x = clamp(targetX, 8, Math.max(8, window.innerWidth - 8));
    const y = clamp(targetY, 8, Math.max(8, window.innerHeight - 8));
    this.navTarget = {
      x,
      y,
      label: (label || "target").trim().slice(0, 40) || "target"
    };
    this.isReturningToCursor = false;
    this.navBubbleOpacityTarget = 0;
    this.navBubbleScaleTarget = 0.9;
    if (this.navBubbleText) this.navBubbleText.textContent = this.navTarget.label;
    this.setNavMode("navigatingToTarget");
  }

  returnToCursor(): void {
    if (this.navMode === "followingCursor" && !this.navTarget) return;
    this.isReturningToCursor = true;
    this.navTarget = null;
    this.navBubbleOpacityTarget = 0;
    this.navBubbleScaleTarget = 0.9;
    this.setNavMode("returningToCursor");
  }

  cancelNavigation(): void {
    this.navTarget = null;
    this.isReturningToCursor = false;
    this.navBubbleOpacityTarget = 0;
    this.navBubbleScaleTarget = 0.9;
    this.setNavMode("followingCursor");
  }

  hideForCapture(): void {
    if (this.root) this.root.style.visibility = "hidden";
  }

  showAfterCapture(): void {
    if (this.root) this.root.style.visibility = "visible";
  }

  private showBubble(): void {
    if (!this.bubble) return;
    this.bubble.setAttribute("data-visible", "true");
    this.bubble.removeAttribute("data-fade");
  }

  private startTypewriter(): void {
    if (this.typeTimer) return;
    this.typewriterLastTs = performance.now();
    this.typeTimer = window.setInterval(() => {
      if (!this.bubbleText) return;
      if (!this.bubbleQueue.length) {
        this.clearTypewriter();
        return;
      }
      const now = performance.now();
      const dt = clamp((now - this.typewriterLastTs) / 1000, 0.01, 0.2);
      this.typewriterLastTs = now;
      const budget = this.typewriterCarry + dt * this.typewriterCharsPerSecond;
      const count = Math.floor(budget);
      this.typewriterCarry = budget - count;
      if (count <= 0) return;
      const chunk = this.bubbleQueue.slice(0, count);
      this.bubbleQueue = this.bubbleQueue.slice(count);
      this.bubbleText.textContent = (this.bubbleText.textContent || "") + chunk;
    }, 33);
  }

  private clearTypewriter(): void {
    if (this.typeTimer) window.clearInterval(this.typeTimer);
    this.typeTimer = null;
    this.typewriterCarry = 0;
    this.typewriterLastTs = 0;
  }

  private clearTimers(): void {
    this.clearTypewriter();
    this.clearFadeTimers();
  }

  private clearFadeTimers(): void {
    if (this.fadeTimer) window.clearTimeout(this.fadeTimer);
    if (this.hideTimer) window.clearTimeout(this.hideTimer);
    this.fadeTimer = null;
    this.hideTimer = null;
  }

  private attachListeners(): void {
    document.addEventListener("mousemove", this.onMouseMove, true);
    window.addEventListener("resize", this.onResize);
  }

  private detachListeners(): void {
    document.removeEventListener("mousemove", this.onMouseMove, true);
    window.removeEventListener("resize", this.onResize);
  }

  private readonly onMouseMove = (event: MouseEvent): void => {
    this.cursor.x = event.clientX;
    this.cursor.y = event.clientY;
    if (!this.cursorInitialized) {
      const tx = this.cursor.x + this.offset.x;
      const ty = this.cursor.y + this.offset.y;
      this.iconPos.x = tx;
      this.iconPos.y = ty;
      this.bubblePos.x = tx + 28;
      this.bubblePos.y = ty + 28;
      this.navBubblePos.x = tx + 12;
      this.navBubblePos.y = ty + 12;
    }
    this.cursorInitialized = true;
  };

  private readonly onResize = (): void => {
    if (!this.cursorInitialized) return;
    this.cursor.x = clamp(this.cursor.x, 0, window.innerWidth);
    this.cursor.y = clamp(this.cursor.y, 0, window.innerHeight);
    if (this.navTarget) {
      this.navTarget.x = clamp(this.navTarget.x, 8, Math.max(8, window.innerWidth - 8));
      this.navTarget.y = clamp(this.navTarget.y, 8, Math.max(8, window.innerHeight - 8));
    }
  };

  private startRenderLoop(): void {
    if (this.renderRaf) return;
    this.lastFrameTs = performance.now();
    this.renderRaf = requestAnimationFrame(this.onRenderFrame);
  }

  private stopRenderLoop(): void {
    if (this.renderRaf) cancelAnimationFrame(this.renderRaf);
    this.renderRaf = null;
  }

  private readonly onRenderFrame = (ts: number): void => {
    const dt = clamp((ts - this.lastFrameTs) / 1000, 0.001, 0.05);
    this.lastFrameTs = ts;
    this.render(dt, ts / 1000);
    this.renderRaf = requestAnimationFrame(this.onRenderFrame);
  };

  private render(dt: number, timeSec: number): void {
    if (!this.root || !this.icon) return;
    this.updateMotion(dt);
    this.updateVisualDynamics(dt, timeSec);
    this.updateIconPosition();
    this.updateBubblePosition(dt);
    this.updateNavigationBubble(dt);
    this.updateWaveBars(timeSec);
  }

  private updateMotion(dt: number): void {
    const cursorTx = this.cursorInitialized ? this.cursor.x + this.offset.x : window.innerWidth * 0.5;
    const cursorTy = this.cursorInitialized ? this.cursor.y + this.offset.y : window.innerHeight * 0.5;
    const targetX = this.navMode !== "followingCursor" && !this.isReturningToCursor && this.navTarget ? this.navTarget.x : cursorTx;
    const targetY = this.navMode !== "followingCursor" && !this.isReturningToCursor && this.navTarget ? this.navTarget.y : cursorTy;

    const prevX = this.iconPos.x;
    const prevY = this.iconPos.y;
    const followRate = this.navMode === "navigatingToTarget" ? 10 : this.navMode === "pointingAtTarget" ? 13 : this.navMode === "returningToCursor" ? 14 : 17;
    this.iconPos.x = expLerp(this.iconPos.x, targetX, followRate, dt);
    this.iconPos.y = expLerp(this.iconPos.y, targetY, followRate, dt);
    this.vel.x = (this.iconPos.x - prevX) / dt;
    this.vel.y = (this.iconPos.y - prevY) / dt;
    const speed = Math.hypot(this.vel.x, this.vel.y);

    if (speed > 8) this.rotationTarget = (Math.atan2(this.vel.y, this.vel.x) * 180) / Math.PI;
    this.flightScaleTarget = 1 + clamp(speed / 2200, 0, 0.22);
    if (this.navMode === "navigatingToTarget" || this.navMode === "returningToCursor") this.flightScaleTarget += 0.04;
    if (this.navMode === "pointingAtTarget") this.flightScaleTarget += 0.03;

    const distanceToTarget = Math.hypot(targetX - this.iconPos.x, targetY - this.iconPos.y);
    if (this.navMode === "navigatingToTarget" && distanceToTarget < 9) {
      if (this.isReturningToCursor) {
        this.isReturningToCursor = false;
        this.setNavMode("followingCursor");
      } else {
        this.setNavMode("pointingAtTarget");
      }
    }
    if (this.navMode === "returningToCursor" && distanceToTarget < 9) {
      this.isReturningToCursor = false;
      this.setNavMode("followingCursor");
    }
  }

  private updateVisualDynamics(dt: number, timeSec: number): void {
    if (!this.root) return;
    this.rotationDeg = expLerpAngle(this.rotationDeg, this.rotationTarget, 18, dt);
    this.flightScale = expLerp(this.flightScale, this.flightScaleTarget, 12, dt);
    this.cursorOpacity = expLerp(this.cursorOpacity, this.cursorOpacityTarget, 10, dt);
    this.listeningLevel = expLerp(this.listeningLevel, this.listeningLevelTarget, 10, dt);
    this.speakingLevel = expLerp(this.speakingLevel, this.speakingLevelTarget, 10, dt);

    const voiceEnergy = this.state === "listening" ? this.listeningLevel : this.state === "speaking" ? this.speakingLevel : 0;
    this.energy = expLerp(this.energy, voiceEnergy, 10, dt);
    const shimmerSpeed = this.navMode === "navigatingToTarget" || this.navMode === "returningToCursor" ? 200 : this.state === "thinking" || this.state === "connecting" ? 180 : this.state === "speaking" ? 120 : 80;
    this.shimmerTurnTarget = (this.shimmerTurnTarget + shimmerSpeed * dt) % 360;
    this.shimmerTurnDeg = expLerpAngle(this.shimmerTurnDeg, this.shimmerTurnTarget, 8, dt);

    const shouldShowNavBubble = this.navMode === "pointingAtTarget" && !!this.navTarget?.label;
    this.navBubbleOpacityTarget = shouldShowNavBubble ? 1 : 0;
    this.navBubbleScaleTarget = shouldShowNavBubble ? 1 : 0.9;
    this.navBubbleOpacity = expLerp(this.navBubbleOpacity, this.navBubbleOpacityTarget, 14, dt);
    this.navBubbleScale = expLerp(this.navBubbleScale, this.navBubbleScaleTarget, 14, dt);

    this.root.style.setProperty("--mia-triangle-rotation", `${this.rotationDeg.toFixed(2)}deg`);
    this.root.style.setProperty("--mia-flight-scale", this.flightScale.toFixed(3));
    this.root.style.setProperty("--mia-cursor-opacity", this.cursorOpacity.toFixed(3));
    this.root.style.setProperty("--mia-energy", this.energy.toFixed(3));
    this.root.style.setProperty("--mia-shimmer-turn", `${this.shimmerTurnDeg.toFixed(2)}deg`);
    this.root.style.setProperty("--mia-shimmer-t", (0.5 + Math.sin(timeSec * 3.6) * 0.5).toFixed(3));
    this.root.style.setProperty("--mia-nav-bubble-opacity", this.navBubbleOpacity.toFixed(3));
    this.root.style.setProperty("--mia-nav-bubble-scale", this.navBubbleScale.toFixed(3));
  }

  private updateIconPosition(): void {
    this.icon?.style.setProperty("transform", `translate3d(${this.iconPos.x.toFixed(2)}px, ${this.iconPos.y.toFixed(2)}px, 0)`);
  }

  private updateBubblePosition(dt: number): void {
    if (!this.bubble || !this.bubble.hasAttribute("data-visible")) return;
    const margin = 12;
    const rect = this.bubble.getBoundingClientRect();
    let tx = this.iconPos.x + 28;
    let ty = this.iconPos.y + 30;
    if (tx + rect.width + margin > window.innerWidth) tx = this.iconPos.x - rect.width - 18;
    if (ty + rect.height + margin > window.innerHeight) ty = this.iconPos.y - rect.height - 18;
    tx = clamp(tx, margin, window.innerWidth - rect.width - margin);
    ty = clamp(ty, margin, window.innerHeight - rect.height - margin);
    this.bubblePos.x = expLerp(this.bubblePos.x, tx, 20, dt);
    this.bubblePos.y = expLerp(this.bubblePos.y, ty, 20, dt);
    this.bubble.style.transform = `translate3d(${this.bubblePos.x.toFixed(2)}px, ${this.bubblePos.y.toFixed(2)}px, 0)`;
  }

  private updateNavigationBubble(dt: number): void {
    if (!this.navBubble) return;
    const anchorX = this.navTarget?.x ?? this.iconPos.x;
    const anchorY = this.navTarget?.y ?? this.iconPos.y;
    const rect = this.navBubble.getBoundingClientRect();
    const margin = 10;
    let tx = anchorX + 14;
    let ty = anchorY + 12;
    if (tx + rect.width + margin > window.innerWidth) tx = anchorX - rect.width - 14;
    if (ty + rect.height + margin > window.innerHeight) ty = anchorY - rect.height - 12;
    tx = clamp(tx, margin, window.innerWidth - rect.width - margin);
    ty = clamp(ty, margin, window.innerHeight - rect.height - margin);
    this.navBubblePos.x = expLerp(this.navBubblePos.x, tx, 20, dt);
    this.navBubblePos.y = expLerp(this.navBubblePos.y, ty, 20, dt);
    this.navBubble.style.transform = `translate3d(${this.navBubblePos.x.toFixed(2)}px, ${this.navBubblePos.y.toFixed(2)}px, 0) scale(${this.navBubbleScale.toFixed(3)})`;
    this.navBubble.style.opacity = this.navBubbleOpacity.toFixed(3);
    this.navBubble.style.visibility = this.navBubbleOpacity > 0.02 ? "visible" : "hidden";
  }

  private updateWaveBars(timeSec: number): void {
    if (!this.bars.length) return;
    const active = this.state === "listening" ? this.listeningLevel : this.state === "speaking" ? this.speakingLevel : 0;
    const floor = active > 0.02 ? 0.2 : 0.06;
    for (let i = 0; i < this.bars.length; i += 1) {
      const phase = timeSec * (8.5 + i * 0.35) + i * 0.72;
      const wave = 0.5 + 0.5 * Math.sin(phase);
      const level = clamp(floor + active * (0.25 + wave * 0.75), 0.08, 1);
      this.bars[i]!.style.transform = `scaleY(${level.toFixed(3)})`;
    }
  }

  private syncStateTargets(): void {
    switch (this.state) {
      case "idle":
        this.cursorOpacityTarget = 0.55;
        this.listeningLevelTarget = 0;
        this.speakingLevelTarget = 0;
        break;
      case "connecting":
      case "thinking":
      case "guiding":
        this.cursorOpacityTarget = 0.95;
        this.listeningLevelTarget = 0;
        this.speakingLevelTarget = 0;
        break;
      case "listening":
        this.cursorOpacityTarget = 1;
        this.speakingLevelTarget = 0;
        break;
      case "speaking":
        this.cursorOpacityTarget = 1;
        this.listeningLevelTarget = 0;
        break;
      case "fading":
        this.cursorOpacityTarget = 0.62;
        this.listeningLevelTarget = 0;
        this.speakingLevelTarget = 0;
        break;
      case "offline":
      case "error":
        this.cursorOpacityTarget = 0.9;
        this.listeningLevelTarget = 0;
        this.speakingLevelTarget = 0;
        break;
    }
  }

  private setNavMode(mode: CursorNavMode): void {
    if (this.navMode === mode) return;
    this.navMode = mode;
    this.root?.setAttribute("data-nav-mode", mode);
  }

  private applyTheme(): void {
    if (!this.host) return;
    let theme = this.theme;
    if (theme === "auto") theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    this.host.setAttribute("data-theme", theme);
  }

  private template(): string {
    return `
      <style>${MIA_SHADOW_CURSOR_STYLES}</style>
      <div class="mia-root" data-state="idle" data-nav-mode="followingCursor">
        <div class="mia-cursor">
          <div class="mia-cursor-inner"></div>
          <img class="mia-cursor-img" alt="" />
          <div class="mia-shimmer"></div>
          <div class="mia-ring"></div>
          <div class="mia-spinner"></div>
          <div class="mia-wave"></div>
          <div class="mia-listening-bars" aria-hidden="true">
            <div class="mia-listening-bar"></div>
            <div class="mia-listening-bar"></div>
            <div class="mia-listening-bar"></div>
            <div class="mia-listening-bar"></div>
            <div class="mia-listening-bar"></div>
          </div>
        </div>
        <div class="mia-bubble"><div class="mia-bubble-text"></div></div>
        <div class="mia-nav-bubble" aria-hidden="true"><div class="mia-nav-bubble-text"></div></div>
      </div>
    `;
  }
}

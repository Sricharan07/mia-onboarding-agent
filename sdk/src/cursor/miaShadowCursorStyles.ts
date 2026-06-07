export const MIA_SHADOW_CURSOR_STYLES = `
:host {
  all: initial;
}

:host([data-theme="dark"]) {
  --mia-bg: rgba(11, 18, 32, 0.78);
  --mia-border: rgba(148, 163, 184, 0.18);
  --mia-text: #e5e7eb;
  --mia-accent: #49c8ff;
  --mia-accent-2: #3f82ff;
  --mia-accent-soft: rgba(73, 200, 255, 0.36);
  --mia-glow: rgba(73, 200, 255, 0.44);
  --mia-shadow: rgba(0, 0, 0, 0.42);
}

:host([data-theme="light"]) {
  --mia-bg: rgba(255, 255, 255, 0.88);
  --mia-border: rgba(15, 23, 42, 0.14);
  --mia-text: #0f172a;
  --mia-accent: #2f8bff;
  --mia-accent-2: #2558db;
  --mia-accent-soft: rgba(37, 99, 235, 0.3);
  --mia-glow: rgba(37, 99, 235, 0.38);
  --mia-shadow: rgba(15, 23, 42, 0.18);
}

.mia-root {
  --mia-triangle-rotation: 0deg;
  --mia-flight-scale: 1;
  --mia-cursor-opacity: 0.55;
  --mia-energy: 0;
  --mia-shimmer-turn: 0deg;
  --mia-shimmer-t: 0.5;
  --mia-nav-bubble-opacity: 0;
  --mia-nav-bubble-scale: 0.9;
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 2147483647;
  font-family: "IBM Plex Sans", "Inter", system-ui, sans-serif;
  contain: layout style paint;
}

.mia-cursor {
  position: fixed;
  width: 28px;
  height: 28px;
  transform: translate3d(0, 0, 0);
  opacity: var(--mia-cursor-opacity);
  transition: opacity 0.16s ease, filter 0.2s ease;
  will-change: transform, opacity, filter;
}

.mia-cursor::before,
.mia-cursor::after {
  content: "";
  position: absolute;
  inset: -13px;
  border-radius: 999px;
  opacity: 0;
  pointer-events: none;
}

.mia-cursor::before {
  background: radial-gradient(circle, var(--mia-accent-soft) 0%, rgba(56, 189, 248, 0) 70%);
  filter: blur(7px) saturate(1.15);
}

.mia-cursor::after {
  inset: -18px;
  border: 1px solid rgba(125, 211, 252, 0.45);
  box-shadow: 0 0 24px rgba(56, 189, 248, 0.26);
  transform: scale(0.85);
}

.mia-cursor-inner {
  position: absolute;
  inset: 0;
  display: block;
  overflow: hidden;
  width: 100%;
  height: 100%;
  clip-path: polygon(12% 9%, 89% 50%, 12% 92%, 33% 52%);
  background: linear-gradient(155deg, #80edff 0%, var(--mia-accent) 40%, var(--mia-accent-2) 100%);
  border: 1px solid rgba(186, 230, 253, 0.8);
  transform: rotate(var(--mia-triangle-rotation)) scale(var(--mia-flight-scale));
  transform-origin: 40% 50%;
  filter: drop-shadow(0 3px 11px rgba(37, 99, 235, 0.56));
  transition: transform 0.14s linear, opacity 0.14s ease, filter 0.16s ease;
  will-change: transform, opacity, filter;
}

.mia-cursor-inner::after {
  content: "";
  position: absolute;
  inset: 3px 5px 8px 5px;
  clip-path: polygon(14% 12%, 100% 50%, 14% 88%, 34% 52%);
  background: linear-gradient(160deg, rgba(255, 255, 255, 0.9), rgba(147, 197, 253, 0.2));
  opacity: 0.75;
  mix-blend-mode: screen;
}

.mia-cursor-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  border-radius: 8px;
  transform: rotate(var(--mia-triangle-rotation)) scale(var(--mia-flight-scale));
  transform-origin: 40% 50%;
  display: none;
  will-change: transform;
}

.mia-shimmer {
  position: absolute;
  inset: -10px;
  border-radius: 50%;
  background: conic-gradient(
    from 0deg,
    rgba(56, 189, 248, 0) 0deg,
    rgba(125, 211, 252, 0.92) 65deg,
    rgba(56, 189, 248, 0.04) 185deg,
    rgba(56, 189, 248, 0.52) 300deg,
    rgba(56, 189, 248, 0) 360deg
  );
  transform: rotate(var(--mia-shimmer-turn));
  opacity: calc(0.22 + var(--mia-shimmer-t) * 0.42);
  filter: blur(5px) saturate(1.18);
  mask: radial-gradient(circle, transparent 48%, #000 64%, transparent 80%);
  pointer-events: none;
  transition: opacity 0.18s ease;
}

.mia-ring {
  position: absolute;
  inset: -9px;
  border-radius: 50%;
  border: 1.5px solid rgba(125, 211, 252, 0.85);
  opacity: 0;
  box-shadow: 0 0 24px var(--mia-glow), inset 0 0 14px rgba(56, 189, 248, 0.25);
  transform: scale(calc(0.9 + var(--mia-energy) * 0.35));
  transition: opacity 0.16s ease;
}

.mia-spinner {
  position: absolute;
  inset: -11px;
  border-radius: 50%;
  border: 2px solid transparent;
  border-top-color: rgba(125, 211, 252, 0.95);
  border-right-color: rgba(96, 165, 250, 0.9);
  border-left-color: rgba(14, 165, 233, 0.38);
  opacity: 0;
  box-shadow: inset 0 0 16px rgba(56, 189, 248, 0.2), 0 0 12px rgba(56, 189, 248, 0.2);
  animation: mia-spin 0.9s linear infinite;
  transition: opacity 0.14s ease;
}

.mia-wave {
  position: absolute;
  inset: -10px;
  border-radius: 50%;
  border: 1.5px dashed rgba(56, 189, 248, 0.88);
  opacity: 0;
  animation: mia-wave 0.9s ease-in-out infinite;
  transition: opacity 0.14s ease;
}

.mia-listening-bars {
  position: absolute;
  left: -2px;
  right: -2px;
  bottom: -9px;
  height: 8px;
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 2px;
  align-items: end;
  opacity: 0;
  transition: opacity 0.12s ease;
  pointer-events: none;
}

.mia-listening-bar {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(180deg, rgba(125, 211, 252, 0.95), rgba(37, 99, 235, 0.82));
  transform-origin: center bottom;
  transform: scaleY(0.08);
  box-shadow: 0 0 10px rgba(56, 189, 248, 0.45);
}

.mia-bubble {
  position: fixed;
  max-width: var(--mia-bubble-max-width, 320px);
  padding: 10px 12px;
  background: var(--mia-bg);
  color: var(--mia-text);
  border: 1px solid var(--mia-border);
  border-radius: 12px;
  backdrop-filter: blur(14px) saturate(1.08);
  box-shadow: 0 14px 36px var(--mia-shadow), 0 0 0 1px rgba(255, 255, 255, 0.06) inset;
  opacity: 0;
  transform: translate3d(0, 0, 0);
  transition: opacity 0.24s ease, transform 0.18s ease;
  pointer-events: none;
  font-size: 13px;
  line-height: 1.38;
  white-space: pre-wrap;
  will-change: transform, opacity;
}

.mia-bubble[data-visible="true"] {
  opacity: 1;
}

.mia-bubble[data-fade="true"] {
  opacity: 0;
  transition-duration: 3s;
}

.mia-nav-bubble {
  position: fixed;
  max-width: 180px;
  padding: 5px 8px;
  border-radius: 8px;
  border: 1px solid rgba(125, 211, 252, 0.42);
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.84), rgba(15, 23, 42, 0.7));
  color: #e2f2ff;
  box-shadow: 0 8px 20px rgba(2, 6, 23, 0.35), 0 0 0 1px rgba(125, 211, 252, 0.14) inset;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: 0.01em;
  opacity: var(--mia-nav-bubble-opacity);
  transform: translate3d(0, 0, 0) scale(var(--mia-nav-bubble-scale));
  transform-origin: 0 0;
  pointer-events: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  will-change: transform, opacity;
  visibility: hidden;
}

.mia-root[data-state="idle"] .mia-ring,
.mia-root[data-state="idle"] .mia-spinner,
.mia-root[data-state="idle"] .mia-wave,
.mia-root[data-state="idle"] .mia-listening-bars,
.mia-root[data-state="fading"] .mia-listening-bars {
  opacity: 0;
}

.mia-root[data-state="listening"] .mia-cursor::before,
.mia-root[data-state="connecting"] .mia-cursor::before,
.mia-root[data-state="guiding"] .mia-cursor::before,
.mia-root[data-state="thinking"] .mia-cursor::before,
.mia-root[data-state="speaking"] .mia-cursor::before {
  opacity: calc(0.45 + var(--mia-energy) * 0.28);
}

.mia-root[data-state="listening"] .mia-ring,
.mia-root[data-state="guiding"] .mia-ring {
  opacity: 1;
  animation: mia-ring-pulse 1.1s ease-in-out infinite;
}

.mia-root[data-state="connecting"] .mia-spinner,
.mia-root[data-state="thinking"] .mia-spinner {
  opacity: 1;
}

.mia-root[data-state="speaking"] .mia-wave {
  opacity: 1;
  animation: mia-wave 0.75s ease-in-out infinite;
}

.mia-root[data-state="listening"] .mia-listening-bars,
.mia-root[data-state="speaking"] .mia-listening-bars {
  opacity: 1;
}

.mia-root[data-state="offline"] .mia-cursor-inner,
.mia-root[data-state="error"] .mia-cursor-inner {
  background: linear-gradient(155deg, #fecaca 0%, #ef4444 44%, #b91c1c 100%);
  border-color: rgba(254, 226, 226, 0.9);
  filter: drop-shadow(0 3px 14px rgba(239, 68, 68, 0.66));
}

.mia-root[data-state="offline"] .mia-ring,
.mia-root[data-state="error"] .mia-ring {
  border-color: rgba(254, 202, 202, 0.8);
  box-shadow: 0 0 20px rgba(239, 68, 68, 0.45);
  opacity: 1;
  animation: mia-ring-pulse 0.9s ease-in-out infinite;
}

.mia-root[data-nav-mode="navigatingToTarget"] .mia-cursor::after,
.mia-root[data-nav-mode="returningToCursor"] .mia-cursor::after,
.mia-root[data-nav-mode="pointingAtTarget"] .mia-cursor::after {
  opacity: calc(0.34 + var(--mia-shimmer-t) * 0.24);
  animation: mia-nav-ping 1.05s ease-in-out infinite;
}

@keyframes mia-ring-pulse {
  0% { transform: scale(calc(0.86 + var(--mia-energy) * 0.1)); opacity: 0.54; }
  50% { transform: scale(calc(1.08 + var(--mia-energy) * 0.28)); opacity: 1; }
  100% { transform: scale(calc(0.86 + var(--mia-energy) * 0.1)); opacity: 0.54; }
}

@keyframes mia-spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

@keyframes mia-wave {
  0% { transform: scale(0.88); opacity: 0.35; }
  50% { transform: scale(calc(1.08 + var(--mia-energy) * 0.2)); opacity: 1; }
  100% { transform: scale(0.88); opacity: 0.35; }
}

@keyframes mia-nav-ping {
  0% { transform: scale(0.82); opacity: 0.15; }
  50% { transform: scale(1.1); opacity: 0.76; }
  100% { transform: scale(0.82); opacity: 0.15; }
}
`;

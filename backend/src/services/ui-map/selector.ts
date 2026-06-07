import { createId, nowIso } from "../../utils/id.js";
import type { UIElementRecord } from "../../schemas/domain.js";

export type RawElement = {
  tagName: string;
  role?: string;
  label?: string;
  text?: string;
  dataAiId?: string;
  testId?: string;
  dataSlot?: string;
  dataSidebar?: string;
  dataState?: string;
  id?: string;
  name?: string;
  placeholder?: string;
  ariaLabel?: string;
  inputType?: string;
  title?: string;
  href?: string;
  sectionName?: string;
  formName?: string;
  dialogName?: string;
  tableName?: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
};

export function buildUiElementRecord(input: {
  appId: string;
  uiMapVersionId: string;
  pageId: string;
  pageName: string;
  route: string;
  raw: RawElement;
  index: number;
  stateName?: string;
  stateReason?: string;
  discoveredBy?: UIElementRecord["discoveredBy"];
}): UIElementRecord {
  const selectorInfo = generateSelector(input.raw, input.index);
  const elementType = getElementType(input.raw);
  const label = input.raw.label ?? input.raw.ariaLabel ?? input.raw.placeholder ?? input.raw.title ?? input.raw.text ?? elementType;
  const elementId = input.raw.dataAiId ?? input.raw.testId ?? generateElementId(input.pageName, label, elementType);
  const quality = scoreSelector(selectorInfo.selectorType, selectorInfo.selector);
  const now = nowIso();
  const stateName = input.stateName ?? "default";
  const discoveredBy = input.discoveredBy ?? "route_scan";

  return {
    id: createId("el"),
    elementId,
    appId: input.appId,
    uiMapVersionId: input.uiMapVersionId,
    pageId: input.pageId,
    pageName: input.pageName,
    route: input.route,
    elementType,
    role: input.raw.role,
    label,
    visibleText: input.raw.text,
    accessibleName: input.raw.label,
    placeholder: input.raw.placeholder,
    ariaLabel: input.raw.ariaLabel,
    inputName: input.raw.name,
    inputType: input.raw.inputType,
    description: generateDescription(elementType, label, input.pageName, input.raw),
    selector: selectorInfo.selector,
    selectorType: selectorInfo.selectorType,
    fallbackSelectors: selectorInfo.fallbackSelectors,
    nearbyText: [input.raw.text, input.raw.sectionName, input.raw.formName, input.raw.dialogName, input.raw.tableName].filter(Boolean) as string[],
    boundingBox: input.raw.boundingBox,
    tags: deriveTags(label, input.pageName, stateName),
    selectorQuality: quality.quality,
    selectorWarnings: quality.warnings,
    stateName,
    stateReason: input.stateReason,
    discoveredBy,
    fingerprint: generateFingerprint(input.route, selectorInfo.selector, label, elementType),
    createdAt: now,
    updatedAt: now
  };
}

type SelectorCandidate = {
  selector: string;
  selectorType: UIElementRecord["selectorType"];
};

function generateSelector(raw: RawElement, index: number): { selector: string; selectorType: UIElementRecord["selectorType"]; fallbackSelectors: string[] } {
  const candidates = buildSelectorCandidates(raw);
  const positionalFallback = {
    selector: `${raw.tagName.toLowerCase()}:nth-of-type(${index + 1})`,
    selectorType: "css" as const
  };
  const [primary = positionalFallback, ...fallbackCandidates] = candidates.length ? candidates : [positionalFallback];

  return {
    selector: primary.selector,
    selectorType: primary.selectorType,
    fallbackSelectors: unique(fallbackCandidates.map((candidate) => candidate.selector))
  };
}

function buildSelectorCandidates(raw: RawElement): SelectorCandidate[] {
  const tag = raw.tagName.toLowerCase();
  const label = raw.label ?? raw.ariaLabel ?? raw.title ?? raw.text;
  const candidates: Array<SelectorCandidate | undefined> = [
    raw.dataAiId ? { selector: `[data-ai-id='${escapeCssValue(raw.dataAiId)}']`, selectorType: "data-ai-id" } : undefined,
    raw.testId ? { selector: `[data-testid='${escapeCssValue(raw.testId)}']`, selectorType: "data-testid" } : undefined,
    raw.dataSidebar && raw.dataSlot ? { selector: attrSelector({ "data-sidebar": raw.dataSidebar, "data-slot": raw.dataSlot }), selectorType: "css" } : undefined,
    raw.dataSlot && raw.ariaLabel ? { selector: attrSelector({ "data-slot": raw.dataSlot, "aria-label": raw.ariaLabel }), selectorType: "css" } : undefined,
    raw.dataSlot && raw.title ? { selector: attrSelector({ "data-slot": raw.dataSlot, title: raw.title }), selectorType: "css" } : undefined,
    raw.dataState && raw.ariaLabel ? { selector: attrSelector({ "data-state": raw.dataState, "aria-label": raw.ariaLabel }), selectorType: "css" } : undefined,
    raw.ariaLabel ? { selector: `[aria-label='${escapeCssValue(raw.ariaLabel)}']`, selectorType: "aria-label" } : undefined,
    raw.title ? { selector: `[title='${escapeCssValue(raw.title)}']`, selectorType: "css" } : undefined,
    raw.name ? { selector: `[name='${escapeCssValue(raw.name)}']`, selectorType: "name" } : undefined,
    raw.id ? { selector: `#${cssEscape(raw.id)}`, selectorType: "id" } : undefined,
    raw.placeholder ? { selector: `[placeholder='${escapeCssValue(raw.placeholder)}']`, selectorType: "placeholder" } : undefined,
    label && supportsTextSelector(tag, raw.role) ? { selector: `${tag}:has-text('${escapeCssValue(label)}')`, selectorType: "text" } : undefined
  ];

  return uniqueCandidates(candidates.filter(Boolean) as SelectorCandidate[]);
}

function scoreSelector(selectorType: UIElementRecord["selectorType"], selector: string): { quality: UIElementRecord["selectorQuality"]; warnings: string[] } {
  const warnings: string[] = [];
  const scoreByType: Record<UIElementRecord["selectorType"], number> = {
    "data-ai-id": 100,
    "data-testid": 90,
    "role-name": 75,
    "aria-label": 70,
    label: 65,
    name: 55,
    id: selector.includes(":") ? 30 : 50,
    placeholder: 40,
    text: 35,
    css: selector.includes("nth") ? 10 : 20,
    "dom-path": 5
  };
  const score = scoreSelectorValue(selectorType, selector, scoreByType[selectorType]);
  if (selector.includes(":nth-of-type") || selector.includes(":nth-child")) {
    warnings.push("Selector is positional and may break when layout changes.");
  }
  if (score < 45) warnings.push("Selector is brittle. Add data-ai-id, data-testid, aria-label, or stable data attributes.");
  return { quality: score >= 80 ? "strong" : score >= 45 ? "medium" : "weak", warnings };
}

function scoreSelectorValue(selectorType: UIElementRecord["selectorType"], selector: string, baseScore: number): number {
  if (selector.includes(":nth-of-type") || selector.includes(":nth-child")) return 10;
  if (selector.includes("[data-ai-id=")) return 100;
  if (selector.includes("[data-testid=")) return 90;
  if (selector.includes("[data-sidebar=") && selector.includes("[data-slot=")) return 85;
  if (selector.includes("[data-slot=") && (selector.includes("[aria-label=") || selector.includes("[title="))) return 80;
  if (selector.includes("[data-state=") && selector.includes("[aria-label=")) return 70;
  if (selectorType === "css" && selector.includes("[title=")) return 55;
  return baseScore;
}

function attrSelector(attrs: Record<string, string | undefined>): string {
  return Object.entries(attrs)
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([name, value]) => `[${name}='${escapeCssValue(value)}']`)
    .join("");
}

function supportsTextSelector(tag: string, role?: string): boolean {
  return ["button", "a", "summary"].includes(tag) || ["button", "link", "tab", "menuitem", "option"].includes(role ?? "");
}

function getElementType(raw: RawElement): UIElementRecord["elementType"] {
  const tag = raw.tagName.toLowerCase();
  const type = raw.inputType?.toLowerCase();
  if (tag === "button") return "button";
  if (tag === "a") return "link";
  if (tag === "textarea") return "textarea";
  if (tag === "select") return "select";
  if (raw.role === "combobox") return "select";
  if (tag === "input" && type === "checkbox") return "checkbox";
  if (tag === "input" && type === "radio") return "radio";
  if (tag === "input") return "input";
  if (raw.role === "tab") return "tab";
  if (raw.role === "menuitem") return "menuitem";
  return "other";
}

function generateDescription(type: string, label: string, pageName: string, raw: RawElement): string {
  const context = raw.dialogName
    ? `${raw.dialogName} dialog`
    : raw.formName
      ? `${raw.formName} form`
      : raw.tableName
        ? `${raw.tableName} table`
        : raw.sectionName
          ? `${raw.sectionName} section`
          : `${pageName} page`;

  if (type === "button") return `${label} button in ${context}.`;
  if (type === "input" || type === "textarea") return `${label} input field in ${context}.`;
  if (type === "select") return `${label} dropdown in ${context}.`;
  if (type === "link") return `${label} link in ${context}.`;
  return `${label} ${type} element in ${context}.`;
}

function generateElementId(pageName: string, label: string, type: string): string {
  return `${toSlug(pageName)}.${toSlug(label)}_${type}`;
}

function deriveTags(label: string, pageName: string, stateName: string): string[] {
  return Array.from(new Set([...toSlug(label).split("_"), toSlug(pageName), ...toSlug(stateName).split("_")])).filter(Boolean);
}

function toSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function escapeCssValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function cssEscape(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function generateFingerprint(route: string, selector: string, label: string, type: string): string {
  return toSlug([route, selector, label, type].join("|"));
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function uniqueCandidates(candidates: SelectorCandidate[]): SelectorCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.selector)) return false;
    seen.add(candidate.selector);
    return true;
  });
}

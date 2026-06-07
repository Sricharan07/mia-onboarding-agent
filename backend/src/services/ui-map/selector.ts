import { createId, nowIso } from "../../utils/id.js";
import type { UIElementRecord } from "../../schemas/domain.js";

export type RawElement = {
  tagName: string;
  role?: string;
  label?: string;
  text?: string;
  dataAiId?: string;
  testId?: string;
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

function generateSelector(raw: RawElement, index: number): { selector: string; selectorType: UIElementRecord["selectorType"]; fallbackSelectors: string[] } {
  const fallbacks = [
    raw.ariaLabel ? `[aria-label='${escapeCssValue(raw.ariaLabel)}']` : undefined,
    raw.name ? `[name='${escapeCssValue(raw.name)}']` : undefined,
    raw.id ? `#${cssEscape(raw.id)}` : undefined,
    raw.placeholder ? `[placeholder='${escapeCssValue(raw.placeholder)}']` : undefined
  ].filter(Boolean) as string[];

  if (raw.dataAiId) return { selector: `[data-ai-id='${escapeCssValue(raw.dataAiId)}']`, selectorType: "data-ai-id", fallbackSelectors: fallbacks };
  if (raw.testId) return { selector: `[data-testid='${escapeCssValue(raw.testId)}']`, selectorType: "data-testid", fallbackSelectors: fallbacks };
  if (raw.ariaLabel) return { selector: `[aria-label='${escapeCssValue(raw.ariaLabel)}']`, selectorType: "aria-label", fallbackSelectors: fallbacks };
  if (raw.name) return { selector: `[name='${escapeCssValue(raw.name)}']`, selectorType: "name", fallbackSelectors: fallbacks };
  if (raw.id) return { selector: `#${cssEscape(raw.id)}`, selectorType: "id", fallbackSelectors: fallbacks };
  if (raw.placeholder) return { selector: `[placeholder='${escapeCssValue(raw.placeholder)}']`, selectorType: "placeholder", fallbackSelectors: fallbacks };
  return { selector: `${raw.tagName.toLowerCase()}:nth-of-type(${index + 1})`, selectorType: "css", fallbackSelectors: fallbacks };
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
  const score = scoreByType[selectorType];
  if (score < 45) warnings.push("Selector is brittle. Add data-ai-id or data-testid.");
  return { quality: score >= 80 ? "strong" : score >= 45 ? "medium" : "weak", warnings };
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

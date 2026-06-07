import type { Page } from "playwright";
import type { AppConfig } from "../../config/env.js";
import { ConfigError } from "../../utils/errors.js";

export type UiScanAuthMode = "none" | "login_form";

export function resolveAuthMode(mode: UiScanAuthMode | undefined, config: AppConfig): UiScanAuthMode {
  return mode ?? config.UI_SCAN_AUTH_MODE;
}

export async function applyUiScanAuth(input: {
  page: Page;
  baseUrl: string;
  config: AppConfig;
  mode?: UiScanAuthMode;
}): Promise<void> {
  const mode = resolveAuthMode(input.mode, input.config);
  if (mode === "none") return;
  await loginWithForm(input.page, input.baseUrl, input.config);
}

async function loginWithForm(page: Page, baseUrl: string, config: AppConfig): Promise<void> {
  const missing = [
    "UI_SCAN_LOGIN_URL",
    "UI_SCAN_USERNAME",
    "UI_SCAN_PASSWORD",
    "UI_SCAN_USERNAME_SELECTOR",
    "UI_SCAN_PASSWORD_SELECTOR",
    "UI_SCAN_SUBMIT_SELECTOR"
  ].filter((key) => !config[key as keyof AppConfig]);

  if (missing.length > 0) {
    throw new ConfigError(`UI scan login_form auth is not configured. Missing: ${missing.join(", ")}.`);
  }

  const loginUrl = new URL(config.UI_SCAN_LOGIN_URL!, baseUrl).toString();
  await page.goto(loginUrl, { waitUntil: "networkidle" });
  await page.locator(config.UI_SCAN_USERNAME_SELECTOR!).fill(config.UI_SCAN_USERNAME!);
  await page.locator(config.UI_SCAN_PASSWORD_SELECTOR!).fill(config.UI_SCAN_PASSWORD!);
  await page.locator(config.UI_SCAN_SUBMIT_SELECTOR!).click();

  if (config.UI_SCAN_SUCCESS_URL_PATTERN) {
    await page.waitForURL((url) => url.toString().includes(config.UI_SCAN_SUCCESS_URL_PATTERN!), { timeout: 15000 });
  } else {
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
  }

  if (config.UI_SCAN_POST_LOGIN_WAIT_MS > 0) {
    await page.waitForTimeout(config.UI_SCAN_POST_LOGIN_WAIT_MS);
  }
}

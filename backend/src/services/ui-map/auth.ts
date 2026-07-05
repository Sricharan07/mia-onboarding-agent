import type { Page } from "playwright";
import type { AppConfig } from "../../config/env.js";
import { ConfigError } from "../../utils/errors.js";
import type { AppUiScanConfigWithSecrets } from "../../db/repositories.js";
import { assertSafeTargetUrl } from "../security/targetUrlPolicy.js";
import { gotoAndSettle } from "./navigation.js";

export type UiScanAuthMode = "none" | "login_form" | "manual";

export type UiScanAuthConfig = Partial<AppUiScanConfigWithSecrets> & {
  mode?: UiScanAuthMode;
};

export function resolveAuthMode(auth: UiScanAuthConfig | undefined, config: AppConfig): UiScanAuthMode {
  return auth?.mode ?? auth?.authMode ?? config.UI_SCAN_AUTH_MODE;
}

export async function applyUiScanAuth(input: {
  page: Page;
  baseUrl: string;
  config: AppConfig;
  auth?: UiScanAuthConfig;
}): Promise<void> {
  const mode = resolveAuthMode(input.auth, input.config);
  if (mode === "none" || mode === "manual") return;
  await loginWithForm(input.page, input.baseUrl, input.config, input.auth);
}

async function loginWithForm(page: Page, baseUrl: string, config: AppConfig, auth: UiScanAuthConfig | undefined): Promise<void> {
  const loginUrl = auth?.loginUrl || config.UI_SCAN_LOGIN_URL;
  const username = auth?.username || config.UI_SCAN_USERNAME;
  const password = auth?.password || config.UI_SCAN_PASSWORD;
  const usernameSelector = auth?.usernameSelector || config.UI_SCAN_USERNAME_SELECTOR;
  const passwordSelector = auth?.passwordSelector || config.UI_SCAN_PASSWORD_SELECTOR;
  const submitSelector = auth?.submitSelector || config.UI_SCAN_SUBMIT_SELECTOR;
  const successUrlPattern = auth?.successUrlPattern || config.UI_SCAN_SUCCESS_URL_PATTERN;
  const postLoginWaitMs = auth?.postLoginWaitMs ?? config.UI_SCAN_POST_LOGIN_WAIT_MS;
  const missing = Object.entries({
    loginUrl,
    username,
    password,
    usernameSelector,
    passwordSelector,
    submitSelector
  }).filter(([, value]) => !value).map(([key]) => key);

  if (missing.length > 0) {
    throw new ConfigError(`UI scan login_form auth is not configured. Missing: ${missing.join(", ")}.`);
  }

  const targetUrl = new URL(loginUrl!, baseUrl).toString();
  await assertSafeTargetUrl(targetUrl, config);
  await gotoAndSettle(page, targetUrl);
  await page.locator(usernameSelector!).fill(username!);
  await page.locator(passwordSelector!).fill(password!);
  await page.locator(submitSelector!).click();

  if (successUrlPattern) {
    await page.waitForURL((url) => url.toString().includes(successUrlPattern), { timeout: 15000 });
  } else {
    await page.waitForLoadState("load", { timeout: 15000 }).catch(() => undefined);
  }

  if (postLoginWaitMs > 0) {
    await page.waitForTimeout(postLoginWaitMs);
  }
}

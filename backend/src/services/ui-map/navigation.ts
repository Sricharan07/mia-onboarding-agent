import type { Page } from "playwright";

export async function gotoAndSettle(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForLoadState("load", { timeout: 10000 }).catch(() => undefined);
  await page.waitForTimeout(750);
}

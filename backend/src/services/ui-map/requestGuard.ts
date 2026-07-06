import type { BrowserContext } from "playwright";
import type { AppConfig } from "../../config/env.js";
import { assertSafeTargetUrl } from "../security/targetUrlPolicy.js";

export async function installUiScanRequestGuard(context: BrowserContext, config: AppConfig): Promise<void> {
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (!isNetworkUrl(url)) {
      await route.continue();
      return;
    }

    try {
      await assertSafeTargetUrl(url, config);
      await route.continue();
    } catch {
      await route.abort("blockedbyclient");
    }
  });
}

function isNetworkUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

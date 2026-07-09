import type { BrowserContext } from "playwright";
import type { AppConfig } from "../../config/env.js";
import { assertSafeTargetUrl } from "../security/targetUrlPolicy.js";
import type { UiScanNetworkPolicy } from "./networkPolicy.js";

export async function installUiScanRequestGuard(context: BrowserContext, config: AppConfig, policy: UiScanNetworkPolicy): Promise<void> {
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (!isNetworkUrl(url)) {
      await route.continue();
      return;
    }

    try {
      if (!isUiScanRequestAllowed(url, route.request().isNavigationRequest(), policy)) {
        await route.abort("blockedbyclient");
        return;
      }
      await assertSafeTargetUrl(url, config);
      await route.continue();
    } catch {
      await route.abort("blockedbyclient");
    }
  });
}

export function isUiScanRequestAllowed(rawUrl: string, isNavigation: boolean, policy: UiScanNetworkPolicy): boolean {
  try {
    const origin = new URL(rawUrl).origin;
    return (isNavigation ? policy.navigationOrigins : policy.resourceOrigins).has(origin);
  } catch {
    return false;
  }
}

function isNetworkUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

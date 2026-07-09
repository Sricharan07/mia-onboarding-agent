import { isIP } from "node:net";
import { chromium, type Browser } from "playwright";
import type { AppConfig } from "../../config/env.js";
import { ValidationAppError } from "../../utils/errors.js";
import { resolveSafeTargetUrl } from "../security/targetUrlPolicy.js";

export type UiScanNetworkPolicy = {
  navigationOrigins: ReadonlySet<string>;
  resourceOrigins: ReadonlySet<string>;
  hostResolverRules: string[];
};

export async function createUiScanNetworkPolicy(config: AppConfig, navigationUrls: Array<string | undefined>): Promise<UiScanNetworkPolicy> {
  const navigationOrigins = new Set<string>();
  for (const rawUrl of navigationUrls.filter((value): value is string => Boolean(value))) {
    navigationOrigins.add((await resolveSafeTargetUrl(rawUrl, config)).url.origin);
  }

  const resourceOrigins = new Set(navigationOrigins);
  for (const rawOrigin of splitOrigins(config.UI_SCAN_ALLOWED_RESOURCE_ORIGINS)) {
    const resolved = await resolveSafeTargetUrl(rawOrigin, config);
    if (resolved.url.toString() !== `${resolved.url.origin}/`) {
      throw new ValidationAppError("UI_SCAN_ALLOWED_RESOURCE_ORIGINS entries must contain origins only.", { origin: rawOrigin });
    }
    resourceOrigins.add(resolved.url.origin);
  }

  const addressByHostname = new Map<string, string>();
  for (const origin of resourceOrigins) {
    const resolved = await resolveSafeTargetUrl(origin, config);
    const hostname = resolved.url.hostname;
    if (isIP(hostname)) continue;
    addressByHostname.set(hostname, preferredAddress(resolved.addresses));
  }

  return {
    navigationOrigins,
    resourceOrigins,
    hostResolverRules: [...addressByHostname].map(([hostname, address]) => `MAP ${hostname} ${formatResolverAddress(address)}`)
  };
}

export async function launchUiScanBrowser(config: AppConfig, policy: UiScanNetworkPolicy, headless = config.UI_SCAN_HEADLESS): Promise<Browser> {
  const args = policy.hostResolverRules.length > 0
    ? [`--host-resolver-rules=${policy.hostResolverRules.join(",")}`]
    : undefined;
  return chromium.launch({ headless, args });
}

function splitOrigins(value: string | undefined): string[] {
  return (value ?? "").split(",").map((origin) => origin.trim()).filter(Boolean);
}

function preferredAddress(addresses: string[]): string {
  const ipv4 = addresses.find((address) => isIP(address) === 4);
  return ipv4 ?? addresses[0]!;
}

function formatResolverAddress(address: string): string {
  return isIP(address) === 6 ? `[${address}]` : address;
}

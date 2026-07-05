import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { AppConfig } from "../../config/env.js";
import { ValidationAppError } from "../../utils/errors.js";

export async function assertSafeTargetUrl(rawUrl: string, config: AppConfig): Promise<URL> {
  const url = parseHttpUrl(rawUrl);
  if (allowsPrivateNetworkTargets(config)) return url;

  const host = stripIpv6Brackets(url.hostname);
  const literalVersion = isIP(host);
  const addresses = literalVersion
    ? [{ address: host }]
    : await lookup(host, { all: true, verbatim: true });

  if (addresses.length === 0) {
    throw new ValidationAppError(`Target URL host did not resolve: ${host}`);
  }

  const blocked = addresses.find((address) => isPrivateOrReservedAddress(address.address));
  if (blocked) {
    throw new ValidationAppError(
      `Target URL resolves to a private or reserved network address: ${host}`,
      { host, address: blocked.address }
    );
  }

  return url;
}

export function resolveSameOriginRouteUrl(route: string, baseUrl: string): string {
  const base = parseHttpUrl(baseUrl);
  const target = new URL(route, base);
  if (target.origin !== base.origin) {
    throw new ValidationAppError("UI scan routes must stay on the configured app origin.", {
      baseOrigin: base.origin,
      targetOrigin: target.origin
    });
  }
  return target.toString();
}

export function isPrivateOrReservedAddress(address: string): boolean {
  const host = stripIpv6Brackets(address);
  const mappedIpv4 = host.match(/(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/i)?.[1];
  if (mappedIpv4) return isPrivateOrReservedIpv4(mappedIpv4);

  const version = isIP(host);
  if (version === 4) return isPrivateOrReservedIpv4(host);
  if (version === 6) return isPrivateOrReservedIpv6(host);
  return true;
}

function parseHttpUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ValidationAppError(`Target URL is not valid: ${rawUrl}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ValidationAppError("Target URL must use http or https.");
  }
  if (url.username || url.password) {
    throw new ValidationAppError("Target URL must not include embedded credentials.");
  }
  return url;
}

function allowsPrivateNetworkTargets(config: AppConfig): boolean {
  return config.UI_SCAN_ALLOW_PRIVATE_NETWORKS || config.NODE_ENV !== "production";
}

function isPrivateOrReservedIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function isPrivateOrReservedIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (/^fe[89ab]/.test(normalized)) return true;
  if (normalized.startsWith("ff")) return true;
  if (normalized.startsWith("2001:db8")) return true;
  return false;
}

function stripIpv6Brackets(value: string): string {
  return value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
}

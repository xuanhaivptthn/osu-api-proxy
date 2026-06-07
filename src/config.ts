// Upstream origin for all proxied requests.
export const OSU_ORIGIN = new URL("https://osu.ppy.sh");

// Allowed path prefixes that the proxy will forward.
export const ALLOWED_PREFIXES = ["/api/v2/", "/api/v2", "/oauth/token", "/api", "/api/"];

// Defaults for the simple in-memory rate limiter.
export const RATE_LIMIT = 5;
export const WINDOW_MS = 5_000;
export const QUEUE_TIMEOUT_MS = 60_000;

// Headers that should not be forwarded from the incoming request to the upstream.
export const STRIP_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "upgrade",
  "x-proxy-secret",
  "cf-connecting-ip",
  "cf-ray",
  "cf-visitor",
  "cf-ipcountry",
  "cf-worker",
  "cdn-loop",
  "x-forwarded-for",
  "x-forwarded-proto",
  "x-real-ip",
  "forwarded",
  "true-client-ip",
]);

// Response headers we intentionally strip from upstream responses.
export const STRIP_RESPONSE_HEADERS = new Set([
  "connection",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export interface Config {
  host: string;
  port: number;
  proxySecret?: string;
}

// Parse an environment-provided port value, with validation and fallback.
function parsePort(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    return fallback;
  }

  return parsed;
}

/**
 * Load runtime configuration from environment variables with sane defaults.
 */
export function loadConfig(): Config {
  const port = parsePort(process.env.PORT, 8787);
  const host = process.env.HOST ?? "0.0.0.0";

  return {
    host,
    port,
    proxySecret: process.env.PROXY_SECRET,
  };
}

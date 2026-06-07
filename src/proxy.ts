import { IncomingMessage, ServerResponse } from "node:http";
import {
  OSU_ORIGIN,
  ALLOWED_PREFIXES,
  STRIP_REQUEST_HEADERS,
  STRIP_RESPONSE_HEADERS,
  Config,
} from "./config";

type RateLimiter = { acquire(): Promise<boolean> };

/**
 * Handle an incoming HTTP request and forward it to osu.ppy.sh when allowed.
 *
 * The function performs basic routing (health check), authorization using an
 * optional shared secret, header sanitization, upstream rate limiting, and
 * response streaming back to the client.
 */
export async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  currentConfig: Config,
  limiter: RateLimiter,
): Promise<void> {
  try {
    // Parse incoming URL and basic metadata for logging.
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const path = requestUrl.pathname;
    const method = request.method ?? "GET";
    const clientIp = request.socket?.remoteAddress ?? "-";
    console.log(`[${new Date().toISOString()}] ${method} ${path} from ${clientIp}`);

    // Lightweight health and root endpoints.
    if (path === "/" || path === "/health") {
      respondJson(response, 200, {
        status: "ok",
        proxy: "osu-api-proxy",
        usage: "Replace https://osu.ppy.sh with this server's URL in your requests.",
      });
      return;
    }

    // Only allow forwarding of specific path prefixes for safety.
    if (!ALLOWED_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix + (prefix.endsWith("/") ? "" : "/")))) {
      respondJson(response, 404, {
        error: "This proxy only forwards /api/v2/*, /api/*, and /oauth/token.",
      });
      return;
    }

    // If a proxy secret is configured, require it either as a header or query param.
    if (currentConfig.proxySecret) {
      const providedSecret = headerValue(request, "x-proxy-secret") ?? requestUrl.searchParams.get("proxy_secret");
      if (providedSecret !== currentConfig.proxySecret) {
        respondJson(response, 401, { error: "Invalid or missing X-Proxy-Secret header." });
        return;
      }
    }

    // Remove secret from forwarded querystring so upstream never sees it.
    requestUrl.searchParams.delete("proxy_secret");
    const targetUrl = new URL(`${path}${requestUrl.search}`, OSU_ORIGIN);

    // Copy and sanitize request headers before proxying upstream.
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (typeof value === "undefined") continue;

      const normalizedKey = key.toLowerCase();
      if (STRIP_REQUEST_HEADERS.has(normalizedKey)) continue;

      if (Array.isArray(value)) {
        headers.set(key, value.join(", "));
      } else {
        headers.set(key, value);
      }
    }

    // We avoid spoofing Chrome because Node.js's TLS fingerprint will mismatch and cause Cloudflare to block it.
    // Instead, if the request comes from Google Apps Script, we change the UA to something allowed.
    const ua = headers.get("user-agent") || "";
    if (ua.includes("Google-Apps-Script")) {
      headers.set("user-agent", "osu-api-proxy/1.0");
    }

    // Read request body when present (non-GET/HEAD).
    const body = method === "GET" || method === "HEAD" ? undefined : await readBody(request);

    // Log forwarding details for debugging.
    console.log(`[proxy] ${clientIp} -> ${targetUrl} (${method}) headers=${Array.from(headers).length}`);

    // Respect the in-memory upstream rate limiter.
    const granted = await limiter.acquire();
    if (!granted) {
      console.warn(`[proxy] rate limiter denied request for ${clientIp} ${method} ${path}`);
      respondJson(response, 504, { error: "Request timed out waiting for upstream capacity" });
      return;
    }
    // Perform the fetch to osu's upstream and stream the response back.
    const fetchStart = Date.now();
    const upstream = await fetch(targetUrl, {
      method,
      headers,
      body,
      redirect: "follow",
    });

    const upstreamBody = upstream.body ? Buffer.from(await upstream.arrayBuffer()) : undefined;
    const duration = Date.now() - fetchStart;

    // Log upstream response summary.
    console.log(
      `[proxy] upstream ${upstream.status} ${upstream.statusText} (${duration}ms) for ${method} ${targetUrl} bytes=${upstreamBody?.byteLength ?? 0}`,
    );

    response.writeHead(
      upstream.status,
      upstream.statusText,
      headersToObject(upstream.headers, upstreamBody?.byteLength),
    );

    if (upstreamBody) {
      response.end(upstreamBody);
      return;
    }

    response.end();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[proxy] unexpected error handling ${request.method} ${request.url}:`, detail);
    respondJson(response, 502, { error: "Failed to reach osu.ppy.sh", detail });
  }
}

// Helper: get a request header value (first item when header is an array).
function headerValue(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  if (Array.isArray(value)) return value[0];
  return value;
}

// Helper: read the full request body into a Buffer.
async function readBody(request: IncomingMessage): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

// Convert Fetch `Headers` to a plain object suitable for `response.writeHead`.
function headersToObject(headers: Headers, bodyLength?: number): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of headers) {
    if (STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) continue;
    values[key] = value;
  }

  values.Connection = "close";
  if (typeof bodyLength === "number") values["Content-Length"] = String(bodyLength);

  return values;
}

// Send a small JSON response with correct headers.
function respondJson(response: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2);
  response.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

import http from "node:http";
import { Config, RATE_LIMIT, WINDOW_MS, QUEUE_TIMEOUT_MS } from "./config";
import { handleRequest } from "./proxy.js";

/**
 * Lightweight in-memory rate limiter for upstream requests.
 *
 * This class enforces a simple sliding-window limit and keeps a small
 * FIFO queue for requests that arrive while the window is full.
 */
interface QueueEntry {
  resolve: (granted: boolean) => void;
  timeout: ReturnType<typeof setTimeout>;
}

class UpstreamRateLimiter {
  private timestamps: number[] = [];
  private queue: QueueEntry[] = [];
  private drainTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * @param limit number of allowed requests per window
   * @param windowMs size of the sliding window in milliseconds
   * @param queueTimeoutMs how long queued requests wait before timing out
   */
  constructor(private readonly limit = 5, private readonly windowMs = 5_000, private readonly queueTimeoutMs = 60_000) {}

  /**
   * Acquire permission to perform an upstream request. Resolves `true` when
   * allowed, or `false` if the request timed out while waiting in the queue.
   */
  async acquire(): Promise<boolean> {
    this.pruneTimestamps();
    if (this.timestamps.length < this.limit) {
      this.timestamps.push(Date.now());
      console.debug(`[rate] immediate grant (window=${this.windowMs}ms limit=${this.limit})`);
      return true;
    }

    return new Promise<boolean>((resolve) => {
      const entry: QueueEntry = {
        timeout: setTimeout(() => {
          const index = this.queue.indexOf(entry);
          if (index !== -1) {
            this.queue.splice(index, 1);
            console.warn(`[rate] queued request timed out after ${this.queueTimeoutMs}ms`);
            resolve(false);
          }
        }, this.queueTimeoutMs),
        resolve,
      };
      this.queue.push(entry);
      console.log(`[rate] request queued (position=${this.queue.length})`);
      this.ensureDrainScheduled();
    });
  }

  // Remove timestamps outside the sliding window.
  private pruneTimestamps(): void {
    const cutoff = Date.now() - this.windowMs;
    this.timestamps = this.timestamps.filter((timestamp) => timestamp > cutoff);
  }

  // Ensure a timer is scheduled to wake the queue when the window moves.
  private ensureDrainScheduled(): void {
    if (this.drainTimer !== null || this.queue.length === 0) {
      return;
    }

    this.pruneTimestamps();
    if (this.timestamps.length < this.limit) {
      this.processQueue();
      return;
    }

    const waitMs = Math.max(10, this.timestamps[0] + this.windowMs - Date.now() + 10);
    this.drainTimer = setTimeout(() => {
      this.drainTimer = null;
      this.processQueue();
    }, waitMs);
  }

  // Grant queued requests until the window is full again.
  private processQueue(): void {
    this.pruneTimestamps();
    while (this.queue.length > 0 && this.timestamps.length < this.limit) {
      const entry = this.queue.shift();
      if (!entry) continue;

      clearTimeout(entry.timeout);
      this.timestamps.push(Date.now());
      console.log(`[rate] granting queued request (remainingQueue=${this.queue.length})`);
      entry.resolve(true);
    }

    this.ensureDrainScheduled();
  }
}

/**
 * Start an HTTP server that forwards allowed requests to osu.ppy.sh.
 * The server uses an in-memory rate limiter to avoid spamming the upstream.
 */
export async function start(config: Config): Promise<void> {
  const limiter = new UpstreamRateLimiter(RATE_LIMIT, WINDOW_MS, QUEUE_TIMEOUT_MS);
  console.log(
    `[rate] limiter configured: ${RATE_LIMIT} reqs / ${WINDOW_MS}ms, queue timeout ${QUEUE_TIMEOUT_MS}ms`,
  );

  const server = http.createServer((req, res) => {
    void handleRequest(req, res, config, limiter);
  });

  server.listen(config.port, config.host, () => {
    console.log(`osu-api-proxy listening on http://${config.host}:${config.port}`);
  });
}

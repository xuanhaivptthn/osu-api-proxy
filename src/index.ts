import { loadConfig } from "./config";
import { start } from "./server.js";

// Entry point for the proxy. Load runtime configuration and start the server.
const config = loadConfig();

// Log startup configuration (avoid printing secrets).
console.log(`Starting osu-api-proxy on ${config.host}:${config.port}`);

// Start the HTTP server. Any startup failure is fatal.
start(config).catch((err: unknown) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});

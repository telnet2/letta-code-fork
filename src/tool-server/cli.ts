#!/usr/bin/env bun
/**
 * Tool Server CLI - Start the tool server from command line
 */

import { createServer, loadConfig } from "./server";

async function main() {
  const args = process.argv.slice(2);

  // Parse CLI arguments
  const config: Record<string, unknown> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--port" || arg === "-p") {
      config.port = parseInt(args[++i], 10);
    } else if (arg === "--host" || arg === "-h") {
      config.host = args[++i];
    } else if (arg === "--data-dir" || arg === "-d") {
      config.dataDir = args[++i];
    } else if (arg === "--timeout") {
      config.sessionTimeoutDays = parseInt(args[++i], 10);
    } else if (arg === "--help") {
      printHelp();
      process.exit(0);
    } else if (arg === "--version") {
      console.log("tool-server v0.1.0");
      process.exit(0);
    }
  }

  // Load config with overrides
  const serverConfig = loadConfig(config);

  console.log("Starting tool server...");
  console.log(`  Data directory: ${serverConfig.dataDir}`);
  console.log(`  Session timeout: ${serverConfig.sessionTimeoutDays} days`);

  const server = await createServer(serverConfig);
  await server.start();

  console.log(`\nServer ready at ${server.getUrl()}`);
  console.log("\nEndpoints:");
  console.log(`  Health:    GET  ${server.getUrl()}/health`);
  console.log(`  Tools:     GET  ${server.getUrl()}/api/tools`);
  console.log(`  Sessions:  POST ${server.getUrl()}/api/sessions`);
  console.log("\nPress Ctrl+C to stop\n");

  // Handle shutdown
  process.on("SIGINT", async () => {
    console.log("\nShutting down...");
    await server.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await server.stop();
    process.exit(0);
  });
}

function printHelp() {
  console.log(`
Tool Server - Remote tool execution with session management

USAGE:
  bun run src/tool-server/cli.ts [OPTIONS]

OPTIONS:
  -p, --port <port>       Server port (default: 3000)
  -h, --host <host>       Server host (default: 0.0.0.0)
  -d, --data-dir <path>   Data directory (default: /tmp/tool-server)
  --timeout <days>        Session timeout in days (default: 3)
  --help                  Show this help message
  --version               Show version

ENVIRONMENT VARIABLES:
  TOOL_SERVER_PORT              Server port
  TOOL_SERVER_HOST              Server host
  TOOL_SERVER_DATA_DIR          Data directory
  TOOL_SERVER_SESSION_TIMEOUT_DAYS   Session timeout

EXAMPLES:
  # Start with defaults
  bun run src/tool-server/cli.ts

  # Start on custom port
  bun run src/tool-server/cli.ts --port 8080

  # Start with custom data directory
  bun run src/tool-server/cli.ts --data-dir ./data
`);
}

main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});

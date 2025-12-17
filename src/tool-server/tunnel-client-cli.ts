#!/usr/bin/env bun
/**
 * Tunnel Client CLI - Connect to a remote agent and serve tools locally
 *
 * This CLI starts a tunnel client that connects to a remote tunnel server,
 * allowing local tools to be executed by remote LLM agents.
 */

import { createTunnelClient } from "./tunnel/client";
import { generateClientId } from "./tunnel/auth";
import { toolRegistry } from "./tools/registry";

// Import built-in tools to register them
import "./tools/adapters";

async function main() {
  const args = process.argv.slice(2);

  // Parse CLI arguments
  let serverUrl = "";
  let token = "";
  let clientId = "";
  let workspaceRoot = process.cwd();
  let reconnect = true;
  let verbose = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--server" || arg === "-s") {
      serverUrl = args[++i];
    } else if (arg === "--token" || arg === "-t") {
      token = args[++i];
    } else if (arg === "--client-id" || arg === "-c") {
      clientId = args[++i];
    } else if (arg === "--workspace" || arg === "-w") {
      workspaceRoot = args[++i];
    } else if (arg === "--no-reconnect") {
      reconnect = false;
    } else if (arg === "--verbose" || arg === "-v") {
      verbose = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (arg === "--version") {
      console.log("tunnel-client v1.0.0");
      process.exit(0);
    } else if (arg === "--list-tools") {
      listTools();
      process.exit(0);
    }
  }

  // Validate required arguments
  if (!serverUrl) {
    serverUrl = process.env.TUNNEL_SERVER_URL ?? "";
  }
  if (!token) {
    token = process.env.TUNNEL_TOKEN ?? "";
  }
  if (!clientId) {
    clientId = process.env.TUNNEL_CLIENT_ID ?? generateClientId();
  }

  if (!serverUrl) {
    console.error("Error: Server URL is required");
    console.error("Use --server <url> or set TUNNEL_SERVER_URL environment variable");
    process.exit(1);
  }

  if (!token) {
    console.error("Error: Token is required");
    console.error("Use --token <token> or set TUNNEL_TOKEN environment variable");
    process.exit(1);
  }

  console.log("Starting tunnel client...");
  console.log(`  Server URL: ${serverUrl}`);
  console.log(`  Client ID: ${clientId}`);
  console.log(`  Workspace: ${workspaceRoot}`);
  console.log(`  Reconnect: ${reconnect}`);
  console.log(`  Available tools: ${toolRegistry.names().join(", ")}`);
  console.log("");

  const client = createTunnelClient({
    serverUrl,
    token,
    clientId,
    workspaceRoot,
    reconnect: {
      enabled: reconnect,
      maxAttempts: 10,
      initialDelayMs: 1000,
      maxDelayMs: 30000,
    },
  });

  // Set up event handlers
  client.on((event) => {
    switch (event.type) {
      case "connected":
        console.log(
          `✓ Connected to server (server: ${event.serverInfo.serverId}, version: ${event.serverInfo.version})`
        );
        console.log("  Waiting for tool calls...\n");
        break;

      case "disconnected":
        console.log(`✗ Disconnected: ${event.reason}`);
        break;

      case "reconnecting":
        console.log(`  Reconnecting (attempt ${event.attempt})...`);
        break;

      case "error":
        console.error(`✗ Error: ${event.error.message}`);
        break;

      case "tool_call_started":
        if (verbose) {
          console.log(`→ Tool call started: ${event.tool} (${event.callId})`);
        }
        break;

      case "tool_call_completed":
        if (verbose) {
          console.log(
            `← Tool call completed: ${event.tool} (${event.callId}) - ${event.durationMs}ms`
          );
        }
        break;
    }
  });

  // Connect to server
  try {
    await client.connect();
  } catch (error) {
    console.error(
      "Failed to connect:",
      error instanceof Error ? error.message : error
    );
    process.exit(1);
  }

  // Handle shutdown
  process.on("SIGINT", async () => {
    console.log("\nShutting down...");
    await client.disconnect();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await client.disconnect();
    process.exit(0);
  });

  // Keep the process running
  await new Promise(() => {});
}

function printHelp() {
  console.log(`
Tunnel Client - Connect to remote agent and serve tools locally

USAGE:
  bun run src/tool-server/tunnel-client-cli.ts [OPTIONS]

OPTIONS:
  -s, --server <url>       Tunnel server URL (required)
  -t, --token <token>      Authentication token (required)
  -c, --client-id <id>     Client identifier (auto-generated if not set)
  -w, --workspace <path>   Workspace root directory (default: current dir)
  --no-reconnect           Disable automatic reconnection
  -v, --verbose            Enable verbose logging
  --list-tools             List available tools and exit
  -h, --help               Show this help message
  --version                Show version

ENVIRONMENT VARIABLES:
  TUNNEL_SERVER_URL        Tunnel server URL
  TUNNEL_TOKEN             Authentication token
  TUNNEL_CLIENT_ID         Client identifier

EXAMPLES:
  # Connect to tunnel server
  bun run src/tool-server/tunnel-client-cli.ts \\
    --server ws://agent.example.com:3001/tunnel \\
    --token <your-token>

  # With custom workspace
  bun run src/tool-server/tunnel-client-cli.ts \\
    --server ws://localhost:3001/tunnel \\
    --token secret123 \\
    --workspace /home/user/myproject

  # Using environment variables
  TUNNEL_SERVER_URL=ws://localhost:3001/tunnel \\
  TUNNEL_TOKEN=secret123 \\
  bun run src/tool-server/tunnel-client-cli.ts
`);
}

function listTools() {
  console.log("Available tools:\n");
  for (const tool of toolRegistry.list()) {
    console.log(`  ${tool.name}`);
    console.log(`    ${tool.description}`);
    console.log("");
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

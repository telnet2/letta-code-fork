#!/usr/bin/env bun
/**
 * Tunnel Server CLI - Start a tunnel server for remote tool execution
 *
 * This CLI starts a tunnel server that accepts connections from tunnel clients,
 * enabling LLM agents to execute tools on remote machines.
 */

import { createTunnelServer, type TunnelServer, type ToolCallResult } from "./tunnel/server";
import {
  createTokenValidator,
  generateToken,
  generateSecret,
  generateClientId,
} from "./tunnel/auth";

let server: TunnelServer | null = null;

async function main() {
  const args = process.argv.slice(2);

  // Parse CLI arguments
  let port = 3001;
  let host = "0.0.0.0";
  let secret = "";
  let verbose = false;
  let generateTokenOnly = false;
  let tokenClientId = "";
  let tokenExpiry = 86400000; // 24 hours

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--port" || arg === "-p") {
      port = parseInt(args[++i], 10);
    } else if (arg === "--host" || arg === "-h") {
      host = args[++i];
    } else if (arg === "--secret" || arg === "-S") {
      secret = args[++i];
    } else if (arg === "--verbose" || arg === "-v") {
      verbose = true;
    } else if (arg === "--generate-token") {
      generateTokenOnly = true;
    } else if (arg === "--client-id") {
      tokenClientId = args[++i];
    } else if (arg === "--token-expiry") {
      tokenExpiry = parseInt(args[++i], 10) * 1000; // Convert seconds to ms
    } else if (arg === "--help") {
      printHelp();
      process.exit(0);
    } else if (arg === "--version") {
      console.log("tunnel-server v1.0.0");
      process.exit(0);
    }
  }

  // Get secret from env if not provided
  if (!secret) {
    secret = process.env.TUNNEL_SECRET ?? "";
  }

  // Generate token only mode
  if (generateTokenOnly) {
    if (!secret) {
      console.error("Error: Secret is required for token generation");
      console.error("Use --secret <secret> or set TUNNEL_SECRET environment variable");
      process.exit(1);
    }

    const clientId = tokenClientId || generateClientId();
    const token = generateToken(clientId, secret, tokenExpiry);

    console.log("\nGenerated token:\n");
    console.log(`  Client ID: ${clientId}`);
    console.log(`  Expires: ${new Date(Date.now() + tokenExpiry).toISOString()}`);
    console.log(`  Token: ${token}`);
    console.log("\nUse this token with the tunnel client:\n");
    console.log(
      `  bun run src/tool-server/tunnel-client-cli.ts --server ws://<host>:${port}/tunnel --token ${token}`
    );
    console.log("");
    process.exit(0);
  }

  // Generate secret if not provided
  if (!secret) {
    secret = generateSecret();
    console.log("Generated secret (save this for token generation):");
    console.log(`  ${secret}`);
    console.log("");
  }

  console.log("Starting tunnel server...");
  console.log(`  Host: ${host}`);
  console.log(`  Port: ${port}`);
  console.log(`  Verbose: ${verbose}`);
  console.log("");

  // Create server with token validation
  server = createTunnelServer({
    port,
    host,
    validateToken: createTokenValidator(secret),
  });

  // Set up event handlers
  server.on((event) => {
    switch (event.type) {
      case "client_connected":
        console.log(`✓ Client connected: ${event.clientId}`);
        console.log(`  Tools: ${event.clientInfo.tools.join(", ")}`);
        console.log("");
        break;

      case "client_disconnected":
        console.log(`✗ Client disconnected: ${event.clientId} (${event.reason})`);
        break;

      case "tool_call_request":
        if (verbose) {
          console.log(
            `→ Tool call: ${event.tool} on ${event.clientId} (${event.callId})`
          );
        }
        break;

      case "tool_call_response":
        if (verbose) {
          console.log(
            `← Tool response: ${event.callId} - ${event.status}`
          );
        }
        break;
    }
  });

  // Start server
  await server.start();

  console.log(`\nTunnel server ready at ws://${host}:${port}/tunnel`);
  console.log("\nEndpoints:");
  console.log(`  Tunnel:   ws://${host}:${port}/tunnel`);
  console.log(`  Health:   GET http://${host}:${port}/health`);
  console.log(`  Tools:    GET http://${host}:${port}/api/tools`);
  console.log(`  Clients:  GET http://${host}:${port}/api/clients`);
  console.log("\nGenerate tokens with:");
  console.log(`  bun run src/tool-server/tunnel-server-cli.ts --generate-token --secret ${secret}`);
  console.log("\nPress Ctrl+C to stop\n");

  // Handle shutdown
  process.on("SIGINT", async () => {
    console.log("\nShutting down...");
    if (server) {
      await server.stop();
    }
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    if (server) {
      await server.stop();
    }
    process.exit(0);
  });
}

function printHelp() {
  console.log(`
Tunnel Server - Accept connections from tunnel clients

USAGE:
  bun run src/tool-server/tunnel-server-cli.ts [OPTIONS]

OPTIONS:
  -p, --port <port>        Server port (default: 3001)
  -h, --host <host>        Server host (default: 0.0.0.0)
  -S, --secret <secret>    Authentication secret (auto-generated if not set)
  -v, --verbose            Enable verbose logging

TOKEN GENERATION:
  --generate-token         Generate a client token and exit
  --client-id <id>         Client ID for token (auto-generated if not set)
  --token-expiry <secs>    Token expiry in seconds (default: 86400)

  --help                   Show this help message
  --version                Show version

ENVIRONMENT VARIABLES:
  TUNNEL_SECRET            Authentication secret
  TUNNEL_SERVER_PORT       Server port
  TUNNEL_SERVER_HOST       Server host

EXAMPLES:
  # Start tunnel server (generates secret automatically)
  bun run src/tool-server/tunnel-server-cli.ts

  # Start with specific port and secret
  bun run src/tool-server/tunnel-server-cli.ts \\
    --port 8080 \\
    --secret my-secure-secret

  # Generate a token for a client
  bun run src/tool-server/tunnel-server-cli.ts \\
    --generate-token \\
    --secret my-secure-secret \\
    --client-id my-client

  # Generate token with 7 day expiry
  bun run src/tool-server/tunnel-server-cli.ts \\
    --generate-token \\
    --secret my-secure-secret \\
    --token-expiry 604800

INTEGRATION:
  The tunnel server provides a programmatic API for LLM agents:

    import { createTunnelServer } from './tunnel/server';

    const server = createTunnelServer({ port: 3001 });
    await server.start();

    // Execute a tool on a connected client
    const result = await server.executeTool('bash', {
      command: 'ls -la'
    });

    // Get all available tools from connected clients
    const tools = server.getAllTools();

    // Execute with streaming output
    const result = await server.executeTool('bash', {
      command: 'npm test'
    }, {
      streaming: true,
      onOutput: (stream, data, offset) => {
        console.log(\`[\${stream}] \${data}\`);
      }
    });
`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

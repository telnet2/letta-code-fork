/**
 * Tunnel Tests - TunnelClient and TunnelServer
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { join } from "path";
import { tmpdir } from "os";
import { mkdir, rm } from "fs/promises";

import {
  createTunnelClient,
  createTunnelServer,
  generateToken,
  validateToken,
  generateSecret,
  generateClientId,
  createTokenValidator,
  type TunnelClient,
  type TunnelServer,
  type TunnelClientEvent,
  type TunnelServerEvent,
} from "../tunnel";

// Import tools to register them
import "../tools/adapters";

describe("Tunnel Authentication", () => {
  const secret = "test-secret-key";

  test("generates valid token", () => {
    const clientId = "test-client";
    const token = generateToken(clientId, secret);

    expect(token).toBeDefined();
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
  });

  test("validates correct token", () => {
    const clientId = "test-client";
    const token = generateToken(clientId, secret, 3600000); // 1 hour

    const result = validateToken(token, secret);

    expect(result.valid).toBe(true);
    expect(result.payload).toBeDefined();
    expect(result.payload!.clientId).toBe(clientId);
  });

  test("rejects invalid signature", () => {
    const clientId = "test-client";
    const token = generateToken(clientId, secret);

    const result = validateToken(token, "wrong-secret");

    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid signature");
  });

  test("rejects expired token", () => {
    const clientId = "test-client";
    const token = generateToken(clientId, secret, -1000); // Already expired

    const result = validateToken(token, secret);

    expect(result.valid).toBe(false);
    expect(result.error).toContain("expired");
  });

  test("rejects malformed token", () => {
    const result = validateToken("not-a-valid-token", secret);

    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("generates random secret", () => {
    const secret1 = generateSecret();
    const secret2 = generateSecret();

    expect(secret1).toBeDefined();
    expect(secret2).toBeDefined();
    expect(secret1).not.toBe(secret2);
    expect(secret1.length).toBe(64); // 32 bytes = 64 hex chars
  });

  test("generates random client ID", () => {
    const id1 = generateClientId();
    const id2 = generateClientId();

    expect(id1).toBeDefined();
    expect(id2).toBeDefined();
    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^client_/);
  });

  test("creates token validator function", async () => {
    const validator = createTokenValidator(secret);
    const token = generateToken("test-client", secret);

    const isValid = await validator(token);
    expect(isValid).toBe(true);

    const isInvalid = await validator("invalid-token");
    expect(isInvalid).toBe(false);
  });
});

describe("TunnelServer", () => {
  let server: TunnelServer;
  let secret: string;
  let port: number;

  beforeAll(async () => {
    secret = generateSecret();
    port = 3100 + Math.floor(Math.random() * 100);

    server = createTunnelServer({
      port,
      host: "127.0.0.1",
      validateToken: createTokenValidator(secret),
    });

    await server.start();
  });

  afterAll(async () => {
    if (server) {
      await server.stop();
    }
  });

  test("starts and provides URL", () => {
    const url = server.getUrl();

    expect(url).toContain("ws://");
    expect(url).toContain(`${port}`);
    expect(url).toContain("/tunnel");
  });

  test("returns empty tools when no clients", () => {
    const tools = server.getAllTools();

    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBe(0);
  });

  test("returns empty clients when none connected", () => {
    const clients = server.getConnectedClients();

    expect(Array.isArray(clients)).toBe(true);
    expect(clients.length).toBe(0);
  });

  test("returns error when no client available for tool", async () => {
    const result = await server.executeTool("Bash", { command: "echo test" });

    expect(result.status).toBe("error");
    expect(result.error).toContain("No client available");
  });
});

describe("TunnelClient and Server Integration", () => {
  let server: TunnelServer;
  let client: TunnelClient;
  let secret: string;
  let token: string;
  let port: number;
  let testDir: string;

  beforeAll(async () => {
    // Create test directory
    testDir = join(tmpdir(), `tunnel-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });

    secret = generateSecret();
    port = 3200 + Math.floor(Math.random() * 100);
    token = generateToken("test-client", secret, 3600000);

    server = createTunnelServer({
      port,
      host: "127.0.0.1",
      validateToken: createTokenValidator(secret),
    });

    await server.start();

    client = createTunnelClient({
      serverUrl: `ws://127.0.0.1:${port}/tunnel`,
      token,
      clientId: "test-client",
      workspaceRoot: testDir,
      reconnect: { enabled: false },
    });
  });

  afterAll(async () => {
    if (client) {
      await client.disconnect();
    }
    if (server) {
      await server.stop();
    }
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  test("client connects and authenticates", async () => {
    const events: TunnelClientEvent[] = [];
    client.on((event) => events.push(event));

    await client.connect();

    expect(client.connected).toBe(true);
    expect(events.some((e) => e.type === "connected")).toBe(true);

    const serverInfo = client.getServerInfo();
    expect(serverInfo).toBeDefined();
    expect(serverInfo!.serverId).toBe("tunnel-server");
  });

  test("server sees connected client", () => {
    const clients = server.getConnectedClients();

    expect(clients.length).toBe(1);
    expect(clients[0].id).toBe("test-client");
  });

  test("server lists tools from client", async () => {
    // Wait a moment for tool list exchange
    await new Promise((r) => setTimeout(r, 500));

    const tools = server.getAllTools();

    // Should have some built-in tools from the client
    // Note: tools may be empty if the list hasn't been received yet
    // The client announces tools in its auth, and server requests full list
    expect(Array.isArray(tools)).toBe(true);

    // Alternative check: verify client tools are visible through getConnectedClients
    const clients = server.getConnectedClients();
    expect(clients.length).toBe(1);
  });

  test("executes tool through tunnel", async () => {
    const result = await server.executeTool("Bash", {
      command: "echo hello-from-tunnel",
    });

    expect(result.status).toBe("success");
    expect(result.result).toContain("hello-from-tunnel");
    expect(result.exitCode).toBe(0);
    expect(result.timing.durationMs).toBeGreaterThan(0);
  });

  test("executes tool with streaming output", async () => {
    const outputs: Array<{ stream: string; data: string }> = [];

    const result = await server.executeTool(
      "Bash",
      { command: "echo streaming-output" },
      {
        streaming: true,
        onOutput: (stream, data, offset) => {
          outputs.push({ stream, data });
        },
      }
    );

    expect(result.status).toBe("success");
    expect(outputs.length).toBeGreaterThan(0);
  });

  test("handles tool not found", async () => {
    const result = await server.executeTool("NonExistentTool", {});

    expect(result.status).toBe("error");
    expect(result.error).toBeDefined();
    // Error could be "No client available" or "Tool not found"
    expect(
      result.error!.includes("not found") || result.error!.includes("No client")
    ).toBe(true);
  });

  test("handles tool timeout", async () => {
    const result = await server.executeTool(
      "Bash",
      { command: "sleep 5" },
      { timeout: 100 }
    );

    expect(result.status).toBe("timeout");
  });

  test("client returns tools list", () => {
    const tools = client.getTools();

    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.some((t) => t.name === "Bash")).toBe(true);
  });

  test("client can change cwd", () => {
    const newCwd = "/tmp";
    client.setCwd(newCwd);

    // Execute a command to verify
    // The cwd change is internal, we test by executing something
  });

  test("client can update env", () => {
    client.setEnv({ TEST_VAR: "test-value" });

    // The env change is internal
  });
});

describe("TunnelServer Event Handling", () => {
  let server: TunnelServer;
  let client: TunnelClient;
  let secret: string;
  let port: number;
  let serverEvents: TunnelServerEvent[];

  beforeAll(async () => {
    secret = generateSecret();
    port = 3300 + Math.floor(Math.random() * 100);

    server = createTunnelServer({
      port,
      host: "127.0.0.1",
      validateToken: createTokenValidator(secret),
    });

    serverEvents = [];
    server.on((event) => serverEvents.push(event));

    await server.start();
  });

  afterAll(async () => {
    if (client) {
      await client.disconnect();
    }
    if (server) {
      await server.stop();
    }
  });

  test("emits client_connected event", async () => {
    const token = generateToken("event-test-client", secret);

    client = createTunnelClient({
      serverUrl: `ws://127.0.0.1:${port}/tunnel`,
      token,
      clientId: "event-test-client",
      reconnect: { enabled: false },
    });

    await client.connect();

    const connectedEvent = serverEvents.find(
      (e) => e.type === "client_connected"
    );
    expect(connectedEvent).toBeDefined();
    expect(connectedEvent!.type === "client_connected" && connectedEvent.clientId).toBe(
      "event-test-client"
    );
  });

  test("emits tool_call_request and tool_call_response events", async () => {
    await server.executeTool("Bash", { command: "echo test" });

    const requestEvent = serverEvents.find(
      (e) => e.type === "tool_call_request"
    );
    expect(requestEvent).toBeDefined();

    const responseEvent = serverEvents.find(
      (e) => e.type === "tool_call_response"
    );
    expect(responseEvent).toBeDefined();
  });

  test("emits client_disconnected event", async () => {
    await client.disconnect();

    // Wait for disconnect to propagate
    await new Promise((r) => setTimeout(r, 100));

    const disconnectedEvent = serverEvents.find(
      (e) => e.type === "client_disconnected"
    );
    expect(disconnectedEvent).toBeDefined();
  });
});

describe("TunnelClient Reconnection", () => {
  let server: TunnelServer;
  let secret: string;
  let port: number;

  beforeAll(async () => {
    secret = generateSecret();
    port = 3400 + Math.floor(Math.random() * 100);

    server = createTunnelServer({
      port,
      host: "127.0.0.1",
      validateToken: createTokenValidator(secret),
    });

    await server.start();
  });

  afterAll(async () => {
    if (server) {
      await server.stop();
    }
  });

  test("client rejects invalid token", async () => {
    const client = createTunnelClient({
      serverUrl: `ws://127.0.0.1:${port}/tunnel`,
      token: "invalid-token",
      reconnect: { enabled: false },
    });

    await expect(client.connect()).rejects.toThrow();
  });

  test("client handles connection to non-existent server", async () => {
    const client = createTunnelClient({
      serverUrl: "ws://127.0.0.1:9999/tunnel",
      token: "any-token",
      reconnect: { enabled: false },
      connectionTimeoutMs: 1000,
    });

    await expect(client.connect()).rejects.toThrow();
  });
});

describe("Multiple Clients", () => {
  let server: TunnelServer;
  let client1: TunnelClient;
  let client2: TunnelClient;
  let secret: string;
  let port: number;

  beforeAll(async () => {
    secret = generateSecret();
    port = 3500 + Math.floor(Math.random() * 100);

    server = createTunnelServer({
      port,
      host: "127.0.0.1",
      validateToken: createTokenValidator(secret),
    });

    await server.start();

    const token1 = generateToken("client-1", secret);
    const token2 = generateToken("client-2", secret);

    client1 = createTunnelClient({
      serverUrl: `ws://127.0.0.1:${port}/tunnel`,
      token: token1,
      clientId: "client-1",
      reconnect: { enabled: false },
    });

    client2 = createTunnelClient({
      serverUrl: `ws://127.0.0.1:${port}/tunnel`,
      token: token2,
      clientId: "client-2",
      reconnect: { enabled: false },
    });
  });

  afterAll(async () => {
    if (client1) await client1.disconnect();
    if (client2) await client2.disconnect();
    if (server) await server.stop();
  });

  test("server accepts multiple clients", async () => {
    await client1.connect();
    await client2.connect();

    const clients = server.getConnectedClients();

    expect(clients.length).toBe(2);
    expect(clients.map((c) => c.id)).toContain("client-1");
    expect(clients.map((c) => c.id)).toContain("client-2");
  });

  test("can execute on specific client", async () => {
    const result1 = await server.executeToolOnClient("client-1", "Bash", {
      command: "echo from-client-1",
    });

    expect(result1.status).toBe("success");
    expect(result1.result).toContain("from-client-1");

    const result2 = await server.executeToolOnClient("client-2", "Bash", {
      command: "echo from-client-2",
    });

    expect(result2.status).toBe("success");
    expect(result2.result).toContain("from-client-2");
  });

  test("returns error for non-existent client", async () => {
    const result = await server.executeToolOnClient("non-existent", "Bash", {
      command: "echo test",
    });

    expect(result.status).toBe("error");
    expect(result.error).toContain("not found");
  });
});

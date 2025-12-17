/**
 * Server Tests - HTTP API and SSE streaming
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { join } from "path";
import { tmpdir } from "os";
import { rm, mkdir, writeFile } from "fs/promises";
import { createServer, type ToolServer } from "../server";

describe("Tool Server API", () => {
  let testDir: string;
  let server: ToolServer;
  let baseUrl: string;

  beforeAll(async () => {
    testDir = join(tmpdir(), `tool-server-api-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });

    server = await createServer({
      dataDir: testDir,
      port: 0, // Random available port
      host: "127.0.0.1",
    });
    await server.start();
    baseUrl = server.getUrl();
  });

  afterAll(async () => {
    await server.stop();
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("Health Check", () => {
    test("GET /health returns ok", async () => {
      const res = await fetch(`${baseUrl}/health`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.status).toBe("ok");
      expect(Array.isArray(data.tools)).toBe(true);
    });
  });

  describe("Tools", () => {
    test("GET /api/tools lists available tools", async () => {
      const res = await fetch(`${baseUrl}/api/tools`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(Array.isArray(data.tools)).toBe(true);

      const toolNames = data.tools.map((t: any) => t.name);
      expect(toolNames).toContain("Bash");
      expect(toolNames).toContain("Read");
      expect(toolNames).toContain("Write");
    });
  });

  describe("Sessions", () => {
    test("POST /api/sessions creates a session", async () => {
      const res = await fetch(`${baseUrl}/api/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ env: { TEST: "value" } }),
      });

      expect(res.status).toBe(201);

      const session = await res.json();
      expect(session.id).toBeDefined();
      expect(session.status).toBe("active");
      expect(session.env).toEqual({ TEST: "value" });
    });

    test("GET /api/sessions lists sessions", async () => {
      // Create a session first
      await fetch(`${baseUrl}/api/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const res = await fetch(`${baseUrl}/api/sessions`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(Array.isArray(data.sessions)).toBe(true);
      expect(data.count).toBeGreaterThanOrEqual(1);
    });

    test("GET /api/sessions/:id returns session", async () => {
      const createRes = await fetch(`${baseUrl}/api/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const created = await createRes.json();

      const res = await fetch(`${baseUrl}/api/sessions/${created.id}`);
      expect(res.status).toBe(200);

      const session = await res.json();
      expect(session.id).toBe(created.id);
    });

    test("GET /api/sessions/:id returns 404 for unknown session", async () => {
      const res = await fetch(`${baseUrl}/api/sessions/unknown-id`);
      expect(res.status).toBe(404);
    });

    test("DELETE /api/sessions/:id deletes session", async () => {
      const createRes = await fetch(`${baseUrl}/api/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const created = await createRes.json();

      const res = await fetch(`${baseUrl}/api/sessions/${created.id}`, {
        method: "DELETE",
      });
      expect(res.status).toBe(204);

      // Verify deleted
      const getRes = await fetch(`${baseUrl}/api/sessions/${created.id}`);
      expect(getRes.status).toBe(404);
    });

    test("POST /api/sessions/:id/extend extends expiry", async () => {
      const createRes = await fetch(`${baseUrl}/api/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeoutDays: 1 }),
      });
      const created = await createRes.json();
      const originalExpiry = new Date(created.expiresAt).getTime();

      const res = await fetch(`${baseUrl}/api/sessions/${created.id}/extend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days: 7 }),
      });
      expect(res.status).toBe(200);

      const extended = await res.json();
      const newExpiry = new Date(extended.expiresAt).getTime();
      expect(newExpiry).toBeGreaterThan(originalExpiry);
    });
  });

  describe("Execution (Sync)", () => {
    test("POST /api/sessions/:id/execute runs a tool", async () => {
      const createRes = await fetch(`${baseUrl}/api/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const session = await createRes.json();

      const res = await fetch(`${baseUrl}/api/sessions/${session.id}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tool: "Bash",
          args: { command: "echo hello" },
        }),
      });

      expect(res.status).toBe(200);

      const result = await res.json();
      expect(result.executionId).toBeDefined();
      expect(result.status).toBe("completed");
      expect(result.result).toContain("hello");
    });

    test("POST /api/sessions/:id/execute returns 404 for unknown tool", async () => {
      const createRes = await fetch(`${baseUrl}/api/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const session = await createRes.json();

      const res = await fetch(`${baseUrl}/api/sessions/${session.id}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tool: "UnknownTool",
          args: {},
        }),
      });

      expect(res.status).toBe(404);
    });
  });

  describe("Executions List", () => {
    test("GET /api/sessions/:id/executions lists executions", async () => {
      const createRes = await fetch(`${baseUrl}/api/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const session = await createRes.json();

      // Run a tool
      await fetch(`${baseUrl}/api/sessions/${session.id}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tool: "Bash",
          args: { command: "echo test" },
        }),
      });

      const res = await fetch(
        `${baseUrl}/api/sessions/${session.id}/executions`
      );
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(Array.isArray(data.executions)).toBe(true);
      expect(data.count).toBeGreaterThanOrEqual(1);
    });
  });
});

describe("SSE Streaming", () => {
  let testDir: string;
  let server: ToolServer;
  let baseUrl: string;

  beforeAll(async () => {
    testDir = join(tmpdir(), `tool-server-sse-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });

    server = await createServer({
      dataDir: testDir,
      port: 0,
      host: "127.0.0.1",
    });
    await server.start();
    baseUrl = server.getUrl();
  });

  afterAll(async () => {
    await server.stop();
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  test("POST /api/sessions/:id/execute/stream returns SSE", async () => {
    const createRes = await fetch(`${baseUrl}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const session = await createRes.json();

    const res = await fetch(
      `${baseUrl}/api/sessions/${session.id}/execute/stream`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          tool: "Bash",
          args: { command: "echo streaming" },
        }),
      }
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");

    // Read the stream
    const text = await res.text();

    // Should contain SSE events
    expect(text).toContain("event: started");
    expect(text).toContain("event: completed");
    expect(text).toContain("executionId");
  });
});

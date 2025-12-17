/**
 * Client Tests - ToolServerClient and streaming
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { join } from "path";
import { tmpdir } from "os";
import { rm, mkdir, writeFile } from "fs/promises";
import { createServer, type ToolServer } from "../server";
import { ToolServerClient, createClient } from "../client";

describe("ToolServerClient", () => {
  let testDir: string;
  let server: ToolServer;
  let baseUrl: string;

  beforeAll(async () => {
    testDir = join(tmpdir(), `client-test-${Date.now()}`);
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

  describe("Session Management", () => {
    test("creates client with factory function", () => {
      const client = createClient({ baseUrl });
      expect(client).toBeInstanceOf(ToolServerClient);
      expect(client.getSessionId()).toBeNull();
    });

    test("connects and creates session", async () => {
      const client = createClient({ baseUrl });

      const session = await client.connect();

      expect(session.id).toBeDefined();
      expect(session.metadata.status).toBe("active");
      expect(client.getSessionId()).toBe(session.id);

      await client.close();
    });

    test("connects with options", async () => {
      const client = createClient({ baseUrl });

      const session = await client.connect({
        env: { TEST: "value" },
        timeoutDays: 1,
      });

      expect(session.metadata.env).toEqual({ TEST: "value" });

      await client.close();
    });

    test("gets current session", async () => {
      const client = createClient({ baseUrl });
      await client.connect();

      const session = await client.getSession();

      expect(session).not.toBeNull();
      expect(session!.id).toBe(client.getSessionId());

      await client.close();
    });

    test("closes session", async () => {
      const client = createClient({ baseUrl });
      await client.connect();
      const sessionId = client.getSessionId();

      await client.close();

      expect(client.getSessionId()).toBeNull();

      // Create new client to verify session is closed
      const client2 = createClient({ baseUrl, sessionId: sessionId! });
      const session = await client2.getSession();
      expect(session).toBeNull();
    });

    test("extends session", async () => {
      const client = createClient({ baseUrl });
      await client.connect({ timeoutDays: 1 });

      const extended = await client.extend(7);

      expect(extended.id).toBe(client.getSessionId());
      // Expiry should be extended

      await client.close();
    });

    test("resumes existing session", async () => {
      const client1 = createClient({ baseUrl });
      const session1 = await client1.connect();
      const sessionId = session1.id;

      // Create new client with same session ID
      const client2 = createClient({ baseUrl, sessionId });
      const session2 = await client2.connect();

      expect(session2.id).toBe(sessionId);

      await client1.close();
    });
  });

  describe("Tool Execution", () => {
    test("executes tool synchronously", async () => {
      const client = createClient({ baseUrl });
      await client.connect();

      const execution = await client.execute(
        "Bash",
        { command: "echo hello" },
        { stream: false }
      );

      const result = await execution.result();

      expect(result.executionId).toBeDefined();
      expect(result.status).toBe("completed");
      expect(result.result).toContain("hello");

      await client.close();
    });

    test("executes tool with streaming", async () => {
      const client = createClient({ baseUrl });
      await client.connect();

      const execution = await client.execute(
        "Bash",
        { command: "echo streaming" },
        { stream: true }
      );

      const events: string[] = [];
      let completedEvent: any = null;

      for await (const chunk of execution.stream()) {
        events.push(chunk.type);
        if (chunk.type === "completed") {
          completedEvent = chunk;
        }
      }

      // Should at least have started and completed events
      expect(events).toContain("started");
      expect(events).toContain("completed");
      expect(completedEvent).not.toBeNull();
      expect(completedEvent.status).toBe("completed");

      await client.close();
    });

    test("gets execution result after streaming", async () => {
      const client = createClient({ baseUrl });
      await client.connect();

      const execution = await client.execute("Bash", { command: "echo test" });

      // Consume stream
      for await (const _ of execution.stream()) {
        // Just consume
      }

      const result = await execution.result();
      expect(result.status).toBe("completed");

      await client.close();
    });

    test("formats result for LLM", async () => {
      const client = createClient({ baseUrl });
      await client.connect();

      const execution = await client.execute(
        "Bash",
        { command: "echo llm-output" },
        { stream: false }
      );

      const formatted = await execution.formatForLLM();

      expect(formatted).toContain("Tool: Bash");
      expect(formatted).toContain("llm-output");

      await client.close();
    });

    test("cancels execution", async () => {
      const client = createClient({ baseUrl });
      await client.connect();

      // For sync execution, cancel is a no-op
      const execution = await client.execute(
        "Bash",
        { command: "echo cancel" },
        { stream: false }
      );

      const cancelled = await client.cancel(execution.id);
      // Already completed, so should return false
      expect(cancelled).toBe(false);

      await client.close();
    });

    test("lists executions", async () => {
      const client = createClient({ baseUrl });
      await client.connect();

      await client.execute("Bash", { command: "echo 1" }, { stream: false });
      await client.execute("Bash", { command: "echo 2" }, { stream: false });

      const executions = await client.listExecutions();

      expect(executions.length).toBeGreaterThanOrEqual(2);

      await client.close();
    });

    test("gets execution details", async () => {
      const client = createClient({ baseUrl });
      await client.connect();

      const execution = await client.execute(
        "Bash",
        { command: "echo details" },
        { stream: false }
      );

      const details = await client.getExecution(execution.id);

      expect(details).not.toBeNull();
      expect(details!.id).toBe(execution.id);
      expect(details!.toolName).toBe("Bash");

      await client.close();
    });

    test("queries output with pagination", async () => {
      const client = createClient({ baseUrl });
      await client.connect();

      const execution = await client.execute(
        "Bash",
        { command: "echo 0123456789" },
        { stream: false }
      );

      const output = await client.queryOutput(execution.id, {
        stream: "stdout",
        offset: 0,
        limit: 5,
      });

      expect(output.data).toBeDefined();
      expect(output.stream).toBe("stdout");

      await client.close();
    });
  });

  describe("Utility Methods", () => {
    test("lists available tools", async () => {
      const client = createClient({ baseUrl });

      const tools = await client.listTools();

      expect(Array.isArray(tools)).toBe(true);
      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain("Bash");
      expect(toolNames).toContain("Read");
    });

    test("checks server health", async () => {
      const client = createClient({ baseUrl });

      const health = await client.health();

      expect(health.status).toBe("ok");
      expect(Array.isArray(health.tools)).toBe(true);
    });

    test("throws when no session", async () => {
      const client = createClient({ baseUrl });

      await expect(
        client.execute("Bash", { command: "echo" })
      ).rejects.toThrow("No active session");
    });
  });
});

describe("Output Formatting", () => {
  let testDir: string;
  let server: ToolServer;
  let baseUrl: string;

  beforeAll(async () => {
    testDir = join(tmpdir(), `format-test-${Date.now()}`);
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

  test("formats with metadata", async () => {
    const client = createClient({ baseUrl });
    await client.connect();

    const execution = await client.execute(
      "Bash",
      { command: "echo meta" },
      { stream: false }
    );

    const formatted = await execution.formatForLLM({ includeMetadata: true });

    expect(formatted).toContain("Tool: Bash");
    expect(formatted).toContain("Exit Code:");

    await client.close();
  });

  test("formats without metadata", async () => {
    const client = createClient({ baseUrl });
    await client.connect();

    const execution = await client.execute(
      "Bash",
      { command: "echo nometa" },
      { stream: false }
    );

    const formatted = await execution.formatForLLM({ includeMetadata: false });

    expect(formatted).not.toContain("Tool:");
    expect(formatted).toContain("nometa");

    await client.close();
  });

  test("truncates long output", async () => {
    const client = createClient({ baseUrl });
    await client.connect();

    // Generate long output
    const execution = await client.execute(
      "Bash",
      { command: 'echo "' + "x".repeat(200) + '"' },
      { stream: false }
    );

    const formatted = await execution.formatForLLM({ maxOutputLength: 50 });

    expect(formatted).toContain("truncated");
    expect(formatted).toContain("queryOutput");

    await client.close();
  });
});

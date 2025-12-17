/**
 * Tools Tests - Registry, Executor, and Adapters
 */

import { test, expect, beforeEach, afterEach, describe } from "bun:test";
import { join } from "path";
import { tmpdir } from "os";
import { rm, mkdir, writeFile } from "fs/promises";
import { setConfig, loadConfig } from "../server/config";
import { SessionManager } from "../core/session-manager";
import { createExecutionManager } from "../core/execution-manager";
import { createProcessManager } from "../core/process-manager";
import { toolRegistry, getTool, registerTool, type ToolContext, type ToolResult } from "../tools/registry";
import { createToolExecutor } from "../tools/executor";

// Import adapters to register tools
import "../tools/adapters";

describe("Tool Registry", () => {
  test("has registered tools after import", () => {
    const tools = toolRegistry.list();
    expect(tools.length).toBeGreaterThan(0);
    expect(toolRegistry.has("Bash")).toBe(true);
    expect(toolRegistry.has("Read")).toBe(true);
    expect(toolRegistry.has("Write")).toBe(true);
    expect(toolRegistry.has("Edit")).toBe(true);
    expect(toolRegistry.has("Glob")).toBe(true);
    expect(toolRegistry.has("Grep")).toBe(true);
  });

  test("gets tool by name", () => {
    const bash = getTool("Bash");
    expect(bash).toBeDefined();
    expect(bash?.name).toBe("Bash");
    expect(bash?.schema.required).toContain("command");
  });

  test("returns undefined for unknown tool", () => {
    const unknown = getTool("UnknownTool");
    expect(unknown).toBeUndefined();
  });

  test("registers custom tool", () => {
    const customImpl = async (
      args: Record<string, unknown>,
      context: ToolContext
    ): Promise<ToolResult> => {
      return { content: "custom result", status: "success" };
    };

    registerTool({
      name: "CustomTest",
      description: "Test tool",
      implementation: customImpl,
      schema: {
        type: "object",
        properties: { input: { type: "string" } },
        required: ["input"],
      },
    });

    expect(toolRegistry.has("CustomTest")).toBe(true);
    toolRegistry.unregister("CustomTest");
  });
});

describe("Tool Executor", () => {
  let testDir: string;
  let sessionManager: SessionManager;

  beforeEach(async () => {
    testDir = join(tmpdir(), `tool-exec-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });

    setConfig(loadConfig({ dataDir: testDir }));

    sessionManager = new SessionManager(testDir);
    await sessionManager.initialize();
  });

  afterEach(async () => {
    await sessionManager.shutdown();
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("executes Bash tool", async () => {
    const session = await sessionManager.createSession();
    const executionManager = createExecutionManager(
      sessionManager.getWorkspacePath(session.id).replace("/workspace", "")
    );
    const processManager = createProcessManager(
      sessionManager.getWorkspacePath(session.id).replace("/workspace", "")
    );

    const executor = createToolExecutor(session, executionManager, processManager);

    const { execution, result } = await executor.execute("Bash", {
      command: "echo hello",
    });

    expect(execution.toolName).toBe("Bash");

    const finalResult = await result;
    expect(finalResult.status).toBe("success");
    expect(finalResult.content).toContain("hello");
  });

  test("executes Read tool", async () => {
    const session = await sessionManager.createSession();
    const workspacePath = session.workspaceRoot;

    // Create a test file in workspace
    await writeFile(join(workspacePath, "test.txt"), "line 1\nline 2\nline 3");

    const executionManager = createExecutionManager(
      sessionManager.getWorkspacePath(session.id).replace("/workspace", "")
    );
    const processManager = createProcessManager(
      sessionManager.getWorkspacePath(session.id).replace("/workspace", "")
    );

    const executor = createToolExecutor(session, executionManager, processManager);

    const { result } = await executor.execute("Read", {
      file_path: join(workspacePath, "test.txt"),
    });

    const finalResult = await result;
    expect(finalResult.status).toBe("success");
    expect(finalResult.content).toContain("line 1");
    expect(finalResult.content).toContain("line 2");
  });

  test("executes Write tool", async () => {
    const session = await sessionManager.createSession();
    const workspacePath = session.workspaceRoot;

    const executionManager = createExecutionManager(
      sessionManager.getWorkspacePath(session.id).replace("/workspace", "")
    );
    const processManager = createProcessManager(
      sessionManager.getWorkspacePath(session.id).replace("/workspace", "")
    );

    const executor = createToolExecutor(session, executionManager, processManager);

    const testFile = join(workspacePath, "newfile.txt");
    const { result } = await executor.execute("Write", {
      file_path: testFile,
      content: "new content",
    });

    const finalResult = await result;
    expect(finalResult.status).toBe("success");

    // Verify file was created
    const file = Bun.file(testFile);
    expect(await file.exists()).toBe(true);
    expect(await file.text()).toBe("new content");
  });

  test("executes Edit tool", async () => {
    const session = await sessionManager.createSession();
    const workspacePath = session.workspaceRoot;

    // Create test file
    const testFile = join(workspacePath, "edit.txt");
    await writeFile(testFile, "hello world");

    const executionManager = createExecutionManager(
      sessionManager.getWorkspacePath(session.id).replace("/workspace", "")
    );
    const processManager = createProcessManager(
      sessionManager.getWorkspacePath(session.id).replace("/workspace", "")
    );

    const executor = createToolExecutor(session, executionManager, processManager);

    const { result } = await executor.execute("Edit", {
      file_path: testFile,
      old_string: "world",
      new_string: "universe",
    });

    const finalResult = await result;
    expect(finalResult.status).toBe("success");

    // Verify edit
    const content = await Bun.file(testFile).text();
    expect(content).toBe("hello universe");
  });

  test("executes Glob tool", async () => {
    const session = await sessionManager.createSession();
    const workspacePath = session.workspaceRoot;

    // Create test files
    await writeFile(join(workspacePath, "a.ts"), "");
    await writeFile(join(workspacePath, "b.ts"), "");
    await writeFile(join(workspacePath, "c.js"), "");

    const executionManager = createExecutionManager(
      sessionManager.getWorkspacePath(session.id).replace("/workspace", "")
    );
    const processManager = createProcessManager(
      sessionManager.getWorkspacePath(session.id).replace("/workspace", "")
    );

    const executor = createToolExecutor(session, executionManager, processManager);

    const { result } = await executor.execute("Glob", {
      pattern: "*.ts",
      path: workspacePath,
    });

    const finalResult = await result;
    expect(finalResult.status).toBe("success");
    expect(finalResult.content).toContain("a.ts");
    expect(finalResult.content).toContain("b.ts");
    expect(finalResult.content).not.toContain("c.js");
  });

  test("executes Grep tool", async () => {
    const session = await sessionManager.createSession();
    const workspacePath = session.workspaceRoot;

    // Create test file with content
    await writeFile(
      join(workspacePath, "search.txt"),
      "hello world\nfoo bar\nhello again"
    );

    const executionManager = createExecutionManager(
      sessionManager.getWorkspacePath(session.id).replace("/workspace", "")
    );
    const processManager = createProcessManager(
      sessionManager.getWorkspacePath(session.id).replace("/workspace", "")
    );

    const executor = createToolExecutor(session, executionManager, processManager);

    const { result } = await executor.execute("Grep", {
      pattern: "hello",
      path: workspacePath,
    });

    const finalResult = await result;
    expect(finalResult.status).toBe("success");
    expect(finalResult.content).toContain("search.txt");
  });

  test("handles tool errors gracefully", async () => {
    const session = await sessionManager.createSession();

    const executionManager = createExecutionManager(
      sessionManager.getWorkspacePath(session.id).replace("/workspace", "")
    );
    const processManager = createProcessManager(
      sessionManager.getWorkspacePath(session.id).replace("/workspace", "")
    );

    const executor = createToolExecutor(session, executionManager, processManager);

    const { result } = await executor.execute("Read", {
      file_path: "/nonexistent/file.txt",
    });

    const finalResult = await result;
    expect(finalResult.status).toBe("error");
    expect(finalResult.content).toContain("not found");
  });

  test("throws for unknown tool", async () => {
    const session = await sessionManager.createSession();

    const executionManager = createExecutionManager(
      sessionManager.getWorkspacePath(session.id).replace("/workspace", "")
    );
    const processManager = createProcessManager(
      sessionManager.getWorkspacePath(session.id).replace("/workspace", "")
    );

    const executor = createToolExecutor(session, executionManager, processManager);

    await expect(
      executor.execute("UnknownTool", {})
    ).rejects.toThrow("Tool not found");
  });

  test("streams output via callbacks", async () => {
    const session = await sessionManager.createSession();

    const executionManager = createExecutionManager(
      sessionManager.getWorkspacePath(session.id).replace("/workspace", "")
    );
    const processManager = createProcessManager(
      sessionManager.getWorkspacePath(session.id).replace("/workspace", "")
    );

    const executor = createToolExecutor(session, executionManager, processManager);

    const { execution, result } = await executor.execute("Bash", {
      command: 'echo "streaming test"',
    });

    // Subscribe to output
    const chunks: string[] = [];
    executionManager.subscribeToOutput(execution.id, (stream, data) => {
      chunks.push(data);
    });

    await result;

    // Output should have been captured
    const finalExec = await executionManager.getExecution(execution.id);
    expect(finalExec?.totalStdoutSize).toBeGreaterThan(0);
  });
});

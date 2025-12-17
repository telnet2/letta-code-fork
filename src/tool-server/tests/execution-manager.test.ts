/**
 * Execution Manager Tests
 */

import { test, expect, beforeEach, afterEach, describe } from "bun:test";
import { join } from "path";
import { tmpdir } from "os";
import { rm, mkdir } from "fs/promises";
import { ExecutionManager, createExecutionManager } from "../core/execution-manager";
import { setConfig, loadConfig } from "../server/config";

describe("ExecutionManager", () => {
  let testDir: string;
  let executionManager: ExecutionManager;

  beforeEach(async () => {
    // Create a unique test directory
    testDir = join(tmpdir(), `tool-server-exec-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });

    // Configure with small truncation threshold for testing
    setConfig(loadConfig({
      dataDir: testDir,
      outputTruncateThreshold: 100, // Small threshold for testing
    }));

    // Create execution manager
    executionManager = createExecutionManager(testDir);
  });

  afterEach(async () => {
    // Cleanup test directory
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("creates a new execution", async () => {
    const execution = await executionManager.createExecution(
      "session-1",
      "Bash",
      { command: "echo hello" }
    );

    expect(execution.id).toBeDefined();
    expect(execution.sessionId).toBe("session-1");
    expect(execution.toolName).toBe("Bash");
    expect(execution.toolArgs).toEqual({ command: "echo hello" });
    expect(execution.status).toBe("pending");
  });

  test("retrieves an execution by ID", async () => {
    const created = await executionManager.createExecution(
      "session-1",
      "Read",
      { file_path: "/test.txt" }
    );

    const retrieved = await executionManager.getExecution(created.id);

    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(created.id);
    expect(retrieved!.toolName).toBe("Read");
  });

  test("returns null for non-existent execution", async () => {
    const execution = await executionManager.getExecution("non-existent-id");
    expect(execution).toBeNull();
  });

  test("marks execution as started", async () => {
    const execution = await executionManager.createExecution(
      "session-1",
      "Bash",
      { command: "ls" }
    );

    const started = await executionManager.markStarted(execution.id);

    expect(started).not.toBeNull();
    expect(started!.status).toBe("running");
  });

  test("marks execution as completed", async () => {
    const execution = await executionManager.createExecution(
      "session-1",
      "Bash",
      { command: "echo done" }
    );

    const completed = await executionManager.markCompleted(
      execution.id,
      { output: "done" },
      0
    );

    expect(completed).not.toBeNull();
    expect(completed!.status).toBe("completed");
    expect(completed!.exitCode).toBe(0);
    expect(completed!.result).toEqual({ output: "done" });
    expect(completed!.completedAt).toBeInstanceOf(Date);
  });

  test("marks execution as failed", async () => {
    const execution = await executionManager.createExecution(
      "session-1",
      "Bash",
      { command: "exit 1" }
    );

    const failed = await executionManager.markFailed(
      execution.id,
      "Command failed",
      1
    );

    expect(failed).not.toBeNull();
    expect(failed!.status).toBe("failed");
    expect(failed!.exitCode).toBe(1);
    expect(failed!.error).toBe("Command failed");
  });

  test("marks execution as cancelled", async () => {
    const execution = await executionManager.createExecution(
      "session-1",
      "Bash",
      { command: "sleep 100" }
    );

    const cancelled = await executionManager.markCancelled(execution.id);

    expect(cancelled).not.toBeNull();
    expect(cancelled!.status).toBe("cancelled");
  });

  test("appends stdout output", async () => {
    const execution = await executionManager.createExecution(
      "session-1",
      "Bash",
      { command: "echo test" }
    );

    await executionManager.appendOutput(execution.id, "stdout", "line 1\n");
    await executionManager.appendOutput(execution.id, "stdout", "line 2\n");

    const updated = await executionManager.getExecution(execution.id);
    expect(updated!.stdout).toContain("line 1");
    expect(updated!.stdout).toContain("line 2");
    expect(updated!.totalStdoutSize).toBe(14);
  });

  test("appends stderr output", async () => {
    const execution = await executionManager.createExecution(
      "session-1",
      "Bash",
      { command: "echo error >&2" }
    );

    await executionManager.appendOutput(execution.id, "stderr", "error msg\n");

    const updated = await executionManager.getExecution(execution.id);
    expect(updated!.stderr).toContain("error msg");
    expect(updated!.totalStderrSize).toBe(10);
  });

  test("handles large output with truncation", async () => {
    const execution = await executionManager.createExecution(
      "session-1",
      "Bash",
      { command: "cat large_file" }
    );

    // Append output larger than threshold (100 bytes)
    const largeOutput = "x".repeat(150);
    await executionManager.appendOutput(execution.id, "stdout", largeOutput);

    const updated = await executionManager.getExecution(execution.id);
    expect(updated!.truncated).toBe(true);
    expect(updated!.totalStdoutSize).toBe(150);
    expect(updated!.stdoutFile).toBeDefined();
  });

  test("gets output with pagination", async () => {
    const execution = await executionManager.createExecution(
      "session-1",
      "Bash",
      { command: "cat file" }
    );

    await executionManager.appendOutput(execution.id, "stdout", "0123456789");

    const page1 = await executionManager.getOutput(execution.id, "stdout", 0, 5);
    expect(page1.data).toBe("01234");
    expect(page1.hasMore).toBe(true);

    const page2 = await executionManager.getOutput(execution.id, "stdout", 5, 5);
    expect(page2.data).toBe("56789");
    expect(page2.hasMore).toBe(false);
  });

  test("subscribes to output updates", async () => {
    const execution = await executionManager.createExecution(
      "session-1",
      "Bash",
      { command: "echo streaming" }
    );

    const chunks: Array<{ stream: string; data: string; offset: number }> = [];
    const unsubscribe = executionManager.subscribeToOutput(
      execution.id,
      (stream, data, offset) => {
        chunks.push({ stream, data, offset });
      }
    );

    await executionManager.appendOutput(execution.id, "stdout", "chunk1");
    await executionManager.appendOutput(execution.id, "stdout", "chunk2");

    expect(chunks.length).toBe(2);
    expect(chunks[0].data).toBe("chunk1");
    expect(chunks[0].offset).toBe(0);
    expect(chunks[1].data).toBe("chunk2");
    expect(chunks[1].offset).toBe(6);

    unsubscribe();
  });

  test("lists all executions", async () => {
    await executionManager.createExecution("session-1", "Bash", { command: "cmd1" });
    await executionManager.createExecution("session-1", "Read", { file_path: "/a" });
    await executionManager.createExecution("session-1", "Write", { file_path: "/b" });

    const executions = await executionManager.listExecutions();
    expect(executions.length).toBe(3);
  });

  test("deletes an execution", async () => {
    const execution = await executionManager.createExecution(
      "session-1",
      "Bash",
      { command: "rm" }
    );

    const deleted = await executionManager.deleteExecution(execution.id);
    expect(deleted).toBe(true);

    const retrieved = await executionManager.getExecution(execution.id);
    expect(retrieved).toBeNull();
  });
});

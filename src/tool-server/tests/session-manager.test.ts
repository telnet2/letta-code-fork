/**
 * Session Manager Tests
 */

import { test, expect, beforeEach, afterEach, describe } from "bun:test";
import { join } from "path";
import { tmpdir } from "os";
import { rm, mkdir } from "fs/promises";
import { SessionManager } from "../core/session-manager";
import { setConfig, loadConfig } from "../server/config";

describe("SessionManager", () => {
  let testDir: string;
  let sessionManager: SessionManager;

  beforeEach(async () => {
    // Create a unique test directory
    testDir = join(tmpdir(), `tool-server-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });

    // Configure to use test directory
    setConfig(loadConfig({ dataDir: testDir, cleanupIntervalMs: 60000 }));

    // Create session manager
    sessionManager = new SessionManager(testDir);
    await sessionManager.initialize();
  });

  afterEach(async () => {
    // Shutdown session manager
    await sessionManager.shutdown();

    // Cleanup test directory
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("creates a new session", async () => {
    const session = await sessionManager.createSession();

    expect(session.id).toBeDefined();
    expect(session.status).toBe("active");
    expect(session.createdAt).toBeInstanceOf(Date);
    expect(session.expiresAt).toBeInstanceOf(Date);
    expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  test("creates session with custom options", async () => {
    const env = { NODE_ENV: "test", FOO: "bar" };
    const session = await sessionManager.createSession({
      cwd: "subdir",
      env,
      timeoutDays: 1,
    });

    expect(session.env).toEqual(env);
    expect(session.cwd).toContain("subdir");

    // Check expiry is approximately 1 day from now
    const oneDayMs = 24 * 60 * 60 * 1000;
    const expectedExpiry = Date.now() + oneDayMs;
    expect(session.expiresAt.getTime()).toBeGreaterThan(expectedExpiry - 1000);
    expect(session.expiresAt.getTime()).toBeLessThan(expectedExpiry + 1000);
  });

  test("retrieves an existing session", async () => {
    const created = await sessionManager.createSession();
    const retrieved = await sessionManager.getSession(created.id);

    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(created.id);
    expect(retrieved!.status).toBe("active");
  });

  test("returns null for non-existent session", async () => {
    const session = await sessionManager.getSession("non-existent-id");
    expect(session).toBeNull();
  });

  test("updates session cwd", async () => {
    const session = await sessionManager.createSession();
    const newCwd = "/new/path";

    const updated = await sessionManager.updateSession(session.id, {
      cwd: newCwd,
    });

    expect(updated).not.toBeNull();
    expect(updated!.cwd).toBe(newCwd);
  });

  test("updates session env", async () => {
    const session = await sessionManager.createSession({
      env: { FOO: "bar" },
    });

    const updated = await sessionManager.updateSession(session.id, {
      env: { BAZ: "qux" },
    });

    expect(updated).not.toBeNull();
    expect(updated!.env).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  test("extends session expiry", async () => {
    const session = await sessionManager.createSession({ timeoutDays: 1 });
    const originalExpiry = session.expiresAt.getTime();

    const extended = await sessionManager.extendSession(session.id, 7);

    expect(extended).not.toBeNull();
    expect(extended!.expiresAt.getTime()).toBeGreaterThan(originalExpiry);
  });

  test("closes and deletes a session", async () => {
    const session = await sessionManager.createSession();

    const closed = await sessionManager.closeSession(session.id);
    expect(closed).toBe(true);

    const retrieved = await sessionManager.getSession(session.id);
    expect(retrieved).toBeNull();
  });

  test("lists active sessions", async () => {
    await sessionManager.createSession();
    await sessionManager.createSession();
    await sessionManager.createSession();

    const sessions = await sessionManager.listSessions();
    expect(sessions.length).toBe(3);
  });

  test("persists sessions across manager instances", async () => {
    const session = await sessionManager.createSession({
      env: { TEST: "value" },
    });
    await sessionManager.shutdown();

    // Create new manager instance
    const newManager = new SessionManager(testDir);
    await newManager.initialize();

    const retrieved = await newManager.getSession(session.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.env).toEqual({ TEST: "value" });

    await newManager.shutdown();
  });

  test("validates path in workspace", async () => {
    const session = await sessionManager.createSession();

    const inWorkspace = sessionManager.isPathInWorkspace(
      session,
      join(session.workspaceRoot, "file.txt")
    );
    expect(inWorkspace).toBe(true);

    const outsideWorkspace = sessionManager.isPathInWorkspace(
      session,
      "/etc/passwd"
    );
    expect(outsideWorkspace).toBe(false);
  });
});

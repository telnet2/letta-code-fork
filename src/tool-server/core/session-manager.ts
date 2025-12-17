/**
 * Session Manager - Handles session lifecycle and persistence
 */

import { join } from "path";
import { randomUUID } from "crypto";
import { getConfig } from "../server/config";
import {
  type Session,
  type SessionCreateOptions,
  type SessionMetadata,
  sessionToMetadata,
  metadataToSession,
} from "../types/session";
import {
  readJson,
  writeJson,
  deleteDir,
  listDir,
  dirExists,
} from "./storage";

const SESSIONS_DIR = "sessions";
const SESSION_FILE = "session.json";
const WORKSPACE_DIR = "workspace";

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private dataDir: string = getConfig().dataDir) {}

  /**
   * Get the sessions directory path
   */
  private get sessionsDir(): string {
    return join(this.dataDir, SESSIONS_DIR);
  }

  /**
   * Get the path for a specific session
   */
  private sessionPath(sessionId: string): string {
    return join(this.sessionsDir, sessionId);
  }

  /**
   * Get the session metadata file path
   */
  private sessionFilePath(sessionId: string): string {
    return join(this.sessionPath(sessionId), SESSION_FILE);
  }

  /**
   * Get the workspace directory for a session
   */
  getWorkspacePath(sessionId: string): string {
    return join(this.sessionPath(sessionId), WORKSPACE_DIR);
  }

  /**
   * Initialize the session manager
   */
  async initialize(): Promise<void> {
    // Load existing sessions from disk
    await this.loadSessions();

    // Start cleanup timer
    const config = getConfig();
    this.cleanupTimer = setInterval(
      () => this.cleanupExpiredSessions(),
      config.cleanupIntervalMs
    );
  }

  /**
   * Shutdown the session manager
   */
  async shutdown(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // Persist all sessions
    for (const session of this.sessions.values()) {
      await this.persistSession(session);
    }
  }

  /**
   * Load all sessions from disk
   */
  private async loadSessions(): Promise<void> {
    const sessionIds = await listDir(this.sessionsDir);

    for (const sessionId of sessionIds) {
      const metadata = await readJson<SessionMetadata>(
        this.sessionFilePath(sessionId)
      );
      if (metadata) {
        const session = metadataToSession(metadata);
        // Check if session is expired
        if (session.expiresAt > new Date()) {
          this.sessions.set(sessionId, session);
        } else {
          // Mark as expired but keep for now (cleanup will handle)
          session.status = "expired";
          this.sessions.set(sessionId, session);
        }
      }
    }
  }

  /**
   * Persist a session to disk
   */
  private async persistSession(session: Session): Promise<void> {
    const metadata = sessionToMetadata(session);
    await writeJson(this.sessionFilePath(session.id), metadata);
  }

  /**
   * Create a new session
   */
  async createSession(options: SessionCreateOptions = {}): Promise<Session> {
    const config = getConfig();
    const now = new Date();
    const timeoutDays = options.timeoutDays ?? config.sessionTimeoutDays;

    const sessionId = randomUUID();
    const workspaceRoot = this.getWorkspacePath(sessionId);

    const session: Session = {
      id: sessionId,
      createdAt: now,
      lastAccessedAt: now,
      expiresAt: new Date(now.getTime() + timeoutDays * 24 * 60 * 60 * 1000),
      workspaceRoot,
      cwd: options.cwd ? join(workspaceRoot, options.cwd) : workspaceRoot,
      env: options.env ?? {},
      status: "active",
    };

    // Create workspace directory
    const { mkdir } = await import("fs/promises");
    await mkdir(workspaceRoot, { recursive: true });

    // Store in memory and persist
    this.sessions.set(sessionId, session);
    await this.persistSession(session);

    return session;
  }

  /**
   * Get a session by ID
   */
  async getSession(sessionId: string): Promise<Session | null> {
    let session = this.sessions.get(sessionId);

    // Try loading from disk if not in memory
    if (!session) {
      const metadata = await readJson<SessionMetadata>(
        this.sessionFilePath(sessionId)
      );
      if (metadata) {
        session = metadataToSession(metadata);
        this.sessions.set(sessionId, session);
      }
    }

    if (!session) {
      return null;
    }

    // Check if expired
    if (session.expiresAt <= new Date()) {
      session.status = "expired";
      await this.persistSession(session);
      return session;
    }

    // Update last accessed time
    session.lastAccessedAt = new Date();
    await this.persistSession(session);

    return session;
  }

  /**
   * Update session properties
   */
  async updateSession(
    sessionId: string,
    updates: Partial<Pick<Session, "cwd" | "env">>
  ): Promise<Session | null> {
    const session = await this.getSession(sessionId);
    if (!session || session.status !== "active") {
      return null;
    }

    if (updates.cwd !== undefined) {
      session.cwd = updates.cwd;
    }
    if (updates.env !== undefined) {
      session.env = { ...session.env, ...updates.env };
    }

    session.lastAccessedAt = new Date();
    await this.persistSession(session);

    return session;
  }

  /**
   * Extend session expiry
   */
  async extendSession(
    sessionId: string,
    additionalDays?: number
  ): Promise<Session | null> {
    const session = await this.getSession(sessionId);
    if (!session) {
      return null;
    }

    const config = getConfig();
    const days = additionalDays ?? config.sessionTimeoutDays;
    session.expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    session.status = "active";
    session.lastAccessedAt = new Date();

    await this.persistSession(session);
    return session;
  }

  /**
   * Close and delete a session
   */
  async closeSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = "closed";
      await this.persistSession(session);
    }

    // Remove from memory
    this.sessions.delete(sessionId);

    // Delete session directory
    const sessionPath = this.sessionPath(sessionId);
    if (await dirExists(sessionPath)) {
      return await deleteDir(sessionPath);
    }

    return true;
  }

  /**
   * List all active sessions
   */
  async listSessions(): Promise<Session[]> {
    const sessions: Session[] = [];
    for (const session of this.sessions.values()) {
      if (session.status === "active" && session.expiresAt > new Date()) {
        sessions.push(session);
      }
    }
    return sessions;
  }

  /**
   * Cleanup expired sessions
   */
  async cleanupExpiredSessions(): Promise<number> {
    const now = new Date();
    let cleaned = 0;

    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.expiresAt <= now || session.status === "closed") {
        await this.closeSession(sessionId);
        cleaned++;
      }
    }

    // Also check disk for any sessions not in memory
    const sessionIds = await listDir(this.sessionsDir);
    for (const sessionId of sessionIds) {
      if (!this.sessions.has(sessionId)) {
        const metadata = await readJson<SessionMetadata>(
          this.sessionFilePath(sessionId)
        );
        if (metadata) {
          const expiresAt = new Date(metadata.expiresAt);
          if (expiresAt <= now || metadata.status === "closed") {
            await deleteDir(this.sessionPath(sessionId));
            cleaned++;
          }
        }
      }
    }

    return cleaned;
  }

  /**
   * Check if a path is within a session's workspace
   */
  isPathInWorkspace(session: Session, targetPath: string): boolean {
    const { resolve } = require("path");
    const resolvedTarget = resolve(targetPath);
    const resolvedWorkspace = resolve(session.workspaceRoot);
    return resolvedTarget.startsWith(resolvedWorkspace);
  }
}

// Singleton instance
let _sessionManager: SessionManager | null = null;

export function getSessionManager(): SessionManager {
  if (!_sessionManager) {
    _sessionManager = new SessionManager();
  }
  return _sessionManager;
}

export function setSessionManager(manager: SessionManager): void {
  _sessionManager = manager;
}

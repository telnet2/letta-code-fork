/**
 * Session types for the tool server
 */

export interface Session {
  id: string;
  createdAt: Date;
  lastAccessedAt: Date;
  expiresAt: Date;

  // Workspace
  workspaceRoot: string;
  cwd: string;

  // Environment
  env: Record<string, string>;

  // State
  status: "active" | "expired" | "closed";
}

export interface SessionCreateOptions {
  /** Initial working directory (relative to workspace root) */
  cwd?: string;
  /** Initial environment variables */
  env?: Record<string, string>;
  /** Session timeout in days (default: 3) */
  timeoutDays?: number;
}

export interface SessionMetadata {
  id: string;
  createdAt: string;
  lastAccessedAt: string;
  expiresAt: string;
  workspaceRoot: string;
  cwd: string;
  env: Record<string, string>;
  status: "active" | "expired" | "closed";
}

export function sessionToMetadata(session: Session): SessionMetadata {
  return {
    id: session.id,
    createdAt: session.createdAt.toISOString(),
    lastAccessedAt: session.lastAccessedAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    workspaceRoot: session.workspaceRoot,
    cwd: session.cwd,
    env: session.env,
    status: session.status,
  };
}

export function metadataToSession(metadata: SessionMetadata): Session {
  return {
    id: metadata.id,
    createdAt: new Date(metadata.createdAt),
    lastAccessedAt: new Date(metadata.lastAccessedAt),
    expiresAt: new Date(metadata.expiresAt),
    workspaceRoot: metadata.workspaceRoot,
    cwd: metadata.cwd,
    env: metadata.env,
    status: metadata.status,
  };
}

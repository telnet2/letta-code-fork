/**
 * Client Types
 */

import type { SessionMetadata } from "../types/session";
import type { ExecutionMetadata } from "../types/execution";

export interface ClientConfig {
  baseUrl: string;
  sessionId?: string;
  timeout?: number;
}

export interface CreateSessionOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeoutDays?: number;
}

export interface ExecuteOptions {
  timeout?: number;
  stream?: boolean;
}

export interface OutputQueryOptions {
  stream: "stdout" | "stderr";
  offset?: number;
  limit?: number;
}

export interface OutputQueryResult {
  executionId: string;
  stream: "stdout" | "stderr";
  data: string;
  offset: number;
  totalSize: number;
  hasMore: boolean;
}

export interface ExecutionResult {
  executionId: string;
  status: string;
  result?: unknown;
  exitCode?: number;
  error?: string;
  truncated: boolean;
  timing: {
    startedAt: string;
    completedAt?: string;
    durationMs: number;
  };
}

export type StreamChunk =
  | { type: "started"; executionId: string; tool: string }
  | { type: "stdout"; executionId: string; data: string; offset: number }
  | { type: "stderr"; executionId: string; data: string; offset: number }
  | {
      type: "completed";
      executionId: string;
      status: string;
      exitCode?: number;
      result?: unknown;
      error?: string;
      truncated: boolean;
      totalStdoutSize: number;
      totalStderrSize: number;
    }
  | { type: "error"; code: string; message: string; executionId?: string }
  | { type: "ping"; timestamp?: number };

export interface ClientSession {
  id: string;
  metadata: SessionMetadata;
}

export { type SessionMetadata, type ExecutionMetadata };

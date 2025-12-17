/**
 * SSE Protocol types for the tool server
 */

import type { ExecutionStatus } from "./execution";

// SSE Event Types
export type SSEEventType =
  | "started"
  | "stdout"
  | "stderr"
  | "completed"
  | "error"
  | "ping";

// Event data types
export interface StartedEventData {
  executionId: string;
  tool: string;
}

export interface OutputEventData {
  executionId: string;
  data: string;
  offset: number;
}

export interface CompletedEventData {
  executionId: string;
  status: ExecutionStatus;
  exitCode?: number;
  result?: unknown;
  error?: string;
  truncated: boolean;
  totalStdoutSize: number;
  totalStderrSize: number;
}

export interface ErrorEventData {
  executionId?: string;
  code: string;
  message: string;
}

export interface PingEventData {
  timestamp?: number;
}

// Union type for all event data
export type SSEEventData =
  | StartedEventData
  | OutputEventData
  | CompletedEventData
  | ErrorEventData
  | PingEventData;

// SSE Event structure
export interface SSEEvent {
  event: SSEEventType;
  id?: number;
  data: SSEEventData;
}

// API Request/Response types
export interface ExecuteRequest {
  tool: string;
  args: Record<string, unknown>;
  timeout?: number;
  runInBackground?: boolean;
}

export interface ExecuteResponse {
  executionId: string;
  status: "started" | "queued";
}

export interface ExecutionResultResponse {
  executionId: string;
  status: ExecutionStatus;
  result?: unknown;
  error?: string;
  stdout?: string;
  stderr?: string;
  truncated: boolean;
  timing: {
    startedAt: string;
    completedAt?: string;
    durationMs: number;
  };
}

export interface OutputQueryParams {
  stream: "stdout" | "stderr";
  offset?: number;
  limit?: number;
}

export interface OutputQueryResponse {
  executionId: string;
  stream: "stdout" | "stderr";
  data: string;
  offset: number;
  totalSize: number;
  hasMore: boolean;
}

// Error codes
export const ErrorCodes = {
  SESSION_NOT_FOUND: "SESSION_NOT_FOUND",
  SESSION_EXPIRED: "SESSION_EXPIRED",
  EXECUTION_NOT_FOUND: "EXECUTION_NOT_FOUND",
  TOOL_NOT_FOUND: "TOOL_NOT_FOUND",
  INVALID_REQUEST: "INVALID_REQUEST",
  EXECUTION_FAILED: "EXECUTION_FAILED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

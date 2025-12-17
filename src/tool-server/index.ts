/**
 * Tool Server - Main Entry Point
 *
 * A stateful tool server that provides remote tool execution capabilities
 * with persistent session management and real-time streaming output.
 */

// Server exports
export { createServer, type ToolServer } from "./server";
export { loadConfig, getConfig, type ServerConfig } from "./server/config";

// Client exports
export {
  ToolServerClient,
  createClient,
  type ExecutionHandle,
} from "./client";

// Core exports (for advanced usage)
export { SessionManager, getSessionManager } from "./core/session-manager";
export {
  ExecutionManager,
  createExecutionManager,
} from "./core/execution-manager";
export { ProcessManager, createProcessManager } from "./core/process-manager";

// Tool exports
export { toolRegistry, registerTool, getTool, type ToolDefinition } from "./tools/registry";
export { ToolExecutor, createToolExecutor } from "./tools/executor";

// Type exports
export type {
  Session,
  SessionMetadata,
  SessionCreateOptions,
} from "./types/session";
export type {
  ExecutionRecord,
  ExecutionMetadata,
  ExecutionStatus,
  ProcessInfo,
  ProcessMetadata,
} from "./types/execution";
export type {
  SSEEventType,
  SSEEventData,
  StartedEventData,
  OutputEventData,
  CompletedEventData,
  ErrorEventData,
  ExecuteRequest,
  ExecuteResponse,
  ExecutionResultResponse,
  OutputQueryParams,
  OutputQueryResponse,
  ErrorCode,
  ErrorCodes,
} from "./types/protocol";

// Client types
export type {
  ClientConfig,
  CreateSessionOptions,
  ExecuteOptions,
  OutputQueryOptions,
  OutputQueryResult,
  ExecutionResult,
  StreamChunk,
  ClientSession,
} from "./client/types";

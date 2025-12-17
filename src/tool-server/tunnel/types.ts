/**
 * Tunnel Protocol Types
 *
 * Defines the WebSocket message protocol for tunneling tool execution
 * between a remote agent runtime and a local tool server.
 */

import type { ToolDefinition } from "../tools/registry";

// ============================================================================
// Message Types
// ============================================================================

export type TunnelMessageType =
  | "auth_request"
  | "auth_response"
  | "tool_call_request"
  | "tool_call_response"
  | "stream_output"
  | "list_tools_request"
  | "list_tools_response"
  | "cancel_request"
  | "cancel_response"
  | "ping"
  | "pong"
  | "error";

// ============================================================================
// Base Message Structure
// ============================================================================

export interface TunnelMessageBase {
  type: TunnelMessageType;
  id: string; // Unique message ID for request-response correlation
  timestamp: number;
}

// ============================================================================
// Authentication Messages
// ============================================================================

export interface AuthRequest extends TunnelMessageBase {
  type: "auth_request";
  token: string;
  clientInfo: ClientInfo;
}

export interface AuthResponse extends TunnelMessageBase {
  type: "auth_response";
  success: boolean;
  error?: string;
  serverInfo?: ServerInfo;
}

export interface ClientInfo {
  clientId: string;
  version: string;
  tools: string[]; // List of available tool names
  capabilities: ClientCapabilities;
}

export interface ServerInfo {
  serverId: string;
  version: string;
  sessionTimeout: number;
}

export interface ClientCapabilities {
  streaming: boolean;
  batchExecution: boolean;
  cancellation: boolean;
}

// ============================================================================
// Tool Call Messages
// ============================================================================

export interface ToolCallRequest extends TunnelMessageBase {
  type: "tool_call_request";
  callId: string; // Unique ID for this tool call
  tool: string;
  args: Record<string, unknown>;
  timeout?: number;
  streaming?: boolean; // Request streaming output
}

export interface ToolCallResponse extends TunnelMessageBase {
  type: "tool_call_response";
  callId: string;
  status: "success" | "error" | "cancelled" | "timeout";
  result?: string;
  error?: string;
  exitCode?: number;
  timing: {
    startedAt: number;
    completedAt: number;
    durationMs: number;
  };
  output?: {
    stdout: string;
    stderr: string;
    truncated: boolean;
  };
}

export interface StreamOutput extends TunnelMessageBase {
  type: "stream_output";
  callId: string;
  stream: "stdout" | "stderr";
  data: string;
  offset: number;
}

// ============================================================================
// Tool Discovery Messages
// ============================================================================

export interface ListToolsRequest extends TunnelMessageBase {
  type: "list_tools_request";
}

export interface ListToolsResponse extends TunnelMessageBase {
  type: "list_tools_response";
  tools: ToolSchema[];
}

export interface ToolSchema {
  name: string;
  description: string;
  schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// ============================================================================
// Cancellation Messages
// ============================================================================

export interface CancelRequest extends TunnelMessageBase {
  type: "cancel_request";
  callId: string;
}

export interface CancelResponse extends TunnelMessageBase {
  type: "cancel_response";
  callId: string;
  success: boolean;
  error?: string;
}

// ============================================================================
// Keep-Alive Messages
// ============================================================================

export interface PingMessage extends TunnelMessageBase {
  type: "ping";
}

export interface PongMessage extends TunnelMessageBase {
  type: "pong";
}

// ============================================================================
// Error Messages
// ============================================================================

export interface ErrorMessage extends TunnelMessageBase {
  type: "error";
  code: TunnelErrorCode;
  message: string;
  callId?: string; // Optional, if error relates to a specific call
}

export type TunnelErrorCode =
  | "AUTH_FAILED"
  | "INVALID_MESSAGE"
  | "TOOL_NOT_FOUND"
  | "EXECUTION_FAILED"
  | "TIMEOUT"
  | "CONNECTION_ERROR"
  | "INTERNAL_ERROR";

// ============================================================================
// Union Types
// ============================================================================

export type TunnelMessage =
  | AuthRequest
  | AuthResponse
  | ToolCallRequest
  | ToolCallResponse
  | StreamOutput
  | ListToolsRequest
  | ListToolsResponse
  | CancelRequest
  | CancelResponse
  | PingMessage
  | PongMessage
  | ErrorMessage;

// ============================================================================
// Configuration Types
// ============================================================================

export interface TunnelClientConfig {
  /** Remote server URL (WebSocket) */
  serverUrl: string;

  /** Authentication token */
  token: string;

  /** Client identifier */
  clientId?: string;

  /** Reconnection settings */
  reconnect?: {
    enabled: boolean;
    maxAttempts?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
  };

  /** Heartbeat interval in ms (default: 30000) */
  heartbeatIntervalMs?: number;

  /** Connection timeout in ms (default: 10000) */
  connectionTimeoutMs?: number;

  /** Working directory for tool execution */
  workspaceRoot?: string;

  /** Environment variables for tool execution */
  env?: Record<string, string>;
}

export interface TunnelServerConfig {
  /** Port to listen on */
  port: number;

  /** Host to bind to */
  host?: string;

  /** Authentication validation function */
  validateToken?: (token: string) => Promise<boolean>;

  /** Session timeout in ms */
  sessionTimeoutMs?: number;

  /** Ping interval in ms */
  pingIntervalMs?: number;
}

// ============================================================================
// Event Types
// ============================================================================

export type TunnelClientEvent =
  | { type: "connected"; serverInfo: ServerInfo }
  | { type: "disconnected"; reason: string }
  | { type: "reconnecting"; attempt: number }
  | { type: "error"; error: Error }
  | { type: "tool_call_started"; callId: string; tool: string }
  | { type: "tool_call_completed"; callId: string; tool: string; durationMs: number };

export type TunnelServerEvent =
  | { type: "client_connected"; clientId: string; clientInfo: ClientInfo }
  | { type: "client_disconnected"; clientId: string; reason: string }
  | { type: "tool_call_request"; clientId: string; callId: string; tool: string }
  | { type: "tool_call_response"; clientId: string; callId: string; status: string };

// ============================================================================
// Helper Functions
// ============================================================================

let messageCounter = 0;

export function createMessageId(): string {
  return `msg_${Date.now()}_${++messageCounter}`;
}

export function createCallId(): string {
  return `call_${Date.now()}_${++messageCounter}`;
}

export function toolDefinitionToSchema(def: ToolDefinition): ToolSchema {
  return {
    name: def.name,
    description: def.description,
    schema: def.schema,
  };
}

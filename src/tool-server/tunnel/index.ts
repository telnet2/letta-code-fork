/**
 * Tunnel Module - Exports for tunneling tool execution
 */

// Client
export { TunnelClient, createTunnelClient } from "./client";

// Server
export {
  TunnelServer,
  createTunnelServer,
  type ToolCallResult,
  type ToolCallOptions,
} from "./server";

// Authentication
export {
  generateToken,
  validateToken,
  createTokenValidator,
  createCustomTokenValidator,
  generateSecret,
  generateClientId,
  type TokenPayload,
  type TokenValidationResult,
} from "./auth";

// Types
export type {
  // Message types
  TunnelMessageType,
  TunnelMessageBase,
  TunnelMessage,

  // Authentication
  AuthRequest,
  AuthResponse,
  ClientInfo,
  ServerInfo,
  ClientCapabilities,

  // Tool calls
  ToolCallRequest,
  ToolCallResponse,
  StreamOutput,
  ToolSchema,

  // Tool discovery
  ListToolsRequest,
  ListToolsResponse,

  // Cancellation
  CancelRequest,
  CancelResponse,

  // Keep-alive
  PingMessage,
  PongMessage,

  // Errors
  ErrorMessage,
  TunnelErrorCode,

  // Configuration
  TunnelClientConfig,
  TunnelServerConfig,

  // Events
  TunnelClientEvent,
  TunnelServerEvent,
} from "./types";

// Helper functions
export { createMessageId, createCallId, toolDefinitionToSchema } from "./types";

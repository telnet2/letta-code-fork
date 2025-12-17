/**
 * Tunnel Client - Connects to remote agent and executes tools locally
 *
 * This client initiates an outbound WebSocket connection to a remote
 * agent runtime, allowing tool execution behind NAT without exposing
 * local services to the internet.
 */

import {
  type TunnelClientConfig,
  type TunnelMessage,
  type TunnelClientEvent,
  type AuthRequest,
  type AuthResponse,
  type ToolCallRequest,
  type ToolCallResponse,
  type StreamOutput,
  type ListToolsRequest,
  type ListToolsResponse,
  type CancelRequest,
  type CancelResponse,
  type PingMessage,
  type PongMessage,
  type ErrorMessage,
  type ClientInfo,
  type ServerInfo,
  type ToolSchema,
  createMessageId,
  toolDefinitionToSchema,
} from "./types";
import { toolRegistry, type ToolContext, type ToolResult } from "../tools/registry";
import type { Session } from "../types/session";

// ============================================================================
// Types
// ============================================================================

type EventHandler = (event: TunnelClientEvent) => void;

interface PendingExecution {
  callId: string;
  tool: string;
  abortController: AbortController;
  stdoutOffset: number;
  stderrOffset: number;
}

// ============================================================================
// TunnelClient Class
// ============================================================================

export class TunnelClient {
  private config: Required<TunnelClientConfig>;
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: Timer | null = null;
  private heartbeatTimer: Timer | null = null;
  private isConnected = false;
  private isAuthenticated = false;
  private serverInfo: ServerInfo | null = null;
  private eventHandlers: Set<EventHandler> = new Set();
  private pendingExecutions: Map<string, PendingExecution> = new Map();
  private virtualSession: Session;

  constructor(config: TunnelClientConfig) {
    this.config = {
      serverUrl: config.serverUrl,
      token: config.token,
      clientId: config.clientId ?? `tunnel_${Date.now()}`,
      reconnect: {
        enabled: config.reconnect?.enabled ?? true,
        maxAttempts: config.reconnect?.maxAttempts ?? 10,
        initialDelayMs: config.reconnect?.initialDelayMs ?? 1000,
        maxDelayMs: config.reconnect?.maxDelayMs ?? 30000,
      },
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? 30000,
      connectionTimeoutMs: config.connectionTimeoutMs ?? 10000,
      workspaceRoot: config.workspaceRoot ?? process.cwd(),
      env: config.env ?? {},
    };

    // Create a virtual session for tool execution
    this.virtualSession = {
      id: `tunnel_session_${this.config.clientId}`,
      createdAt: new Date(),
      lastAccessedAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000 * 365), // Far future
      workspaceRoot: this.config.workspaceRoot,
      cwd: this.config.workspaceRoot,
      env: this.config.env,
      status: "active",
    };
  }

  // ==========================================================================
  // Connection Management
  // ==========================================================================

  /**
   * Connect to the remote tunnel server
   */
  async connect(): Promise<void> {
    if (this.isConnected) {
      throw new Error("Already connected");
    }

    return new Promise((resolve, reject) => {
      const connectionTimeout = setTimeout(() => {
        reject(new Error("Connection timeout"));
      }, this.config.connectionTimeoutMs);

      try {
        this.ws = new WebSocket(this.config.serverUrl);

        this.ws.onopen = () => {
          clearTimeout(connectionTimeout);
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.authenticate()
            .then(() => {
              this.startHeartbeat();
              resolve();
            })
            .catch(reject);
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.ws.onerror = (error) => {
          clearTimeout(connectionTimeout);
          this.emit({ type: "error", error: new Error("WebSocket error") });
        };

        this.ws.onclose = (event) => {
          clearTimeout(connectionTimeout);
          this.handleDisconnect(event.reason || "Connection closed");
          if (!this.isConnected) {
            reject(new Error("Connection failed"));
          }
        };
      } catch (error) {
        clearTimeout(connectionTimeout);
        reject(error);
      }
    });
  }

  /**
   * Disconnect from the tunnel server
   */
  async disconnect(): Promise<void> {
    this.stopHeartbeat();
    this.stopReconnect();

    // Cancel all pending executions
    for (const execution of this.pendingExecutions.values()) {
      execution.abortController.abort();
    }
    this.pendingExecutions.clear();

    if (this.ws) {
      this.ws.close(1000, "Client disconnect");
      this.ws = null;
    }

    this.isConnected = false;
    this.isAuthenticated = false;
  }

  /**
   * Check if connected
   */
  get connected(): boolean {
    return this.isConnected && this.isAuthenticated;
  }

  /**
   * Get server info (available after authentication)
   */
  getServerInfo(): ServerInfo | null {
    return this.serverInfo;
  }

  // ==========================================================================
  // Event Handling
  // ==========================================================================

  /**
   * Subscribe to tunnel events
   */
  on(handler: EventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  private emit(event: TunnelClientEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error("Event handler error:", error);
      }
    }
  }

  // ==========================================================================
  // Message Handling
  // ==========================================================================

  private handleMessage(data: string): void {
    let message: TunnelMessage;
    try {
      message = JSON.parse(data);
    } catch (error) {
      console.error("Failed to parse message:", error);
      return;
    }

    switch (message.type) {
      case "auth_response":
        // Handled in authenticate()
        break;

      case "tool_call_request":
        this.handleToolCallRequest(message as ToolCallRequest);
        break;

      case "list_tools_request":
        this.handleListToolsRequest(message as ListToolsRequest);
        break;

      case "cancel_request":
        this.handleCancelRequest(message as CancelRequest);
        break;

      case "ping":
        this.handlePing(message as PingMessage);
        break;

      case "pong":
        // Response to our ping, connection is alive
        break;

      case "error":
        this.handleError(message as ErrorMessage);
        break;

      default:
        console.warn("Unknown message type:", (message as TunnelMessage).type);
    }
  }

  private async handleToolCallRequest(request: ToolCallRequest): Promise<void> {
    const { callId, tool, args, timeout, streaming } = request;

    this.emit({ type: "tool_call_started", callId, tool });

    const startedAt = Date.now();
    const abortController = new AbortController();

    // Track pending execution
    const execution: PendingExecution = {
      callId,
      tool,
      abortController,
      stdoutOffset: 0,
      stderrOffset: 0,
    };
    this.pendingExecutions.set(callId, execution);

    // Get tool definition
    const toolDef = toolRegistry.get(tool);
    if (!toolDef) {
      this.sendToolCallResponse({
        callId,
        status: "error",
        error: `Tool not found: ${tool}`,
        timing: {
          startedAt,
          completedAt: Date.now(),
          durationMs: Date.now() - startedAt,
        },
      });
      this.pendingExecutions.delete(callId);
      return;
    }

    // Build tool context
    const context: ToolContext = {
      session: this.virtualSession,
      cwd: this.virtualSession.cwd,
      env: { ...process.env, ...this.virtualSession.env } as Record<string, string>,
      signal: abortController.signal,
      onStdout: streaming
        ? (data) => {
            this.sendStreamOutput(callId, "stdout", data, execution.stdoutOffset);
            execution.stdoutOffset += data.length;
          }
        : undefined,
      onStderr: streaming
        ? (data) => {
            this.sendStreamOutput(callId, "stderr", data, execution.stderrOffset);
            execution.stderrOffset += data.length;
          }
        : undefined,
    };

    // Set up timeout
    const timeoutMs = timeout ?? 120000;
    const timeoutTimer = setTimeout(() => {
      abortController.abort();
    }, timeoutMs);

    let result: ToolResult;
    let stdout = "";
    let stderr = "";

    // Capture output if not streaming
    if (!streaming) {
      context.onStdout = (data) => {
        stdout += data;
      };
      context.onStderr = (data) => {
        stderr += data;
      };
    }

    try {
      result = await toolDef.implementation(args, context);
    } catch (error) {
      result = {
        content: error instanceof Error ? error.message : "Unknown error",
        status: "error",
        exitCode: 1,
      };
    } finally {
      clearTimeout(timeoutTimer);
      this.pendingExecutions.delete(callId);
    }

    const completedAt = Date.now();
    const isTimeout = abortController.signal.aborted;

    this.sendToolCallResponse({
      callId,
      status: isTimeout ? "timeout" : result.status === "success" ? "success" : "error",
      result: result.content,
      error: result.status === "error" ? result.content : undefined,
      exitCode: result.exitCode,
      timing: {
        startedAt,
        completedAt,
        durationMs: completedAt - startedAt,
      },
      output: !streaming
        ? {
            stdout,
            stderr,
            truncated: stdout.length > 30000 || stderr.length > 30000,
          }
        : undefined,
    });

    this.emit({
      type: "tool_call_completed",
      callId,
      tool,
      durationMs: completedAt - startedAt,
    });
  }

  private handleListToolsRequest(request: ListToolsRequest): void {
    const tools: ToolSchema[] = toolRegistry.list().map(toolDefinitionToSchema);

    const response: ListToolsResponse = {
      type: "list_tools_response",
      id: createMessageId(),
      timestamp: Date.now(),
      tools,
    };

    this.send(response);
  }

  private handleCancelRequest(request: CancelRequest): void {
    const { callId } = request;
    const execution = this.pendingExecutions.get(callId);

    let success = false;
    let error: string | undefined;

    if (execution) {
      execution.abortController.abort();
      success = true;
    } else {
      error = `No pending execution with callId: ${callId}`;
    }

    const response: CancelResponse = {
      type: "cancel_response",
      id: createMessageId(),
      timestamp: Date.now(),
      callId,
      success,
      error,
    };

    this.send(response);
  }

  private handlePing(message: PingMessage): void {
    const pong: PongMessage = {
      type: "pong",
      id: createMessageId(),
      timestamp: Date.now(),
    };
    this.send(pong);
  }

  private handleError(message: ErrorMessage): void {
    console.error(`Tunnel error [${message.code}]: ${message.message}`);
    this.emit({ type: "error", error: new Error(message.message) });
  }

  // ==========================================================================
  // Authentication
  // ==========================================================================

  private async authenticate(): Promise<void> {
    return new Promise((resolve, reject) => {
      const authTimeout = setTimeout(() => {
        reject(new Error("Authentication timeout"));
      }, 10000);

      const authRequest: AuthRequest = {
        type: "auth_request",
        id: createMessageId(),
        timestamp: Date.now(),
        token: this.config.token,
        clientInfo: {
          clientId: this.config.clientId,
          version: "1.0.0",
          tools: toolRegistry.names(),
          capabilities: {
            streaming: true,
            batchExecution: false,
            cancellation: true,
          },
        },
      };

      // Set up one-time handler for auth response
      const originalHandler = this.ws!.onmessage;
      this.ws!.onmessage = (event) => {
        try {
          const response: TunnelMessage = JSON.parse(event.data);
          if (response.type === "auth_response") {
            clearTimeout(authTimeout);
            this.ws!.onmessage = originalHandler;

            const authResponse = response as AuthResponse;
            if (authResponse.success) {
              this.isAuthenticated = true;
              this.serverInfo = authResponse.serverInfo ?? null;
              this.emit({
                type: "connected",
                serverInfo: this.serverInfo!,
              });
              resolve();
            } else {
              reject(new Error(authResponse.error ?? "Authentication failed"));
            }
          }
        } catch (error) {
          // Not our message, pass it on
          originalHandler?.call(this.ws, event);
        }
      };

      this.send(authRequest);
    });
  }

  // ==========================================================================
  // Sending Messages
  // ==========================================================================

  private send(message: TunnelMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("Cannot send message: not connected");
      return;
    }

    this.ws.send(JSON.stringify(message));
  }

  private sendToolCallResponse(params: {
    callId: string;
    status: "success" | "error" | "cancelled" | "timeout";
    result?: string;
    error?: string;
    exitCode?: number;
    timing: { startedAt: number; completedAt: number; durationMs: number };
    output?: { stdout: string; stderr: string; truncated: boolean };
  }): void {
    const response: ToolCallResponse = {
      type: "tool_call_response",
      id: createMessageId(),
      timestamp: Date.now(),
      ...params,
    };

    this.send(response);
  }

  private sendStreamOutput(
    callId: string,
    stream: "stdout" | "stderr",
    data: string,
    offset: number
  ): void {
    const message: StreamOutput = {
      type: "stream_output",
      id: createMessageId(),
      timestamp: Date.now(),
      callId,
      stream,
      data,
      offset,
    };

    this.send(message);
  }

  // ==========================================================================
  // Heartbeat
  // ==========================================================================

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      const ping: PingMessage = {
        type: "ping",
        id: createMessageId(),
        timestamp: Date.now(),
      };
      this.send(ping);
    }, this.config.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ==========================================================================
  // Reconnection
  // ==========================================================================

  private handleDisconnect(reason: string): void {
    this.isConnected = false;
    this.isAuthenticated = false;
    this.stopHeartbeat();

    this.emit({ type: "disconnected", reason });

    if (this.config.reconnect.enabled) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.config.reconnect.maxAttempts) {
      console.error("Max reconnection attempts reached");
      return;
    }

    const delay = Math.min(
      this.config.reconnect.initialDelayMs * Math.pow(2, this.reconnectAttempts),
      this.config.reconnect.maxDelayMs
    );

    this.reconnectAttempts++;
    this.emit({ type: "reconnecting", attempt: this.reconnectAttempts });

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
      } catch (error) {
        // Will trigger handleDisconnect -> scheduleReconnect again
      }
    }, delay);
  }

  private stopReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ==========================================================================
  // Session Management
  // ==========================================================================

  /**
   * Update the working directory for tool execution
   */
  setCwd(cwd: string): void {
    this.virtualSession.cwd = cwd;
  }

  /**
   * Update environment variables for tool execution
   */
  setEnv(env: Record<string, string>): void {
    this.virtualSession.env = { ...this.virtualSession.env, ...env };
  }

  /**
   * Get list of available tools
   */
  getTools(): ToolSchema[] {
    return toolRegistry.list().map(toolDefinitionToSchema);
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new tunnel client instance
 */
export function createTunnelClient(config: TunnelClientConfig): TunnelClient {
  return new TunnelClient(config);
}

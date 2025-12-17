/**
 * Tunnel Server - Accepts connections from tunnel clients and provides
 * a tool execution interface for LLM agents
 *
 * This server runs on the remote agent runtime and allows LLM agents
 * to execute tools on connected tunnel clients.
 */

import type { Server, ServerWebSocket } from "bun";
import {
  type TunnelServerConfig,
  type TunnelMessage,
  type TunnelServerEvent,
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
  type TunnelErrorCode,
  createMessageId,
  createCallId,
} from "./types";

// ============================================================================
// Types
// ============================================================================

type EventHandler = (event: TunnelServerEvent) => void;

interface ConnectedClient {
  id: string;
  ws: ServerWebSocket<ClientData>;
  info: ClientInfo;
  tools: Map<string, ToolSchema>;
  authenticatedAt: Date;
  lastActivity: Date;
}

interface ClientData {
  clientId?: string;
  authenticated: boolean;
}

interface PendingToolCall {
  callId: string;
  clientId: string;
  tool: string;
  resolve: (response: ToolCallResult) => void;
  reject: (error: Error) => void;
  timeout: Timer;
  streaming?: boolean;
  onOutput?: (stream: "stdout" | "stderr", data: string, offset: number) => void;
}

export interface ToolCallResult {
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

export interface ToolCallOptions {
  /** Timeout in milliseconds (default: 120000) */
  timeout?: number;

  /** Enable streaming output */
  streaming?: boolean;

  /** Callback for streaming output */
  onOutput?: (stream: "stdout" | "stderr", data: string, offset: number) => void;
}

// ============================================================================
// TunnelServer Class
// ============================================================================

export class TunnelServer {
  private config: Required<TunnelServerConfig>;
  private server: Server | null = null;
  private clients: Map<string, ConnectedClient> = new Map();
  private pendingCalls: Map<string, PendingToolCall> = new Map();
  private eventHandlers: Set<EventHandler> = new Set();
  private pingTimer: Timer | null = null;

  constructor(config: TunnelServerConfig) {
    this.config = {
      port: config.port,
      host: config.host ?? "0.0.0.0",
      validateToken: config.validateToken ?? (async () => true),
      sessionTimeoutMs: config.sessionTimeoutMs ?? 3600000, // 1 hour
      pingIntervalMs: config.pingIntervalMs ?? 30000,
    };
  }

  // ==========================================================================
  // Server Lifecycle
  // ==========================================================================

  /**
   * Start the tunnel server
   */
  async start(): Promise<void> {
    const self = this;

    this.server = Bun.serve({
      port: this.config.port,
      hostname: this.config.host,

      fetch(req, server) {
        const url = new URL(req.url);

        // Health check endpoint
        if (url.pathname === "/health") {
          return new Response(
            JSON.stringify({
              status: "healthy",
              connectedClients: self.clients.size,
              timestamp: new Date().toISOString(),
            }),
            {
              headers: { "Content-Type": "application/json" },
            }
          );
        }

        // REST API for tool management
        if (url.pathname === "/api/tools") {
          const allTools = self.getAllTools();
          return new Response(JSON.stringify(allTools), {
            headers: { "Content-Type": "application/json" },
          });
        }

        if (url.pathname === "/api/clients") {
          const clients = Array.from(self.clients.values()).map((c) => ({
            id: c.id,
            tools: Array.from(c.tools.keys()),
            connectedAt: c.authenticatedAt.toISOString(),
            lastActivity: c.lastActivity.toISOString(),
          }));
          return new Response(JSON.stringify(clients), {
            headers: { "Content-Type": "application/json" },
          });
        }

        // WebSocket upgrade for tunnel connections
        if (url.pathname === "/tunnel") {
          const upgraded = server.upgrade(req, {
            data: { authenticated: false } as ClientData,
          });
          if (!upgraded) {
            return new Response("WebSocket upgrade failed", { status: 400 });
          }
          return undefined;
        }

        return new Response("Not Found", { status: 404 });
      },

      websocket: {
        open(ws) {
          // Wait for authentication
        },

        message(ws, message) {
          const data =
            typeof message === "string" ? message : new TextDecoder().decode(message);
          self.handleMessage(ws, data);
        },

        close(ws, code, reason) {
          const clientId = ws.data.clientId;
          if (clientId) {
            self.handleClientDisconnect(clientId, reason || "Connection closed");
          }
        },
      },
    });

    // Start ping timer
    this.pingTimer = setInterval(() => {
      this.pingAllClients();
    }, this.config.pingIntervalMs);

    console.log(`Tunnel server listening on ${this.config.host}:${this.config.port}`);
  }

  /**
   * Stop the tunnel server
   */
  async stop(): Promise<void> {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }

    // Cancel all pending calls
    for (const call of this.pendingCalls.values()) {
      clearTimeout(call.timeout);
      call.reject(new Error("Server shutting down"));
    }
    this.pendingCalls.clear();

    // Close all client connections
    for (const client of this.clients.values()) {
      client.ws.close(1001, "Server shutting down");
    }
    this.clients.clear();

    if (this.server) {
      this.server.stop();
      this.server = null;
    }
  }

  /**
   * Get server URL
   */
  getUrl(): string {
    return `ws://${this.config.host}:${this.config.port}/tunnel`;
  }

  // ==========================================================================
  // Event Handling
  // ==========================================================================

  /**
   * Subscribe to server events
   */
  on(handler: EventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  private emit(event: TunnelServerEvent): void {
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

  private handleMessage(ws: ServerWebSocket<ClientData>, data: string): void {
    let message: TunnelMessage;
    try {
      message = JSON.parse(data);
    } catch (error) {
      this.sendError(ws, "INVALID_MESSAGE", "Failed to parse message");
      return;
    }

    // Handle authentication first if not authenticated
    if (!ws.data.authenticated && message.type !== "auth_request") {
      this.sendError(ws, "AUTH_FAILED", "Not authenticated");
      return;
    }

    switch (message.type) {
      case "auth_request":
        this.handleAuthRequest(ws, message as AuthRequest);
        break;

      case "tool_call_response":
        this.handleToolCallResponse(message as ToolCallResponse);
        break;

      case "stream_output":
        this.handleStreamOutput(message as StreamOutput);
        break;

      case "list_tools_response":
        this.handleListToolsResponse(ws, message as ListToolsResponse);
        break;

      case "cancel_response":
        this.handleCancelResponse(message as CancelResponse);
        break;

      case "pong":
        this.handlePong(ws);
        break;

      default:
        console.warn("Unknown message type:", (message as TunnelMessage).type);
    }
  }

  private async handleAuthRequest(
    ws: ServerWebSocket<ClientData>,
    request: AuthRequest
  ): Promise<void> {
    const { token, clientInfo } = request;

    // Validate token
    const isValid = await this.config.validateToken(token);
    if (!isValid) {
      const response: AuthResponse = {
        type: "auth_response",
        id: createMessageId(),
        timestamp: Date.now(),
        success: false,
        error: "Invalid token",
      };
      ws.send(JSON.stringify(response));
      ws.close(1008, "Authentication failed");
      return;
    }

    // Store client connection
    ws.data.authenticated = true;
    ws.data.clientId = clientInfo.clientId;

    const toolMap = new Map<string, ToolSchema>();
    // Request full tool list from client
    this.requestToolList(ws);

    const client: ConnectedClient = {
      id: clientInfo.clientId,
      ws,
      info: clientInfo,
      tools: toolMap,
      authenticatedAt: new Date(),
      lastActivity: new Date(),
    };

    this.clients.set(clientInfo.clientId, client);

    // Send success response
    const response: AuthResponse = {
      type: "auth_response",
      id: createMessageId(),
      timestamp: Date.now(),
      success: true,
      serverInfo: {
        serverId: "tunnel-server",
        version: "1.0.0",
        sessionTimeout: this.config.sessionTimeoutMs,
      },
    };
    ws.send(JSON.stringify(response));

    this.emit({
      type: "client_connected",
      clientId: clientInfo.clientId,
      clientInfo,
    });
  }

  private handleToolCallResponse(response: ToolCallResponse): void {
    const { callId } = response;
    const pendingCall = this.pendingCalls.get(callId);

    if (!pendingCall) {
      console.warn(`Received response for unknown call: ${callId}`);
      return;
    }

    // Clear timeout
    clearTimeout(pendingCall.timeout);
    this.pendingCalls.delete(callId);

    // Update client activity
    const client = this.clients.get(pendingCall.clientId);
    if (client) {
      client.lastActivity = new Date();
    }

    // Resolve the promise
    pendingCall.resolve({
      status: response.status,
      result: response.result,
      error: response.error,
      exitCode: response.exitCode,
      timing: response.timing,
      output: response.output,
    });

    this.emit({
      type: "tool_call_response",
      clientId: pendingCall.clientId,
      callId,
      status: response.status,
    });
  }

  private handleStreamOutput(message: StreamOutput): void {
    const { callId, stream, data, offset } = message;
    const pendingCall = this.pendingCalls.get(callId);

    if (pendingCall?.onOutput) {
      pendingCall.onOutput(stream, data, offset);
    }
  }

  private handleListToolsResponse(
    ws: ServerWebSocket<ClientData>,
    response: ListToolsResponse
  ): void {
    const clientId = ws.data.clientId;
    if (!clientId) return;

    const client = this.clients.get(clientId);
    if (!client) return;

    // Update tools
    client.tools.clear();
    for (const tool of response.tools) {
      client.tools.set(tool.name, tool);
    }

    // Update client info
    client.info.tools = response.tools.map((t) => t.name);
  }

  private handleCancelResponse(response: CancelResponse): void {
    // Acknowledgement, no action needed
  }

  private handlePong(ws: ServerWebSocket<ClientData>): void {
    const clientId = ws.data.clientId;
    if (!clientId) return;

    const client = this.clients.get(clientId);
    if (client) {
      client.lastActivity = new Date();
    }
  }

  private handleClientDisconnect(clientId: string, reason: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    // Cancel all pending calls for this client
    for (const [callId, call] of this.pendingCalls.entries()) {
      if (call.clientId === clientId) {
        clearTimeout(call.timeout);
        call.reject(new Error("Client disconnected"));
        this.pendingCalls.delete(callId);
      }
    }

    this.clients.delete(clientId);
    this.emit({ type: "client_disconnected", clientId, reason });
  }

  // ==========================================================================
  // Tool Execution API (for LLM agents)
  // ==========================================================================

  /**
   * Execute a tool on a connected client
   */
  async executeTool(
    tool: string,
    args: Record<string, unknown>,
    options: ToolCallOptions = {}
  ): Promise<ToolCallResult> {
    // Find a client that has this tool
    const client = this.findClientWithTool(tool);
    if (!client) {
      return {
        status: "error",
        error: `No client available with tool: ${tool}`,
        timing: {
          startedAt: Date.now(),
          completedAt: Date.now(),
          durationMs: 0,
        },
      };
    }

    return this.executeToolOnClient(client.id, tool, args, options);
  }

  /**
   * Execute a tool on a specific client
   */
  async executeToolOnClient(
    clientId: string,
    tool: string,
    args: Record<string, unknown>,
    options: ToolCallOptions = {}
  ): Promise<ToolCallResult> {
    const client = this.clients.get(clientId);
    if (!client) {
      return {
        status: "error",
        error: `Client not found: ${clientId}`,
        timing: {
          startedAt: Date.now(),
          completedAt: Date.now(),
          durationMs: 0,
        },
      };
    }

    const callId = createCallId();
    const timeout = options.timeout ?? 120000;

    const request: ToolCallRequest = {
      type: "tool_call_request",
      id: createMessageId(),
      timestamp: Date.now(),
      callId,
      tool,
      args,
      timeout,
      streaming: options.streaming,
    };

    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeoutTimer = setTimeout(() => {
        this.pendingCalls.delete(callId);
        resolve({
          status: "timeout",
          error: "Tool call timed out",
          timing: {
            startedAt: request.timestamp,
            completedAt: Date.now(),
            durationMs: timeout,
          },
        });
      }, timeout);

      // Store pending call
      this.pendingCalls.set(callId, {
        callId,
        clientId,
        tool,
        resolve,
        reject,
        timeout: timeoutTimer,
        streaming: options.streaming,
        onOutput: options.onOutput,
      });

      // Send request
      client.ws.send(JSON.stringify(request));

      this.emit({
        type: "tool_call_request",
        clientId,
        callId,
        tool,
      });
    });
  }

  /**
   * Cancel a pending tool call
   */
  async cancelToolCall(callId: string): Promise<boolean> {
    const pendingCall = this.pendingCalls.get(callId);
    if (!pendingCall) {
      return false;
    }

    const client = this.clients.get(pendingCall.clientId);
    if (!client) {
      return false;
    }

    const request: CancelRequest = {
      type: "cancel_request",
      id: createMessageId(),
      timestamp: Date.now(),
      callId,
    };

    client.ws.send(JSON.stringify(request));
    return true;
  }

  // ==========================================================================
  // Tool Discovery API
  // ==========================================================================

  /**
   * Get all available tools from all connected clients
   */
  getAllTools(): ToolSchema[] {
    const toolMap = new Map<string, ToolSchema>();

    for (const client of this.clients.values()) {
      for (const [name, tool] of client.tools) {
        if (!toolMap.has(name)) {
          toolMap.set(name, tool);
        }
      }
    }

    return Array.from(toolMap.values());
  }

  /**
   * Get tools available from a specific client
   */
  getClientTools(clientId: string): ToolSchema[] {
    const client = this.clients.get(clientId);
    if (!client) return [];
    return Array.from(client.tools.values());
  }

  /**
   * Find a client that has a specific tool
   */
  findClientWithTool(toolName: string): ConnectedClient | undefined {
    for (const client of this.clients.values()) {
      if (client.tools.has(toolName) || client.info.tools.includes(toolName)) {
        return client;
      }
    }
    return undefined;
  }

  /**
   * Get list of connected clients
   */
  getConnectedClients(): Array<{ id: string; tools: string[] }> {
    return Array.from(this.clients.values()).map((c) => ({
      id: c.id,
      tools: Array.from(c.tools.keys()),
    }));
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  private requestToolList(ws: ServerWebSocket<ClientData>): void {
    const request: ListToolsRequest = {
      type: "list_tools_request",
      id: createMessageId(),
      timestamp: Date.now(),
    };
    ws.send(JSON.stringify(request));
  }

  private pingAllClients(): void {
    const ping: PingMessage = {
      type: "ping",
      id: createMessageId(),
      timestamp: Date.now(),
    };
    const message = JSON.stringify(ping);

    for (const client of this.clients.values()) {
      try {
        client.ws.send(message);
      } catch (error) {
        // Client might have disconnected
      }
    }
  }

  private sendError(
    ws: ServerWebSocket<ClientData>,
    code: TunnelErrorCode,
    message: string,
    callId?: string
  ): void {
    const error: ErrorMessage = {
      type: "error",
      id: createMessageId(),
      timestamp: Date.now(),
      code,
      message,
      callId,
    };
    ws.send(JSON.stringify(error));
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new tunnel server instance
 */
export function createTunnelServer(config: TunnelServerConfig): TunnelServer {
  return new TunnelServer(config);
}

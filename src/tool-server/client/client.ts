/**
 * Tool Server Client - Main client class
 */

import type {
  ClientConfig,
  CreateSessionOptions,
  ExecuteOptions,
  OutputQueryResult,
  ExecutionResult,
  ClientSession,
  SessionMetadata,
  ExecutionMetadata,
} from "./types";
import { createStreamingExecution, createSyncExecution, type ExecutionHandle } from "./execution";

export class ToolServerClient {
  private baseUrl: string;
  private sessionId: string | null = null;
  private timeout: number;

  constructor(config: ClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, ""); // Remove trailing slash
    this.sessionId = config.sessionId || null;
    this.timeout = config.timeout || 120000;
  }

  /**
   * Create a new session or connect to existing one
   */
  async connect(options?: CreateSessionOptions): Promise<ClientSession> {
    if (this.sessionId) {
      // Try to get existing session
      const session = await this.getSession();
      if (session) {
        return session;
      }
      // Session doesn't exist, create new one
    }

    const session = await this.createSession(options);
    this.sessionId = session.id;
    return session;
  }

  /**
   * Create a new session
   */
  async createSession(options?: CreateSessionOptions): Promise<ClientSession> {
    const res = await fetch(`${this.baseUrl}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options || {}),
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(`Failed to create session: ${error.message || res.status}`);
    }

    const metadata: SessionMetadata = await res.json();
    this.sessionId = metadata.id;
    return { id: metadata.id, metadata };
  }

  /**
   * Get current session
   */
  async getSession(): Promise<ClientSession | null> {
    this.ensureSession();

    const res = await fetch(`${this.baseUrl}/api/sessions/${this.sessionId}`);

    if (res.status === 404) {
      return null;
    }

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(`Failed to get session: ${error.message || res.status}`);
    }

    const metadata: SessionMetadata = await res.json();
    return { id: metadata.id, metadata };
  }

  /**
   * Close the current session
   */
  async close(): Promise<void> {
    this.ensureSession();

    const res = await fetch(`${this.baseUrl}/api/sessions/${this.sessionId}`, {
      method: "DELETE",
    });

    if (!res.ok && res.status !== 404) {
      const error = await res.json().catch(() => ({}));
      throw new Error(`Failed to close session: ${error.message || res.status}`);
    }

    this.sessionId = null;
  }

  /**
   * Extend session expiry
   */
  async extend(days?: number): Promise<SessionMetadata> {
    this.ensureSession();

    const res = await fetch(
      `${this.baseUrl}/api/sessions/${this.sessionId}/extend`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days }),
      }
    );

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(`Failed to extend session: ${error.message || res.status}`);
    }

    return res.json();
  }

  /**
   * Execute a tool
   */
  async execute(
    tool: string,
    args: Record<string, unknown>,
    options?: ExecuteOptions
  ): Promise<ExecutionHandle> {
    this.ensureSession();

    const stream = options?.stream ?? true;
    const timeout = options?.timeout ?? this.timeout;

    if (stream) {
      return this.executeStream(tool, args, timeout);
    } else {
      return this.executeSync(tool, args, timeout);
    }
  }

  /**
   * Execute with SSE streaming
   */
  private async executeStream(
    tool: string,
    args: Record<string, unknown>,
    timeout: number
  ): Promise<ExecutionHandle> {
    const res = await fetch(
      `${this.baseUrl}/api/sessions/${this.sessionId}/execute/stream`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({ tool, args, timeout }),
      }
    );

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(`Failed to execute tool: ${error.message || res.status}`);
    }

    // Parse the first event to get execution ID
    // For now, use a placeholder - the actual ID will come from the stream
    return createStreamingExecution(
      "pending", // Will be updated from stream
      tool,
      res,
      this.baseUrl,
      this.sessionId!
    );
  }

  /**
   * Execute synchronously (wait for completion)
   */
  private async executeSync(
    tool: string,
    args: Record<string, unknown>,
    timeout: number
  ): Promise<ExecutionHandle> {
    const res = await fetch(
      `${this.baseUrl}/api/sessions/${this.sessionId}/execute`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool, args, timeout }),
      }
    );

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(`Failed to execute tool: ${error.message || res.status}`);
    }

    const result: ExecutionResult = await res.json();
    return createSyncExecution(result, tool, this.baseUrl, this.sessionId!);
  }

  /**
   * Cancel an execution
   */
  async cancel(executionId: string): Promise<boolean> {
    this.ensureSession();

    const res = await fetch(
      `${this.baseUrl}/api/sessions/${this.sessionId}/executions/${executionId}`,
      { method: "DELETE" }
    );

    return res.status === 204;
  }

  /**
   * Query execution output with pagination
   */
  async queryOutput(
    executionId: string,
    options: { stream: "stdout" | "stderr"; offset?: number; limit?: number }
  ): Promise<OutputQueryResult> {
    this.ensureSession();

    const params = new URLSearchParams();
    params.set("stream", options.stream);
    if (options.offset !== undefined) {
      params.set("offset", String(options.offset));
    }
    if (options.limit !== undefined) {
      params.set("limit", String(options.limit));
    }

    const res = await fetch(
      `${this.baseUrl}/api/sessions/${this.sessionId}/executions/${executionId}/output?${params}`
    );

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(`Failed to query output: ${error.message || res.status}`);
    }

    return res.json();
  }

  /**
   * Get execution details
   */
  async getExecution(executionId: string): Promise<ExecutionMetadata | null> {
    this.ensureSession();

    const res = await fetch(
      `${this.baseUrl}/api/sessions/${this.sessionId}/executions/${executionId}`
    );

    if (res.status === 404) {
      return null;
    }

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(`Failed to get execution: ${error.message || res.status}`);
    }

    return res.json();
  }

  /**
   * List all executions
   */
  async listExecutions(): Promise<ExecutionMetadata[]> {
    this.ensureSession();

    const res = await fetch(
      `${this.baseUrl}/api/sessions/${this.sessionId}/executions`
    );

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(`Failed to list executions: ${error.message || res.status}`);
    }

    const data = await res.json();
    return data.executions;
  }

  /**
   * Get available tools
   */
  async listTools(): Promise<Array<{ name: string; description: string; schema: unknown }>> {
    const res = await fetch(`${this.baseUrl}/api/tools`);

    if (!res.ok) {
      throw new Error(`Failed to list tools: ${res.status}`);
    }

    const data = await res.json();
    return data.tools;
  }

  /**
   * Health check
   */
  async health(): Promise<{ status: string; tools: string[]; timestamp: string }> {
    const res = await fetch(`${this.baseUrl}/health`);

    if (!res.ok) {
      throw new Error(`Health check failed: ${res.status}`);
    }

    return res.json();
  }

  /**
   * Get current session ID
   */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Set session ID (for resuming a session)
   */
  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  /**
   * Ensure we have an active session
   */
  private ensureSession(): void {
    if (!this.sessionId) {
      throw new Error("No active session. Call connect() first.");
    }
  }
}

/**
 * Create a tool server client
 */
export function createClient(config: ClientConfig): ToolServerClient {
  return new ToolServerClient(config);
}

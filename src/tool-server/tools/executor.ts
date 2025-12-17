/**
 * Tool Executor - Session-aware tool execution wrapper
 */

import type { Session } from "../types/session";
import type { ExecutionRecord } from "../types/execution";
import { ExecutionManager } from "../core/execution-manager";
import { ProcessManager } from "../core/process-manager";
import { toolRegistry, type ToolResult, type ToolContext } from "./registry";

export interface ExecutorOptions {
  timeout?: number;
  signal?: AbortSignal;
}

export interface ExecutionHandle {
  execution: ExecutionRecord;
  result: Promise<ToolResult>;
}

export class ToolExecutor {
  constructor(
    private session: Session,
    private executionManager: ExecutionManager,
    private processManager: ProcessManager
  ) {}

  /**
   * Execute a tool
   */
  async execute(
    toolName: string,
    args: Record<string, unknown>,
    options: ExecutorOptions = {}
  ): Promise<ExecutionHandle> {
    // Get tool definition
    const tool = toolRegistry.get(toolName);
    if (!tool) {
      throw new Error(`Tool not found: ${toolName}`);
    }

    // Create execution record
    const execution = await this.executionManager.createExecution(
      this.session.id,
      toolName,
      args
    );

    // Build context
    const context: ToolContext = {
      session: this.session,
      cwd: this.session.cwd,
      env: { ...process.env, ...this.session.env } as Record<string, string>,
      signal: options.signal,
      onStdout: (data) => {
        this.executionManager.appendOutput(execution.id, "stdout", data);
      },
      onStderr: (data) => {
        this.executionManager.appendOutput(execution.id, "stderr", data);
      },
    };

    // Mark as started
    await this.executionManager.markStarted(execution.id);

    // Execute the tool
    const result = this.executeWithTimeout(
      execution.id,
      tool.implementation,
      args,
      context,
      options.timeout
    );

    return { execution, result };
  }

  /**
   * Execute with timeout handling
   */
  private async executeWithTimeout(
    executionId: string,
    implementation: (
      args: Record<string, unknown>,
      context: ToolContext
    ) => Promise<ToolResult>,
    args: Record<string, unknown>,
    context: ToolContext,
    timeout?: number
  ): Promise<ToolResult> {
    const controller = new AbortController();
    const timeoutMs = timeout ?? 120000;

    // Combine with provided signal
    if (context.signal) {
      context.signal.addEventListener("abort", () => controller.abort());
    }

    // Set up timeout
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    // Update context with combined signal
    const execContext: ToolContext = {
      ...context,
      signal: controller.signal,
    };

    try {
      const result = await implementation(args, execContext);

      // Update execution record
      if (result.status === "success") {
        await this.executionManager.markCompleted(
          executionId,
          result.content,
          result.exitCode ?? 0
        );
      } else {
        await this.executionManager.markFailed(
          executionId,
          result.content,
          result.exitCode ?? 1
        );
      }

      return result;
    } catch (error) {
      const isAborted = controller.signal.aborted;
      const errorMessage = isAborted
        ? "Execution timed out or was cancelled"
        : error instanceof Error
          ? error.message
          : "Unknown error";

      if (isAborted) {
        await this.executionManager.markCancelled(executionId);
      } else {
        await this.executionManager.markFailed(executionId, errorMessage);
      }

      return {
        content: errorMessage,
        status: "error",
        exitCode: 1,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Cancel an execution
   */
  async cancel(executionId: string): Promise<boolean> {
    const execution = await this.executionManager.getExecution(executionId);
    if (!execution || execution.status !== "running") {
      return false;
    }

    // Try to kill associated process
    const processInfo = await this.processManager.getProcessByExecutionId(
      executionId
    );
    if (processInfo) {
      await this.processManager.killProcess(processInfo.id);
    }

    await this.executionManager.markCancelled(executionId);
    return true;
  }

  /**
   * Get process manager for background process operations
   */
  getProcessManager(): ProcessManager {
    return this.processManager;
  }
}

/**
 * Create a tool executor for a session
 */
export function createToolExecutor(
  session: Session,
  executionManager: ExecutionManager,
  processManager: ProcessManager
): ToolExecutor {
  return new ToolExecutor(session, executionManager, processManager);
}

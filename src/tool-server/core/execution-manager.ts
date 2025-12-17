/**
 * Execution Manager - Handles tool execution tracking and output storage
 */

import { join } from "path";
import { randomUUID } from "crypto";
import { getConfig } from "../server/config";
import {
  type ExecutionRecord,
  type ExecutionMetadata,
  type ExecutionStatus,
  executionToMetadata,
  metadataToExecution,
} from "../types/execution";
import {
  readJson,
  writeJson,
  appendFile,
  readFileRange,
  deleteDir,
  listDir,
  getFileSize,
} from "./storage";

const EXECUTIONS_DIR = "executions";
const EXECUTION_FILE = "meta.json";
const STDOUT_FILE = "stdout.log";
const STDERR_FILE = "stderr.log";

export type OutputChunkCallback = (
  stream: "stdout" | "stderr",
  data: string,
  offset: number
) => void;

export class ExecutionManager {
  // In-memory cache of active executions
  private executions: Map<string, ExecutionRecord> = new Map();

  // Callbacks for streaming output
  private outputCallbacks: Map<string, OutputChunkCallback[]> = new Map();

  constructor(private sessionDir: string) {}

  /**
   * Get the executions directory path
   */
  private get executionsDir(): string {
    return join(this.sessionDir, EXECUTIONS_DIR);
  }

  /**
   * Get the path for a specific execution
   */
  private executionPath(executionId: string): string {
    return join(this.executionsDir, executionId);
  }

  /**
   * Get the execution metadata file path
   */
  private executionFilePath(executionId: string): string {
    return join(this.executionPath(executionId), EXECUTION_FILE);
  }

  /**
   * Get the stdout file path
   */
  private stdoutFilePath(executionId: string): string {
    return join(this.executionPath(executionId), STDOUT_FILE);
  }

  /**
   * Get the stderr file path
   */
  private stderrFilePath(executionId: string): string {
    return join(this.executionPath(executionId), STDERR_FILE);
  }

  /**
   * Create a new execution record
   */
  async createExecution(
    sessionId: string,
    toolName: string,
    toolArgs: Record<string, unknown>
  ): Promise<ExecutionRecord> {
    const executionId = randomUUID();
    const now = new Date();

    const execution: ExecutionRecord = {
      id: executionId,
      sessionId,
      toolName,
      toolArgs,
      startedAt: now,
      status: "pending",
      stdout: "",
      stderr: "",
      truncated: false,
      totalStdoutSize: 0,
      totalStderrSize: 0,
    };

    // Store in memory
    this.executions.set(executionId, execution);

    // Persist to disk
    await this.persistExecution(execution);

    return execution;
  }

  /**
   * Persist an execution record to disk
   */
  private async persistExecution(execution: ExecutionRecord): Promise<void> {
    const metadata = executionToMetadata(execution);
    await writeJson(this.executionFilePath(execution.id), metadata);
  }

  /**
   * Get an execution by ID
   */
  async getExecution(executionId: string): Promise<ExecutionRecord | null> {
    // Check memory first
    let execution = this.executions.get(executionId);
    if (execution) {
      return execution;
    }

    // Try loading from disk
    const metadata = await readJson<ExecutionMetadata>(
      this.executionFilePath(executionId)
    );
    if (metadata) {
      execution = metadataToExecution(metadata);
      this.executions.set(executionId, execution);
      return execution;
    }

    return null;
  }

  /**
   * Update execution status
   */
  async updateStatus(
    executionId: string,
    status: ExecutionStatus
  ): Promise<ExecutionRecord | null> {
    const execution = await this.getExecution(executionId);
    if (!execution) {
      return null;
    }

    execution.status = status;
    if (
      status === "completed" ||
      status === "failed" ||
      status === "cancelled"
    ) {
      execution.completedAt = new Date();
    }

    await this.persistExecution(execution);
    return execution;
  }

  /**
   * Mark execution as started
   */
  async markStarted(executionId: string): Promise<ExecutionRecord | null> {
    return this.updateStatus(executionId, "running");
  }

  /**
   * Mark execution as completed
   */
  async markCompleted(
    executionId: string,
    result?: unknown,
    exitCode?: number
  ): Promise<ExecutionRecord | null> {
    const execution = await this.getExecution(executionId);
    if (!execution) {
      return null;
    }

    execution.status = "completed";
    execution.completedAt = new Date();
    execution.result = result;
    execution.exitCode = exitCode;

    await this.persistExecution(execution);
    return execution;
  }

  /**
   * Mark execution as failed
   */
  async markFailed(
    executionId: string,
    error: string,
    exitCode?: number
  ): Promise<ExecutionRecord | null> {
    const execution = await this.getExecution(executionId);
    if (!execution) {
      return null;
    }

    execution.status = "failed";
    execution.completedAt = new Date();
    execution.error = error;
    execution.exitCode = exitCode;

    await this.persistExecution(execution);
    return execution;
  }

  /**
   * Mark execution as cancelled
   */
  async markCancelled(executionId: string): Promise<ExecutionRecord | null> {
    return this.updateStatus(executionId, "cancelled");
  }

  /**
   * Append output to an execution
   */
  async appendOutput(
    executionId: string,
    stream: "stdout" | "stderr",
    data: string
  ): Promise<void> {
    const execution = await this.getExecution(executionId);
    if (!execution) {
      return;
    }

    const config = getConfig();
    const currentSize =
      stream === "stdout" ? execution.totalStdoutSize : execution.totalStderrSize;
    const offset = currentSize;

    // Update total size
    if (stream === "stdout") {
      execution.totalStdoutSize += data.length;
    } else {
      execution.totalStderrSize += data.length;
    }

    // Decide whether to store in memory or file
    const filePath =
      stream === "stdout"
        ? this.stdoutFilePath(executionId)
        : this.stderrFilePath(executionId);

    if (currentSize + data.length > config.outputTruncateThreshold) {
      // Store in file
      if (stream === "stdout") {
        execution.stdoutFile = filePath;
        execution.truncated = true;
      } else {
        execution.stderrFile = filePath;
        execution.truncated = true;
      }
      await appendFile(filePath, data);

      // Keep only truncated version in memory
      const truncateLength = Math.min(
        config.outputTruncateThreshold,
        currentSize + data.length
      );
      if (stream === "stdout") {
        execution.stdout = (execution.stdout + data).slice(0, truncateLength);
      } else {
        execution.stderr = (execution.stderr + data).slice(0, truncateLength);
      }
    } else {
      // Store in memory
      if (stream === "stdout") {
        execution.stdout += data;
      } else {
        execution.stderr += data;
      }
      // Also write to file for persistence
      await appendFile(filePath, data);
    }

    // Notify callbacks
    const callbacks = this.outputCallbacks.get(executionId) ?? [];
    for (const callback of callbacks) {
      callback(stream, data, offset);
    }

    // Persist metadata
    await this.persistExecution(execution);
  }

  /**
   * Get output with pagination
   */
  async getOutput(
    executionId: string,
    stream: "stdout" | "stderr",
    offset: number = 0,
    limit?: number
  ): Promise<{ data: string; totalSize: number; hasMore: boolean }> {
    const execution = await this.getExecution(executionId);
    if (!execution) {
      return { data: "", totalSize: 0, hasMore: false };
    }

    const filePath =
      stream === "stdout"
        ? this.stdoutFilePath(executionId)
        : this.stderrFilePath(executionId);

    return readFileRange(filePath, offset, limit);
  }

  /**
   * Subscribe to output updates
   */
  subscribeToOutput(
    executionId: string,
    callback: OutputChunkCallback
  ): () => void {
    const callbacks = this.outputCallbacks.get(executionId) ?? [];
    callbacks.push(callback);
    this.outputCallbacks.set(executionId, callbacks);

    // Return unsubscribe function
    return () => {
      const current = this.outputCallbacks.get(executionId) ?? [];
      const index = current.indexOf(callback);
      if (index !== -1) {
        current.splice(index, 1);
      }
    };
  }

  /**
   * List all executions for a session
   */
  async listExecutions(): Promise<ExecutionRecord[]> {
    const executions: ExecutionRecord[] = [];

    // Load from disk
    const executionIds = await listDir(this.executionsDir);
    for (const executionId of executionIds) {
      const execution = await this.getExecution(executionId);
      if (execution) {
        executions.push(execution);
      }
    }

    return executions;
  }

  /**
   * Delete an execution
   */
  async deleteExecution(executionId: string): Promise<boolean> {
    this.executions.delete(executionId);
    this.outputCallbacks.delete(executionId);
    return deleteDir(this.executionPath(executionId));
  }

  /**
   * Cleanup completed/failed executions older than maxAge
   */
  async cleanupOldExecutions(maxAgeMs: number): Promise<number> {
    const now = Date.now();
    let cleaned = 0;

    const executionIds = await listDir(this.executionsDir);
    for (const executionId of executionIds) {
      const execution = await this.getExecution(executionId);
      if (execution && execution.completedAt) {
        const age = now - execution.completedAt.getTime();
        if (age > maxAgeMs) {
          await this.deleteExecution(executionId);
          cleaned++;
        }
      }
    }

    return cleaned;
  }
}

// Factory function to create execution manager for a session
export function createExecutionManager(sessionDir: string): ExecutionManager {
  return new ExecutionManager(sessionDir);
}

/**
 * Process Manager - Handles background process tracking
 */

import { join } from "path";
import type { ChildProcess } from "child_process";
import {
  type ProcessInfo,
  type ProcessMetadata,
  processToMetadata,
  metadataToProcess,
} from "../types/execution";
import { readJson, writeJson, deleteFile, listDir } from "./storage";

const PROCESSES_DIR = "processes";

export class ProcessManager {
  // Active processes (in-memory only for running processes)
  private processes: Map<string, ProcessInfo> = new Map();

  // Reference to actual child processes
  private childProcesses: Map<string, ChildProcess> = new Map();

  // Counter for generating process IDs
  private processCounter: number = 0;

  constructor(private sessionDir: string) {}

  /**
   * Get the processes directory path
   */
  private get processesDir(): string {
    return join(this.sessionDir, PROCESSES_DIR);
  }

  /**
   * Get the path for a specific process metadata file
   */
  private processFilePath(processId: string): string {
    return join(this.processesDir, `${processId}.json`);
  }

  /**
   * Generate a new process ID
   */
  private generateProcessId(): string {
    this.processCounter++;
    return `proc_${this.processCounter}`;
  }

  /**
   * Register a new background process
   */
  async registerProcess(
    executionId: string,
    command: string,
    childProcess: ChildProcess
  ): Promise<ProcessInfo> {
    const processId = this.generateProcessId();
    const now = new Date();

    const processInfo: ProcessInfo = {
      id: processId,
      executionId,
      pid: childProcess.pid ?? -1,
      command,
      status: "running",
      startedAt: now,
    };

    // Store in memory
    this.processes.set(processId, processInfo);
    this.childProcesses.set(processId, childProcess);

    // Persist to disk
    await this.persistProcess(processInfo);

    // Setup exit handler
    childProcess.on("exit", (code) => {
      this.handleProcessExit(processId, code);
    });

    return processInfo;
  }

  /**
   * Handle process exit
   */
  private async handleProcessExit(
    processId: string,
    exitCode: number | null
  ): Promise<void> {
    const processInfo = this.processes.get(processId);
    if (!processInfo) return;

    processInfo.status = exitCode === 0 ? "completed" : "failed";
    processInfo.completedAt = new Date();
    processInfo.exitCode = exitCode ?? undefined;

    // Remove child process reference
    this.childProcesses.delete(processId);

    // Persist updated state
    await this.persistProcess(processInfo);
  }

  /**
   * Persist process info to disk
   */
  private async persistProcess(processInfo: ProcessInfo): Promise<void> {
    const metadata = processToMetadata(processInfo);
    await writeJson(this.processFilePath(processInfo.id), metadata);
  }

  /**
   * Get a process by ID
   */
  async getProcess(processId: string): Promise<ProcessInfo | null> {
    // Check memory first
    const process = this.processes.get(processId);
    if (process) {
      return process;
    }

    // Try loading from disk
    const metadata = await readJson<ProcessMetadata>(
      this.processFilePath(processId)
    );
    if (metadata) {
      const processInfo = metadataToProcess(metadata);
      // Only cache if still running (shouldn't happen though)
      if (processInfo.status === "running") {
        this.processes.set(processId, processInfo);
      }
      return processInfo;
    }

    return null;
  }

  /**
   * Get process by execution ID
   */
  async getProcessByExecutionId(
    executionId: string
  ): Promise<ProcessInfo | null> {
    // Check memory first
    for (const process of this.processes.values()) {
      if (process.executionId === executionId) {
        return process;
      }
    }

    // Check disk
    const processIds = await listDir(this.processesDir);
    for (const fileName of processIds) {
      const processId = fileName.replace(".json", "");
      const process = await this.getProcess(processId);
      if (process && process.executionId === executionId) {
        return process;
      }
    }

    return null;
  }

  /**
   * Kill a process
   */
  async killProcess(processId: string): Promise<boolean> {
    const childProcess = this.childProcesses.get(processId);
    if (childProcess) {
      childProcess.kill("SIGTERM");

      // Give it a moment, then force kill if needed
      setTimeout(() => {
        if (!childProcess.killed) {
          childProcess.kill("SIGKILL");
        }
      }, 5000);

      return true;
    }

    return false;
  }

  /**
   * List all processes
   */
  async listProcesses(): Promise<ProcessInfo[]> {
    const processes: ProcessInfo[] = [];

    // Load from disk
    const processFiles = await listDir(this.processesDir);
    for (const fileName of processFiles) {
      const processId = fileName.replace(".json", "");
      const process = await this.getProcess(processId);
      if (process) {
        processes.push(process);
      }
    }

    return processes;
  }

  /**
   * List running processes
   */
  async listRunningProcesses(): Promise<ProcessInfo[]> {
    const all = await this.listProcesses();
    return all.filter((p) => p.status === "running");
  }

  /**
   * Get child process reference (for output streaming)
   */
  getChildProcess(processId: string): ChildProcess | null {
    return this.childProcesses.get(processId) ?? null;
  }

  /**
   * Cleanup completed processes
   */
  async cleanupCompletedProcesses(): Promise<number> {
    let cleaned = 0;

    const processFiles = await listDir(this.processesDir);
    for (const fileName of processFiles) {
      const processId = fileName.replace(".json", "");
      const process = await this.getProcess(processId);
      if (process && process.status !== "running") {
        await deleteFile(this.processFilePath(processId));
        this.processes.delete(processId);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Kill all running processes (for session cleanup)
   */
  async killAllProcesses(): Promise<void> {
    for (const [processId, childProcess] of this.childProcesses.entries()) {
      childProcess.kill("SIGKILL");
      this.childProcesses.delete(processId);
    }
    this.processes.clear();
  }
}

// Factory function to create process manager for a session
export function createProcessManager(sessionDir: string): ProcessManager {
  return new ProcessManager(sessionDir);
}

/**
 * Execution types for the tool server
 */

export type ExecutionStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface ExecutionRecord {
  id: string;
  sessionId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;

  // Timing
  startedAt: Date;
  completedAt?: Date;

  // Status
  status: ExecutionStatus;

  // Output (in-memory for small outputs)
  stdout: string;
  stderr: string;

  // File paths for large outputs
  stdoutFile?: string;
  stderrFile?: string;

  // Result
  exitCode?: number;
  result?: unknown;
  error?: string;

  // Metadata
  truncated: boolean;
  totalStdoutSize: number;
  totalStderrSize: number;
}

export interface ExecutionMetadata {
  id: string;
  sessionId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  startedAt: string;
  completedAt?: string;
  status: ExecutionStatus;
  stdout: string;
  stderr: string;
  stdoutFile?: string;
  stderrFile?: string;
  exitCode?: number;
  result?: unknown;
  error?: string;
  truncated: boolean;
  totalStdoutSize: number;
  totalStderrSize: number;
}

export function executionToMetadata(exec: ExecutionRecord): ExecutionMetadata {
  return {
    id: exec.id,
    sessionId: exec.sessionId,
    toolName: exec.toolName,
    toolArgs: exec.toolArgs,
    startedAt: exec.startedAt.toISOString(),
    completedAt: exec.completedAt?.toISOString(),
    status: exec.status,
    stdout: exec.stdout,
    stderr: exec.stderr,
    stdoutFile: exec.stdoutFile,
    stderrFile: exec.stderrFile,
    exitCode: exec.exitCode,
    result: exec.result,
    error: exec.error,
    truncated: exec.truncated,
    totalStdoutSize: exec.totalStdoutSize,
    totalStderrSize: exec.totalStderrSize,
  };
}

export function metadataToExecution(meta: ExecutionMetadata): ExecutionRecord {
  return {
    id: meta.id,
    sessionId: meta.sessionId,
    toolName: meta.toolName,
    toolArgs: meta.toolArgs,
    startedAt: new Date(meta.startedAt),
    completedAt: meta.completedAt ? new Date(meta.completedAt) : undefined,
    status: meta.status,
    stdout: meta.stdout,
    stderr: meta.stderr,
    stdoutFile: meta.stdoutFile,
    stderrFile: meta.stderrFile,
    exitCode: meta.exitCode,
    result: meta.result,
    error: meta.error,
    truncated: meta.truncated,
    totalStdoutSize: meta.totalStdoutSize,
    totalStderrSize: meta.totalStderrSize,
  };
}

export interface ProcessInfo {
  id: string;
  executionId: string;
  pid: number;
  command: string;
  status: "running" | "completed" | "failed";
  startedAt: Date;
  completedAt?: Date;
  exitCode?: number;
}

export interface ProcessMetadata {
  id: string;
  executionId: string;
  pid: number;
  command: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  completedAt?: string;
  exitCode?: number;
}

export function processToMetadata(proc: ProcessInfo): ProcessMetadata {
  return {
    id: proc.id,
    executionId: proc.executionId,
    pid: proc.pid,
    command: proc.command,
    status: proc.status,
    startedAt: proc.startedAt.toISOString(),
    completedAt: proc.completedAt?.toISOString(),
    exitCode: proc.exitCode,
  };
}

export function metadataToProcess(meta: ProcessMetadata): ProcessInfo {
  return {
    id: meta.id,
    executionId: meta.executionId,
    pid: meta.pid,
    command: meta.command,
    status: meta.status,
    startedAt: new Date(meta.startedAt),
    completedAt: meta.completedAt ? new Date(meta.completedAt) : undefined,
    exitCode: meta.exitCode,
  };
}

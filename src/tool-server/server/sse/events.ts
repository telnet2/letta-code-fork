/**
 * SSE Event Builders - Helper functions to create SSE event data
 */

import type {
  StartedEventData,
  OutputEventData,
  CompletedEventData,
  ErrorEventData,
} from "../../types/protocol";
import type { ExecutionRecord } from "../../types/execution";

export function createStartedEvent(
  executionId: string,
  tool: string
): StartedEventData {
  return {
    executionId,
    tool,
  };
}

export function createOutputEvent(
  executionId: string,
  data: string,
  offset: number
): OutputEventData {
  return {
    executionId,
    data,
    offset,
  };
}

export function createCompletedEvent(
  execution: ExecutionRecord
): CompletedEventData {
  return {
    executionId: execution.id,
    status: execution.status,
    exitCode: execution.exitCode,
    result: execution.result,
    error: execution.error,
    truncated: execution.truncated,
    totalStdoutSize: execution.totalStdoutSize,
    totalStderrSize: execution.totalStderrSize,
  };
}

export function createErrorEvent(
  code: string,
  message: string,
  executionId?: string
): ErrorEventData {
  return {
    executionId,
    code,
    message,
  };
}

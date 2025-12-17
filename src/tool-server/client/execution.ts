/**
 * Execution Handle - Represents a running or completed tool execution
 */

import type { StreamChunk, ExecutionResult, OutputQueryResult } from "./types";
import { parseSSEStream, OutputAccumulator } from "./sse-stream";

export interface ExecutionHandle {
  /** Execution ID */
  id: string;

  /** Tool name */
  tool: string;

  /** Stream execution output in real-time */
  stream(): AsyncGenerator<StreamChunk>;

  /** Wait for completion and get result */
  result(): Promise<ExecutionResult>;

  /** Cancel the execution */
  cancel(): Promise<boolean>;

  /** Query output with pagination */
  queryOutput(options: {
    stream: "stdout" | "stderr";
    offset?: number;
    limit?: number;
  }): Promise<OutputQueryResult>;

  /** Format result for LLM consumption */
  formatForLLM(options?: { maxOutputLength?: number; includeMetadata?: boolean }): Promise<string>;
}

/**
 * Create an execution handle for streaming execution
 */
export function createStreamingExecution(
  executionId: string,
  tool: string,
  response: Response,
  baseUrl: string,
  sessionId: string
): ExecutionHandle {
  const accumulator = new OutputAccumulator();
  let cachedResult: ExecutionResult | null = null;
  let streamConsumed = false;

  return {
    id: executionId,
    tool,

    async *stream(): AsyncGenerator<StreamChunk> {
      if (streamConsumed) {
        throw new Error("Stream already consumed");
      }
      streamConsumed = true;

      for await (const chunk of parseSSEStream(response)) {
        accumulator.addChunk(chunk);

        if (chunk.type === "completed") {
          cachedResult = {
            executionId: chunk.executionId,
            status: chunk.status,
            result: chunk.result,
            exitCode: chunk.exitCode,
            error: chunk.error,
            truncated: chunk.truncated,
            timing: {
              startedAt: "",
              durationMs: 0,
            },
          };
        }

        yield chunk;
      }
    },

    async result(): Promise<ExecutionResult> {
      // If we already have a cached result, return it
      if (cachedResult) {
        return cachedResult;
      }

      // If stream hasn't been consumed, consume it to get the result
      if (!streamConsumed) {
        for await (const chunk of this.stream()) {
          // Stream will populate cachedResult when completed
        }
      }

      if (!cachedResult) {
        throw new Error("Execution did not complete");
      }

      return cachedResult;
    },

    async cancel(): Promise<boolean> {
      const res = await fetch(
        `${baseUrl}/api/sessions/${sessionId}/executions/${executionId}`,
        { method: "DELETE" }
      );
      return res.status === 204;
    },

    async queryOutput(options): Promise<OutputQueryResult> {
      const params = new URLSearchParams();
      params.set("stream", options.stream);
      if (options.offset !== undefined) {
        params.set("offset", String(options.offset));
      }
      if (options.limit !== undefined) {
        params.set("limit", String(options.limit));
      }

      const res = await fetch(
        `${baseUrl}/api/sessions/${sessionId}/executions/${executionId}/output?${params}`
      );

      if (!res.ok) {
        throw new Error(`Failed to query output: ${res.status}`);
      }

      return res.json();
    },

    async formatForLLM(options = {}): Promise<string> {
      const { maxOutputLength = 8000, includeMetadata = true } = options;
      const result = await this.result();

      const lines: string[] = [];

      if (includeMetadata) {
        lines.push(`Tool: ${tool}`);
        if (result.exitCode !== undefined) {
          lines.push(`Exit Code: ${result.exitCode}`);
        }
        if (result.timing.durationMs) {
          lines.push(`Duration: ${(result.timing.durationMs / 1000).toFixed(2)}s`);
        }
        lines.push("");
      }

      // Get output
      const stdout = accumulator.getStdout();
      const stderr = accumulator.getStderr();
      const totalOutput = stdout + (stderr ? `\n\nSTDERR:\n${stderr}` : "");

      if (totalOutput.length > maxOutputLength) {
        const truncated = totalOutput.slice(0, maxOutputLength);
        lines.push(
          `Output (truncated, showing ${maxOutputLength} of ${totalOutput.length} chars):`
        );
        lines.push(truncated);
        lines.push("");
        lines.push(
          `[Output truncated. Use queryOutput(executionId, {offset: ${maxOutputLength}}) to see more]`
        );
      } else {
        lines.push("Output:");
        lines.push(totalOutput || "(no output)");
      }

      if (result.error) {
        lines.push("");
        lines.push(`Error: ${result.error}`);
      }

      return lines.join("\n");
    },
  };
}

/**
 * Create an execution handle for sync execution result
 */
export function createSyncExecution(
  result: ExecutionResult,
  tool: string,
  baseUrl: string,
  sessionId: string
): ExecutionHandle {
  return {
    id: result.executionId,
    tool,

    async *stream(): AsyncGenerator<StreamChunk> {
      // Sync execution doesn't stream, just emit completed
      yield {
        type: "completed",
        executionId: result.executionId,
        status: result.status,
        exitCode: result.exitCode,
        result: result.result,
        error: result.error,
        truncated: result.truncated,
        totalStdoutSize: 0,
        totalStderrSize: 0,
      };
    },

    async result(): Promise<ExecutionResult> {
      return result;
    },

    async cancel(): Promise<boolean> {
      // Already completed
      return false;
    },

    async queryOutput(options): Promise<OutputQueryResult> {
      const params = new URLSearchParams();
      params.set("stream", options.stream);
      if (options.offset !== undefined) {
        params.set("offset", String(options.offset));
      }
      if (options.limit !== undefined) {
        params.set("limit", String(options.limit));
      }

      const res = await fetch(
        `${baseUrl}/api/sessions/${sessionId}/executions/${result.executionId}/output?${params}`
      );

      if (!res.ok) {
        throw new Error(`Failed to query output: ${res.status}`);
      }

      return res.json();
    },

    async formatForLLM(options = {}): Promise<string> {
      const { maxOutputLength = 8000, includeMetadata = true } = options;

      const lines: string[] = [];

      if (includeMetadata) {
        lines.push(`Tool: ${tool}`);
        if (result.exitCode !== undefined) {
          lines.push(`Exit Code: ${result.exitCode}`);
        }
        if (result.timing.durationMs) {
          lines.push(`Duration: ${(result.timing.durationMs / 1000).toFixed(2)}s`);
        }
        lines.push("");
      }

      const output = typeof result.result === "string" ? result.result : JSON.stringify(result.result);

      if (output.length > maxOutputLength) {
        lines.push(
          `Output (truncated, showing ${maxOutputLength} of ${output.length} chars):`
        );
        lines.push(output.slice(0, maxOutputLength));
        lines.push("");
        lines.push(
          `[Output truncated. Use queryOutput(executionId, {offset: ${maxOutputLength}}) to see more]`
        );
      } else {
        lines.push("Output:");
        lines.push(output || "(no output)");
      }

      if (result.error) {
        lines.push("");
        lines.push(`Error: ${result.error}`);
      }

      return lines.join("\n");
    },
  };
}

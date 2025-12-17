/**
 * SSE Stream Client - Parse Server-Sent Events
 */

import type { StreamChunk } from "./types";

/**
 * Parse SSE events from a ReadableStream
 */
export async function* parseSSEStream(
  response: Response
): AsyncGenerator<StreamChunk> {
  if (!response.body) {
    throw new Error("Response has no body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete events (separated by double newlines)
      const events = buffer.split("\n\n");
      buffer = events.pop() || ""; // Keep incomplete event in buffer

      for (const eventText of events) {
        if (!eventText.trim()) continue;

        const chunk = parseSSEEvent(eventText);
        if (chunk) {
          yield chunk;
        }
      }
    }

    // Process any remaining buffer
    if (buffer.trim()) {
      const chunk = parseSSEEvent(buffer);
      if (chunk) {
        yield chunk;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Parse a single SSE event
 */
function parseSSEEvent(eventText: string): StreamChunk | null {
  const lines = eventText.split("\n");
  let eventType = "";
  let data = "";

  for (const line of lines) {
    if (line.startsWith("event: ")) {
      eventType = line.slice(7).trim();
    } else if (line.startsWith("data: ")) {
      data = line.slice(6);
    } else if (line.startsWith("id: ")) {
      // Event ID - could be used for reconnection
    }
  }

  if (!eventType || !data) {
    return null;
  }

  try {
    const parsed = JSON.parse(data);

    switch (eventType) {
      case "started":
        return {
          type: "started",
          executionId: parsed.executionId,
          tool: parsed.tool,
        };

      case "stdout":
        return {
          type: "stdout",
          executionId: parsed.executionId,
          data: parsed.data,
          offset: parsed.offset,
        };

      case "stderr":
        return {
          type: "stderr",
          executionId: parsed.executionId,
          data: parsed.data,
          offset: parsed.offset,
        };

      case "completed":
        return {
          type: "completed",
          executionId: parsed.executionId,
          status: parsed.status,
          exitCode: parsed.exitCode,
          result: parsed.result,
          error: parsed.error,
          truncated: parsed.truncated,
          totalStdoutSize: parsed.totalStdoutSize,
          totalStderrSize: parsed.totalStderrSize,
        };

      case "error":
        return {
          type: "error",
          code: parsed.code,
          message: parsed.message,
          executionId: parsed.executionId,
        };

      case "ping":
        return {
          type: "ping",
          timestamp: parsed.timestamp,
        };

      default:
        return null;
    }
  } catch {
    return null;
  }
}

/**
 * Accumulate stdout/stderr from stream chunks
 */
export class OutputAccumulator {
  private stdout = "";
  private stderr = "";
  private stdoutSize = 0;
  private stderrSize = 0;

  addChunk(chunk: StreamChunk): void {
    if (chunk.type === "stdout") {
      this.stdout += chunk.data;
      this.stdoutSize = chunk.offset + chunk.data.length;
    } else if (chunk.type === "stderr") {
      this.stderr += chunk.data;
      this.stderrSize = chunk.offset + chunk.data.length;
    }
  }

  getStdout(): string {
    return this.stdout;
  }

  getStderr(): string {
    return this.stderr;
  }

  getStdoutSize(): number {
    return this.stdoutSize;
  }

  getStderrSize(): number {
    return this.stderrSize;
  }

  clear(): void {
    this.stdout = "";
    this.stderr = "";
    this.stdoutSize = 0;
    this.stderrSize = 0;
  }
}

/**
 * SSE Stream Helper - Server-Sent Events utilities
 */

import type { SSEEventType, SSEEventData } from "../../types/protocol";

/**
 * Create an SSE-formatted message
 */
export function formatSSEMessage(
  event: SSEEventType,
  data: SSEEventData,
  id?: number
): string {
  const lines: string[] = [];

  if (id !== undefined) {
    lines.push(`id: ${id}`);
  }

  lines.push(`event: ${event}`);
  lines.push(`data: ${JSON.stringify(data)}`);
  lines.push(""); // Empty line to end the message

  return lines.join("\n") + "\n";
}

/**
 * Create SSE headers
 */
export function createSSEHeaders(): Headers {
  return new Headers({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });
}

/**
 * SSE Writer - manages writing SSE events to a stream
 */
export class SSEWriter {
  private eventId: number = 0;
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  private encoder = new TextEncoder();
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(private pingIntervalMs: number = 30000) {}

  /**
   * Create a ReadableStream for SSE
   */
  createStream(): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start: (controller) => {
        this.controller = controller;

        // Start ping interval to keep connection alive
        this.pingInterval = setInterval(() => {
          this.sendPing();
        }, this.pingIntervalMs);
      },
      cancel: () => {
        this.close();
      },
    });
  }

  /**
   * Send an SSE event
   */
  send(event: SSEEventType, data: SSEEventData): void {
    if (this.closed || !this.controller) return;

    this.eventId++;
    const message = formatSSEMessage(event, data, this.eventId);

    try {
      this.controller.enqueue(this.encoder.encode(message));
    } catch {
      // Stream may be closed
      this.close();
    }
  }

  /**
   * Send a ping event
   */
  sendPing(): void {
    this.send("ping", { timestamp: Date.now() });
  }

  /**
   * Get current event ID (for Last-Event-ID support)
   */
  getLastEventId(): number {
    return this.eventId;
  }

  /**
   * Close the stream
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;

    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    if (this.controller) {
      try {
        this.controller.close();
      } catch {
        // Already closed
      }
      this.controller = null;
    }
  }

  /**
   * Check if stream is closed
   */
  isClosed(): boolean {
    return this.closed;
  }
}

/**
 * Create an SSE Response
 */
export function createSSEResponse(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, {
    headers: createSSEHeaders(),
  });
}

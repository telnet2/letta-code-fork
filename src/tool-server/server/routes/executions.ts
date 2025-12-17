/**
 * Execution Routes - REST API endpoints for tool execution
 */

import { getSessionManager } from "../../core/session-manager";
import { createExecutionManager, type ExecutionManager } from "../../core/execution-manager";
import { createProcessManager, type ProcessManager } from "../../core/process-manager";
import { createToolExecutor } from "../../tools/executor";
import { executionToMetadata } from "../../types/execution";
import { ErrorCodes, type ExecuteRequest } from "../../types/protocol";
import { SSEWriter, createSSEResponse } from "../sse/stream";
import {
  createStartedEvent,
  createOutputEvent,
  createCompletedEvent,
  createErrorEvent,
} from "../sse/events";

// Cache for execution and process managers per session
const executionManagers = new Map<string, ExecutionManager>();
const processManagers = new Map<string, ProcessManager>();

function getExecutionManager(sessionId: string, sessionDir: string): ExecutionManager {
  let manager = executionManagers.get(sessionId);
  if (!manager) {
    manager = createExecutionManager(sessionDir);
    executionManagers.set(sessionId, manager);
  }
  return manager;
}

function getProcessManager(sessionId: string, sessionDir: string): ProcessManager {
  let manager = processManagers.get(sessionId);
  if (!manager) {
    manager = createProcessManager(sessionDir);
    processManagers.set(sessionId, manager);
  }
  return manager;
}

/**
 * Execute a tool (non-streaming)
 * POST /api/sessions/:id/execute
 */
export async function executeToolSync(
  sessionId: string,
  req: Request
): Promise<Response> {
  try {
    const sessionManager = getSessionManager();
    const session = await sessionManager.getSession(sessionId);

    if (!session) {
      return Response.json(
        { code: ErrorCodes.SESSION_NOT_FOUND, message: "Session not found" },
        { status: 404 }
      );
    }

    if (session.status !== "active") {
      return Response.json(
        { code: ErrorCodes.SESSION_EXPIRED, message: "Session expired" },
        { status: 410 }
      );
    }

    const body = (await req.json()) as ExecuteRequest;

    if (!body.tool) {
      return Response.json(
        { code: ErrorCodes.INVALID_REQUEST, message: "Missing tool name" },
        { status: 400 }
      );
    }

    const sessionDir = session.workspaceRoot.replace("/workspace", "");
    const executionManager = getExecutionManager(sessionId, sessionDir);
    const processManager = getProcessManager(sessionId, sessionDir);
    const executor = createToolExecutor(session, executionManager, processManager);

    const { execution, result } = await executor.execute(body.tool, body.args || {}, {
      timeout: body.timeout,
    });

    const finalResult = await result;
    const finalExecution = await executionManager.getExecution(execution.id);

    return Response.json({
      executionId: execution.id,
      status: finalExecution?.status || "completed",
      result: finalResult.content,
      exitCode: finalResult.exitCode,
      truncated: finalExecution?.truncated || false,
      timing: {
        startedAt: finalExecution?.startedAt.toISOString(),
        completedAt: finalExecution?.completedAt?.toISOString(),
        durationMs: finalExecution?.completedAt
          ? finalExecution.completedAt.getTime() - finalExecution.startedAt.getTime()
          : 0,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Tool not found")) {
      return Response.json(
        { code: ErrorCodes.TOOL_NOT_FOUND, message: error.message },
        { status: 404 }
      );
    }
    return errorResponse(error, "Failed to execute tool");
  }
}

/**
 * Execute a tool with SSE streaming
 * POST /api/sessions/:id/execute/stream
 */
export async function executeToolStream(
  sessionId: string,
  req: Request
): Promise<Response> {
  try {
    const sessionManager = getSessionManager();
    const session = await sessionManager.getSession(sessionId);

    if (!session) {
      return Response.json(
        { code: ErrorCodes.SESSION_NOT_FOUND, message: "Session not found" },
        { status: 404 }
      );
    }

    if (session.status !== "active") {
      return Response.json(
        { code: ErrorCodes.SESSION_EXPIRED, message: "Session expired" },
        { status: 410 }
      );
    }

    const body = (await req.json()) as ExecuteRequest;

    if (!body.tool) {
      return Response.json(
        { code: ErrorCodes.INVALID_REQUEST, message: "Missing tool name" },
        { status: 400 }
      );
    }

    const sessionDir = session.workspaceRoot.replace("/workspace", "");
    const executionManager = getExecutionManager(sessionId, sessionDir);
    const processManager = getProcessManager(sessionId, sessionDir);
    const executor = createToolExecutor(session, executionManager, processManager);

    // Create SSE writer
    const sseWriter = new SSEWriter();
    const stream = sseWriter.createStream();

    // Start execution asynchronously
    (async () => {
      try {
        const { execution, result } = await executor.execute(
          body.tool,
          body.args || {},
          { timeout: body.timeout }
        );

        // Send started event
        sseWriter.send("started", createStartedEvent(execution.id, body.tool));

        // Subscribe to output
        const unsubscribe = executionManager.subscribeToOutput(
          execution.id,
          (streamType, data, offset) => {
            if (!sseWriter.isClosed()) {
              sseWriter.send(streamType, createOutputEvent(execution.id, data, offset));
            }
          }
        );

        // Wait for completion
        await result;

        // Unsubscribe and send completion
        unsubscribe();

        const finalExecution = await executionManager.getExecution(execution.id);
        if (finalExecution && !sseWriter.isClosed()) {
          sseWriter.send("completed", createCompletedEvent(finalExecution));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Execution failed";
        if (!sseWriter.isClosed()) {
          sseWriter.send("error", createErrorEvent(ErrorCodes.EXECUTION_FAILED, message));
        }
      } finally {
        sseWriter.close();
      }
    })();

    return createSSEResponse(stream);
  } catch (error) {
    if (error instanceof Error && error.message.includes("Tool not found")) {
      return Response.json(
        { code: ErrorCodes.TOOL_NOT_FOUND, message: error.message },
        { status: 404 }
      );
    }
    return errorResponse(error, "Failed to execute tool");
  }
}

/**
 * Get execution by ID
 * GET /api/sessions/:id/executions/:execId
 */
export async function getExecution(
  sessionId: string,
  executionId: string
): Promise<Response> {
  try {
    const sessionManager = getSessionManager();
    const session = await sessionManager.getSession(sessionId);

    if (!session) {
      return Response.json(
        { code: ErrorCodes.SESSION_NOT_FOUND, message: "Session not found" },
        { status: 404 }
      );
    }

    const sessionDir = session.workspaceRoot.replace("/workspace", "");
    const executionManager = getExecutionManager(sessionId, sessionDir);
    const execution = await executionManager.getExecution(executionId);

    if (!execution) {
      return Response.json(
        { code: ErrorCodes.EXECUTION_NOT_FOUND, message: "Execution not found" },
        { status: 404 }
      );
    }

    return Response.json(executionToMetadata(execution));
  } catch (error) {
    return errorResponse(error, "Failed to get execution");
  }
}

/**
 * List executions for a session
 * GET /api/sessions/:id/executions
 */
export async function listExecutions(sessionId: string): Promise<Response> {
  try {
    const sessionManager = getSessionManager();
    const session = await sessionManager.getSession(sessionId);

    if (!session) {
      return Response.json(
        { code: ErrorCodes.SESSION_NOT_FOUND, message: "Session not found" },
        { status: 404 }
      );
    }

    const sessionDir = session.workspaceRoot.replace("/workspace", "");
    const executionManager = getExecutionManager(sessionId, sessionDir);
    const executions = await executionManager.listExecutions();

    return Response.json({
      executions: executions.map(executionToMetadata),
      count: executions.length,
    });
  } catch (error) {
    return errorResponse(error, "Failed to list executions");
  }
}

/**
 * Cancel an execution
 * DELETE /api/sessions/:id/executions/:execId
 */
export async function cancelExecution(
  sessionId: string,
  executionId: string
): Promise<Response> {
  try {
    const sessionManager = getSessionManager();
    const session = await sessionManager.getSession(sessionId);

    if (!session) {
      return Response.json(
        { code: ErrorCodes.SESSION_NOT_FOUND, message: "Session not found" },
        { status: 404 }
      );
    }

    const sessionDir = session.workspaceRoot.replace("/workspace", "");
    const executionManager = getExecutionManager(sessionId, sessionDir);
    const processManager = getProcessManager(sessionId, sessionDir);
    const executor = createToolExecutor(session, executionManager, processManager);

    const cancelled = await executor.cancel(executionId);

    if (!cancelled) {
      return Response.json(
        { code: ErrorCodes.EXECUTION_NOT_FOUND, message: "Execution not found or already completed" },
        { status: 404 }
      );
    }

    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error, "Failed to cancel execution");
  }
}

/**
 * Get execution output with pagination
 * GET /api/sessions/:id/executions/:execId/output
 */
export async function getExecutionOutput(
  sessionId: string,
  executionId: string,
  url: URL
): Promise<Response> {
  try {
    const sessionManager = getSessionManager();
    const session = await sessionManager.getSession(sessionId);

    if (!session) {
      return Response.json(
        { code: ErrorCodes.SESSION_NOT_FOUND, message: "Session not found" },
        { status: 404 }
      );
    }

    const sessionDir = session.workspaceRoot.replace("/workspace", "");
    const executionManager = getExecutionManager(sessionId, sessionDir);

    const execution = await executionManager.getExecution(executionId);
    if (!execution) {
      return Response.json(
        { code: ErrorCodes.EXECUTION_NOT_FOUND, message: "Execution not found" },
        { status: 404 }
      );
    }

    const stream = (url.searchParams.get("stream") || "stdout") as "stdout" | "stderr";
    const offset = parseInt(url.searchParams.get("offset") || "0", 10);
    const limit = url.searchParams.get("limit")
      ? parseInt(url.searchParams.get("limit")!, 10)
      : undefined;

    const result = await executionManager.getOutput(executionId, stream, offset, limit);

    return Response.json({
      executionId,
      stream,
      data: result.data,
      offset,
      totalSize: result.totalSize,
      hasMore: result.hasMore,
    });
  } catch (error) {
    return errorResponse(error, "Failed to get output");
  }
}

function errorResponse(error: unknown, defaultMessage: string): Response {
  const message = error instanceof Error ? error.message : defaultMessage;
  return Response.json(
    { code: ErrorCodes.INTERNAL_ERROR, message },
    { status: 500 }
  );
}

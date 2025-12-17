/**
 * Process Routes - REST API endpoints for background process management
 */

import { getSessionManager } from "../../core/session-manager";
import { createProcessManager, type ProcessManager } from "../../core/process-manager";
import { processToMetadata } from "../../types/execution";
import { ErrorCodes } from "../../types/protocol";

// Cache for process managers per session
const processManagers = new Map<string, ProcessManager>();

function getProcessManager(sessionId: string, sessionDir: string): ProcessManager {
  let manager = processManagers.get(sessionId);
  if (!manager) {
    manager = createProcessManager(sessionDir);
    processManagers.set(sessionId, manager);
  }
  return manager;
}

/**
 * List running processes
 * GET /api/sessions/:id/processes
 */
export async function listProcesses(sessionId: string): Promise<Response> {
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
    const processManager = getProcessManager(sessionId, sessionDir);
    const processes = await processManager.listProcesses();

    return Response.json({
      processes: processes.map(processToMetadata),
      count: processes.length,
    });
  } catch (error) {
    return errorResponse(error, "Failed to list processes");
  }
}

/**
 * Get process by ID
 * GET /api/sessions/:id/processes/:processId
 */
export async function getProcess(
  sessionId: string,
  processId: string
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
    const processManager = getProcessManager(sessionId, sessionDir);
    const process = await processManager.getProcess(processId);

    if (!process) {
      return Response.json(
        { code: "PROCESS_NOT_FOUND", message: "Process not found" },
        { status: 404 }
      );
    }

    return Response.json(processToMetadata(process));
  } catch (error) {
    return errorResponse(error, "Failed to get process");
  }
}

/**
 * Kill a process
 * DELETE /api/sessions/:id/processes/:processId
 */
export async function killProcess(
  sessionId: string,
  processId: string
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
    const processManager = getProcessManager(sessionId, sessionDir);
    const killed = await processManager.killProcess(processId);

    if (!killed) {
      return Response.json(
        { code: "PROCESS_NOT_FOUND", message: "Process not found or already terminated" },
        { status: 404 }
      );
    }

    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error, "Failed to kill process");
  }
}

function errorResponse(error: unknown, defaultMessage: string): Response {
  const message = error instanceof Error ? error.message : defaultMessage;
  return Response.json(
    { code: ErrorCodes.INTERNAL_ERROR, message },
    { status: 500 }
  );
}

/**
 * Session Routes - REST API endpoints for session management
 */

import { getSessionManager } from "../../core/session-manager";
import { sessionToMetadata, type SessionCreateOptions } from "../../types/session";
import { ErrorCodes } from "../../types/protocol";

/**
 * Create a new session
 * POST /api/sessions
 */
export async function createSession(req: Request): Promise<Response> {
  try {
    let options: SessionCreateOptions = {};

    if (req.headers.get("content-type")?.includes("application/json")) {
      const body = await req.json();
      options = {
        cwd: body.cwd,
        env: body.env,
        timeoutDays: body.timeoutDays,
      };
    }

    const sessionManager = getSessionManager();
    const session = await sessionManager.createSession(options);

    return Response.json(sessionToMetadata(session), { status: 201 });
  } catch (error) {
    return errorResponse(error, "Failed to create session");
  }
}

/**
 * Get session by ID
 * GET /api/sessions/:id
 */
export async function getSession(sessionId: string): Promise<Response> {
  try {
    const sessionManager = getSessionManager();
    const session = await sessionManager.getSession(sessionId);

    if (!session) {
      return Response.json(
        { code: ErrorCodes.SESSION_NOT_FOUND, message: "Session not found" },
        { status: 404 }
      );
    }

    if (session.status === "expired") {
      return Response.json(
        { code: ErrorCodes.SESSION_EXPIRED, message: "Session has expired" },
        { status: 410 }
      );
    }

    return Response.json(sessionToMetadata(session));
  } catch (error) {
    return errorResponse(error, "Failed to get session");
  }
}

/**
 * Delete/close a session
 * DELETE /api/sessions/:id
 */
export async function deleteSession(sessionId: string): Promise<Response> {
  try {
    const sessionManager = getSessionManager();
    const success = await sessionManager.closeSession(sessionId);

    if (!success) {
      return Response.json(
        { code: ErrorCodes.SESSION_NOT_FOUND, message: "Session not found" },
        { status: 404 }
      );
    }

    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error, "Failed to delete session");
  }
}

/**
 * Extend session expiry
 * POST /api/sessions/:id/extend
 */
export async function extendSession(
  sessionId: string,
  req: Request
): Promise<Response> {
  try {
    let additionalDays: number | undefined;

    if (req.headers.get("content-type")?.includes("application/json")) {
      const body = await req.json();
      additionalDays = body.days;
    }

    const sessionManager = getSessionManager();
    const session = await sessionManager.extendSession(sessionId, additionalDays);

    if (!session) {
      return Response.json(
        { code: ErrorCodes.SESSION_NOT_FOUND, message: "Session not found" },
        { status: 404 }
      );
    }

    return Response.json(sessionToMetadata(session));
  } catch (error) {
    return errorResponse(error, "Failed to extend session");
  }
}

/**
 * List all sessions
 * GET /api/sessions
 */
export async function listSessions(): Promise<Response> {
  try {
    const sessionManager = getSessionManager();
    const sessions = await sessionManager.listSessions();

    return Response.json({
      sessions: sessions.map(sessionToMetadata),
      count: sessions.length,
    });
  } catch (error) {
    return errorResponse(error, "Failed to list sessions");
  }
}

/**
 * Update session
 * PATCH /api/sessions/:id
 */
export async function updateSession(
  sessionId: string,
  req: Request
): Promise<Response> {
  try {
    const body = await req.json();

    const sessionManager = getSessionManager();
    const session = await sessionManager.updateSession(sessionId, {
      cwd: body.cwd,
      env: body.env,
    });

    if (!session) {
      return Response.json(
        { code: ErrorCodes.SESSION_NOT_FOUND, message: "Session not found or expired" },
        { status: 404 }
      );
    }

    return Response.json(sessionToMetadata(session));
  } catch (error) {
    return errorResponse(error, "Failed to update session");
  }
}

function errorResponse(error: unknown, defaultMessage: string): Response {
  const message = error instanceof Error ? error.message : defaultMessage;
  return Response.json(
    { code: ErrorCodes.INTERNAL_ERROR, message },
    { status: 500 }
  );
}

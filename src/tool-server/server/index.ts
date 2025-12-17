/**
 * Tool Server - Main entry point
 */

import { getConfig, loadConfig, setConfig, type ServerConfig } from "./config";
import { SessionManager, setSessionManager } from "../core/session-manager";
import { toolRegistry } from "../tools/registry";

// Import tool adapters to register them
import "../tools/adapters";

// Import route handlers
import {
  createSession,
  getSession,
  deleteSession,
  extendSession,
  listSessions,
  updateSession,
} from "./routes/sessions";

import {
  executeToolSync,
  executeToolStream,
  getExecution,
  listExecutions,
  cancelExecution,
  getExecutionOutput,
} from "./routes/executions";

import {
  listProcesses,
  getProcess,
  killProcess,
} from "./routes/processes";

export interface ToolServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  getUrl(): string;
  getPort(): number;
}

/**
 * Create and start the tool server
 */
export async function createServer(
  configOverrides?: Partial<ServerConfig>
): Promise<ToolServer> {
  // Load configuration
  const config = loadConfig(configOverrides);
  setConfig(config);

  // Initialize session manager
  const sessionManager = new SessionManager(config.dataDir);
  setSessionManager(sessionManager);
  await sessionManager.initialize();

  let server: ReturnType<typeof Bun.serve> | null = null;
  let actualPort = config.port;

  return {
    async start() {
      server = Bun.serve({
        port: config.port,
        hostname: config.host,

        async fetch(req: Request) {
          const url = new URL(req.url);
          const method = req.method;
          const path = url.pathname;

          // CORS preflight
          if (method === "OPTIONS") {
            return new Response(null, {
              headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, Last-Event-ID",
              },
            });
          }

          // Route matching
          try {
            // Sessions
            if (path === "/api/sessions" && method === "GET") {
              return listSessions();
            }

            if (path === "/api/sessions" && method === "POST") {
              return createSession(req);
            }

            const sessionMatch = path.match(/^\/api\/sessions\/([^/]+)$/);
            if (sessionMatch) {
              const sessionId = sessionMatch[1];
              if (method === "GET") return getSession(sessionId);
              if (method === "DELETE") return deleteSession(sessionId);
              if (method === "PATCH") return updateSession(sessionId, req);
            }

            const extendMatch = path.match(/^\/api\/sessions\/([^/]+)\/extend$/);
            if (extendMatch && method === "POST") {
              return extendSession(extendMatch[1], req);
            }

            // Executions
            const execStreamMatch = path.match(
              /^\/api\/sessions\/([^/]+)\/execute\/stream$/
            );
            if (execStreamMatch && method === "POST") {
              return executeToolStream(execStreamMatch[1], req);
            }

            const execMatch = path.match(/^\/api\/sessions\/([^/]+)\/execute$/);
            if (execMatch && method === "POST") {
              return executeToolSync(execMatch[1], req);
            }

            const execListMatch = path.match(
              /^\/api\/sessions\/([^/]+)\/executions$/
            );
            if (execListMatch && method === "GET") {
              return listExecutions(execListMatch[1]);
            }

            const execOutputMatch = path.match(
              /^\/api\/sessions\/([^/]+)\/executions\/([^/]+)\/output$/
            );
            if (execOutputMatch && method === "GET") {
              return getExecutionOutput(execOutputMatch[1], execOutputMatch[2], url);
            }

            const execDetailMatch = path.match(
              /^\/api\/sessions\/([^/]+)\/executions\/([^/]+)$/
            );
            if (execDetailMatch) {
              const [, sessionId, execId] = execDetailMatch;
              if (method === "GET") return getExecution(sessionId, execId);
              if (method === "DELETE") return cancelExecution(sessionId, execId);
            }

            // Processes
            const procListMatch = path.match(
              /^\/api\/sessions\/([^/]+)\/processes$/
            );
            if (procListMatch && method === "GET") {
              return listProcesses(procListMatch[1]);
            }

            const procDetailMatch = path.match(
              /^\/api\/sessions\/([^/]+)\/processes\/([^/]+)$/
            );
            if (procDetailMatch) {
              const [, sessionId, processId] = procDetailMatch;
              if (method === "GET") return getProcess(sessionId, processId);
              if (method === "DELETE") return killProcess(sessionId, processId);
            }

            // Health check
            if (path === "/health" && method === "GET") {
              return Response.json({
                status: "ok",
                tools: toolRegistry.names(),
                timestamp: new Date().toISOString(),
              });
            }

            // Tools list
            if (path === "/api/tools" && method === "GET") {
              const tools = toolRegistry.list().map((t) => ({
                name: t.name,
                description: t.description,
                schema: t.schema,
              }));
              return Response.json({ tools });
            }

            // 404 for unknown routes
            return Response.json(
              { code: "NOT_FOUND", message: "Route not found" },
              { status: 404 }
            );
          } catch (error) {
            console.error("Request error:", error);
            return Response.json(
              {
                code: "INTERNAL_ERROR",
                message: error instanceof Error ? error.message : "Internal error",
              },
              { status: 500 }
            );
          }
        },
      });

      // Get the actual port (important when port: 0 is used)
      actualPort = server.port;
      console.log(`Tool server started on http://${config.host}:${actualPort}`);
    },

    async stop() {
      if (server) {
        server.stop();
        server = null;
      }
      await sessionManager.shutdown();
      console.log("Tool server stopped");
    },

    getUrl() {
      return `http://${config.host}:${actualPort}`;
    },

    getPort() {
      return actualPort;
    },
  };
}

// Export for CLI usage
export { loadConfig, getConfig } from "./config";

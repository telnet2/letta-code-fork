# Tool Server with Session Management

## Overview

A stateful tool server that provides remote tool execution capabilities with persistent session management. The server enables LLM-powered applications to execute tools (shell commands, file operations, etc.) while maintaining state across connections and supporting streaming output.

## Goals

1. **Session Persistence**: Maintain tool execution state across client connections
2. **Execution Tracking**: Track every tool invocation with unique execution IDs
3. **Output Streaming**: Stream stdout/stderr in real-time to clients
4. **Large Output Handling**: Support pagination for large outputs
5. **Automatic Cleanup**: Remove stale sessions after configurable timeout (default 3 days)
6. **Client SDK**: TypeScript client for seamless integration

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Tool Server                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐  │
│  │   HTTP       │    │   Session    │    │   Execution          │  │
│  │   Server     │───▶│   Manager    │───▶│   Manager            │  │
│  │   (Bun)      │    │              │    │                      │  │
│  └──────────────┘    └──────────────┘    └──────────────────────┘  │
│         │                   │                       │               │
│         │                   ▼                       ▼               │
│         │            ┌──────────────┐    ┌──────────────────────┐  │
│         │            │  File System │    │   Tool Registry      │  │
│         │            │   Storage    │    │   (Bash, Read, etc.) │  │
│         │            └──────────────┘    └──────────────────────┘  │
│         │                                                           │
│         ▼                                                           │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                 SSE (Server-Sent Events)                      │  │
│  │  (Real-time stdout/stderr + execution status updates)         │  │
│  │  - Unidirectional: server → client streaming                  │  │
│  │  - Client commands via regular HTTP POST requests             │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                      Tool Server Client                              │
├─────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐  │
│  │   Session    │    │   Tool       │    │   Output             │  │
│  │   Handler    │───▶│   Invoker    │───▶│   Streamer           │  │
│  └──────────────┘    └──────────────┘    └──────────────────────┘  │
│                                                                      │
│  Features:                                                           │
│  - Auto-reconnect with session resumption (SSE built-in)            │
│  - Streaming output display via EventSource                          │
│  - Large output pagination (limit/offset)                           │
│  - LLM-ready result formatting                                       │
└─────────────────────────────────────────────────────────────────────┘
```

### Why SSE over WebSocket?

1. **Simpler** - Unidirectional streaming is all we need (server→client for output)
2. **HTTP-native** - Works through proxies, CDNs, and firewalls without special config
3. **Auto-reconnect** - Browser `EventSource` API has built-in reconnection with `Last-Event-ID`
4. **Matches Letta pattern** - Consistent with how Letta API streams responses
5. **Easier debugging** - Standard HTTP, viewable in browser dev tools
6. **Less overhead** - No connection upgrade, no ping/pong frames

## Data Model

### Session

```typescript
interface Session {
  id: string;                          // UUID v4
  createdAt: Date;
  lastAccessedAt: Date;
  expiresAt: Date;                     // createdAt + 3 days (configurable)

  // Workspace
  workspaceRoot: string;               // /tmp/tool-server/sessions/<session-id>
  cwd: string;                         // Current working directory within workspace

  // Environment
  env: Record<string, string>;         // Environment variables

  // State
  status: 'active' | 'expired' | 'closed';

  // Running processes
  processes: Map<string, ProcessInfo>;

  // Execution history
  executions: Map<string, ExecutionRecord>;
}
```

### ExecutionRecord

```typescript
interface ExecutionRecord {
  id: string;                          // UUID v4 - execution ID
  sessionId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;

  // Timing
  startedAt: Date;
  completedAt?: Date;

  // Status
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

  // Output (stored in files for large outputs)
  stdout: string;
  stderr: string;
  stdoutFile?: string;                 // Path to stdout file if output > threshold
  stderrFile?: string;                 // Path to stderr file if output > threshold

  // Result
  exitCode?: number;
  result?: unknown;
  error?: string;

  // Metadata
  truncated: boolean;                  // True if output was truncated
  totalStdoutSize: number;             // Total bytes written to stdout
  totalStderrSize: number;             // Total bytes written to stderr
}
```

### ProcessInfo

```typescript
interface ProcessInfo {
  id: string;                          // Process tracking ID
  executionId: string;                 // Links to ExecutionRecord
  pid: number;
  command: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: Date;
  completedAt?: Date;
  exitCode?: number;
}
```

## File System Structure

```
/tmp/tool-server/                      # Configurable root
├── sessions/
│   ├── <session-id>/
│   │   ├── session.json               # Session metadata
│   │   ├── workspace/                 # Session's working directory
│   │   │   └── ... (user files)
│   │   ├── executions/
│   │   │   ├── <exec-id>/
│   │   │   │   ├── meta.json          # ExecutionRecord
│   │   │   │   ├── stdout.log         # Full stdout (if large)
│   │   │   │   └── stderr.log         # Full stderr (if large)
│   │   │   └── ...
│   │   └── processes/
│   │       └── <proc-id>.json         # ProcessInfo
│   └── ...
├── index.json                         # Session index for quick lookup
└── cleanup.lock                       # Lock file for cleanup process
```

## API Design

### REST Endpoints

#### Session Management

```
POST   /api/sessions                    # Create new session
GET    /api/sessions/:id                # Get session info
DELETE /api/sessions/:id                # Close/delete session
POST   /api/sessions/:id/extend         # Extend session expiry
```

#### Tool Execution

```
POST   /api/sessions/:id/execute        # Execute a tool (returns execution ID)
GET    /api/sessions/:id/executions     # List all executions
GET    /api/sessions/:id/executions/:execId           # Get execution status/result
GET    /api/sessions/:id/executions/:execId/output    # Get output with pagination
DELETE /api/sessions/:id/executions/:execId           # Cancel execution
```

#### Processes (for background/long-running)

```
GET    /api/sessions/:id/processes      # List running processes
DELETE /api/sessions/:id/processes/:pid # Kill process
```

### SSE Streaming Protocol

#### Execute with Streaming (SSE)

```
POST /api/sessions/:id/execute/stream
Content-Type: application/json
Accept: text/event-stream

{
  "tool": "Bash",
  "args": { "command": "npm install" },
  "timeout": 60000
}
```

The response is an SSE stream (`text/event-stream`):

```
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive

event: started
id: 1
data: {"executionId":"exec_abc123","tool":"Bash"}

event: stdout
id: 2
data: {"executionId":"exec_abc123","data":"Installing dependencies...\n","offset":0}

event: stdout
id: 3
data: {"executionId":"exec_abc123","data":"added 150 packages\n","offset":28}

event: stderr
id: 4
data: {"executionId":"exec_abc123","data":"npm WARN deprecated...\n","offset":0}

event: completed
id: 5
data: {"executionId":"exec_abc123","status":"completed","exitCode":0,"truncated":false,"totalStdoutSize":156,"totalStderrSize":45}

```

#### SSE Event Types

```typescript
// Execution started
event: started
data: {
  executionId: string;
  tool: string;
}

// Output chunk (streamed in real-time)
event: stdout | stderr
data: {
  executionId: string;
  data: string;                        // Output chunk
  offset: number;                      // Byte offset in full output
}

// Execution completed
event: completed
data: {
  executionId: string;
  status: 'completed' | 'failed' | 'cancelled';
  exitCode?: number;
  result?: unknown;
  error?: string;
  truncated: boolean;
  totalStdoutSize: number;
  totalStderrSize: number;
}

// Error during execution
event: error
data: {
  executionId?: string;
  code: string;
  message: string;
}

// Heartbeat (keep connection alive)
event: ping
data: {}
```

#### Reconnection with Last-Event-ID

SSE supports automatic reconnection. If the connection drops, the client can reconnect with the `Last-Event-ID` header:

```
GET /api/sessions/:id/executions/:execId/stream
Last-Event-ID: 3

# Server resumes from event 4 onwards
```

#### Non-Streaming Execution (Simple HTTP)

For tools that complete quickly or when streaming isn't needed:

```
POST /api/sessions/:id/execute
Content-Type: application/json

{
  "tool": "Read",
  "args": { "file_path": "/app/package.json" }
}

# Response (waits for completion)
{
  "executionId": "exec_xyz789",
  "status": "completed",
  "result": { "content": "..." },
  "timing": { "durationMs": 15 }
}
```

## Supported Tools

Based on the existing tool implementations in this codebase:

| Tool | Description | Session State Used |
|------|-------------|-------------------|
| `Bash` | Execute shell commands | cwd, env, processes |
| `BashOutput` | Get background process output | processes |
| `KillBash` | Kill background process | processes |
| `Read` | Read file contents | cwd |
| `Write` | Write file contents | cwd |
| `Edit` | Edit file with replacements | cwd |
| `MultiEdit` | Multiple edits in one call | cwd |
| `Glob` | Find files by pattern | cwd |
| `Grep` | Search file contents | cwd |

### Tool Request/Response

```typescript
// Request
interface ToolExecuteRequest {
  sessionId: string;
  tool: string;
  args: Record<string, unknown>;
  timeout?: number;                    // Override default timeout
  runInBackground?: boolean;           // For Bash tool
}

// Response (immediate)
interface ToolExecuteResponse {
  executionId: string;
  status: 'started' | 'queued';
}

// Result (after completion)
interface ToolExecutionResult {
  executionId: string;
  status: 'completed' | 'failed' | 'cancelled';
  result?: unknown;
  error?: string;
  stdout?: string;                     // Truncated if large
  stderr?: string;                     // Truncated if large
  truncated: boolean;
  timing: {
    startedAt: string;
    completedAt: string;
    durationMs: number;
  };
}
```

## Client SDK

### Installation

```bash
bun add @letta/tool-server-client
```

### Usage

```typescript
import { ToolServerClient } from '@letta/tool-server-client';

// Create client
const client = new ToolServerClient({
  baseUrl: 'http://localhost:3000',
  // Optional: Resume existing session
  sessionId: 'existing-session-id'
});

// Connect and create/resume session
const session = await client.connect();
console.log('Session ID:', session.id);

// Execute tool with streaming
const execution = await client.execute('Bash', {
  command: 'npm install',
  timeout: 60000
});

// Stream output in real-time
for await (const chunk of execution.stream()) {
  if (chunk.type === 'stdout') {
    process.stdout.write(chunk.data);
  } else if (chunk.type === 'stderr') {
    process.stderr.write(chunk.data);
  }
}

// Get final result (for LLM)
const result = await execution.result();
console.log('Exit code:', result.exitCode);
console.log('Output:', result.stdout);

// Query large output with pagination
const page1 = await client.queryOutput(execution.id, {
  stream: 'stdout',
  offset: 0,
  limit: 10000
});

const page2 = await client.queryOutput(execution.id, {
  stream: 'stdout',
  offset: 10000,
  limit: 10000
});

// Close session when done
await client.close();
```

### LLM Integration

```typescript
// Format result for LLM consumption
const llmResult = execution.formatForLLM({
  maxOutputLength: 8000,               // Truncate at this length
  includeMetadata: true                // Include timing, exit code, etc.
});

// Returns string suitable for LLM context:
// "Command: npm install
// Exit Code: 0
// Duration: 5.2s
// Output (truncated, showing 8000/45000 chars):
// <stdout content...>
//
// [Output truncated. Use queryOutput(executionId, {offset: 8000}) to see more]"
```

### Reconnection Handling

SSE has built-in reconnection support via the `EventSource` API. The client leverages this:

```typescript
const client = new ToolServerClient({
  baseUrl: 'http://localhost:3000',
  sessionId: savedSessionId,
});

// Execute with automatic reconnection
const execution = await client.execute('Bash', {
  command: 'npm install',
});

// If connection drops during streaming, SSE automatically reconnects
// using Last-Event-ID header to resume from where it left off
for await (const chunk of execution.stream()) {
  process.stdout.write(chunk.data);
}

// Events for monitoring connection state
client.on('reconnected', (session) => {
  console.log('Reconnected to session:', session.id);
});

client.on('disconnected', (reason) => {
  console.log('Disconnected:', reason);
});
```

### Cancel Execution

Cancellation is done via a separate HTTP request (SSE is unidirectional):

```typescript
// Start long-running command
const execution = await client.execute('Bash', {
  command: 'npm run build:watch',
  runInBackground: true
});

// Cancel it later via HTTP POST
await client.cancel(execution.id);
// or
await execution.cancel();
```

## Configuration

### Server Configuration

```typescript
interface ServerConfig {
  // Network
  port: number;                        // Default: 3000
  host: string;                        // Default: '0.0.0.0'

  // Session
  sessionTimeoutDays: number;          // Default: 3
  maxSessionsPerClient: number;        // Default: 10

  // Storage
  dataDir: string;                     // Default: /tmp/tool-server

  // Execution
  defaultTimeout: number;              // Default: 120000 (2 min)
  maxTimeout: number;                  // Default: 600000 (10 min)

  // Output
  outputTruncateThreshold: number;     // Default: 30000 chars
  maxOutputFileSize: number;           // Default: 10MB

  // Cleanup
  cleanupIntervalHours: number;        // Default: 1

  // Security (future)
  auth: {
    enabled: boolean;
    // ... auth config
  };
}
```

### Environment Variables

```bash
TOOL_SERVER_PORT=3000
TOOL_SERVER_HOST=0.0.0.0
TOOL_SERVER_DATA_DIR=/tmp/tool-server
TOOL_SERVER_SESSION_TIMEOUT_DAYS=3
TOOL_SERVER_DEFAULT_TIMEOUT_MS=120000
TOOL_SERVER_OUTPUT_TRUNCATE=30000
```

## Implementation Plan

### Phase 1: Core Infrastructure ✅ COMPLETED

1. **Project Setup** ✅
   - Create `src/tool-server/` directory structure
   - Set up TypeScript configuration
   - Add dependencies (none beyond Bun built-ins)

2. **Session Manager** ✅
   - Implement `SessionManager` class
   - File system storage for sessions
   - Session creation, retrieval, deletion
   - Automatic cleanup of expired sessions

3. **Execution Manager** ✅
   - Implement `ExecutionManager` class
   - Execution record creation and tracking
   - Output capture and storage
   - Large output file handling

**Tests:** 43 passing tests in `src/tool-server/tests/`

### Phase 2: Tool Integration ✅ COMPLETED

4. **Tool Registry** ✅
   - Adapt existing tool implementations
   - Session-aware tool execution
   - CWD and environment propagation

5. **Tool Adapters** ✅
   - Bash: Shell command execution with streaming
   - Read: File reading with pagination
   - Write: File creation with directory support
   - Edit: String replacement in files
   - Glob: File pattern matching
   - Grep: Content search with regex

6. **Tool Executor** ✅
   - Session-aware execution wrapper
   - Timeout handling with AbortController
   - Output streaming via callbacks
   - Cancellation support

**Tests:** 56 passing tests (13 new tool tests)

### Phase 3: Server Implementation ✅ COMPLETED

7. **HTTP Server** ✅
   - REST API endpoints using `Bun.serve()`
   - Session routes: create, get, list, delete, extend, update
   - Execution routes: execute (sync/stream), list, get, cancel, output
   - Process routes: list, get, kill
   - Health check and tools list endpoints
   - CORS support
   - Request validation and error handling

8. **SSE Streaming** ✅
   - SSEWriter class for managing event streams
   - Real-time output streaming via `text/event-stream`
   - Event ID tracking for reconnection support
   - Heartbeat/keepalive (ping events)
   - Event types: started, stdout, stderr, completed, error, ping

**Tests:** 68 passing tests (12 new server tests)

### Phase 4: Client SDK ✅ COMPLETED

9. **ToolServerClient** ✅
   - createClient factory function
   - Session management: connect, close, extend, getSession
   - Tool execution: execute (sync/stream), cancel
   - Output querying: queryOutput, getExecution, listExecutions
   - Utility methods: listTools, health

10. **SSE Stream Client** ✅
    - parseSSEStream async generator
    - OutputAccumulator for collecting streamed output
    - StreamChunk types for typed event handling

11. **ExecutionHandle** ✅
    - stream() AsyncGenerator for real-time output
    - result() for getting final execution result
    - cancel() for stopping execution
    - queryOutput() for paginated output retrieval
    - formatForLLM() for LLM-ready output formatting

12. **LLM Integration** ✅
    - Configurable max output length
    - Optional metadata (tool name, exit code, duration)
    - Truncation with "use queryOutput" hints
    - Error formatting

**Tests:** 89 passing tests (21 new client tests)

### Phase 5: Polish & Testing ✅ COMPLETED

13. **Error Handling** ✅
    - ErrorCodes enum for typed error responses
    - Graceful error handling in all routes
    - Proper HTTP status codes (4xx, 5xx)

14. **Testing** ✅
    - 89 passing tests total
    - Unit tests for storage, session, execution managers
    - Integration tests for server API
    - Client SDK tests with streaming

15. **CLI Entry Point** ✅
    - `src/tool-server/cli.ts` for running server
    - Command-line argument parsing
    - Environment variable support

**Total: 89 tests passing across 6 test files**

## Implemented File Structure

```
src/tool-server/
├── index.ts                           # Main entry point & exports
├── cli.ts                             # CLI for running server
├── server/
│   ├── index.ts                       # Server factory (createServer)
│   ├── config.ts                      # Configuration & env vars
│   ├── routes/
│   │   ├── sessions.ts                # Session CRUD endpoints
│   │   ├── executions.ts              # Tool execution endpoints
│   │   └── processes.ts               # Process management endpoints
│   └── sse/
│       ├── stream.ts                  # SSEWriter class
│       └── events.ts                  # Event data builders
├── core/
│   ├── index.ts                       # Core module exports
│   ├── session-manager.ts             # SessionManager class
│   ├── execution-manager.ts           # ExecutionManager class
│   ├── process-manager.ts             # ProcessManager class
│   └── storage.ts                     # File system utilities
├── tools/
│   ├── index.ts                       # Tools module exports
│   ├── registry.ts                    # ToolRegistry singleton
│   ├── executor.ts                    # ToolExecutor class
│   └── adapters/
│       ├── index.ts                   # Auto-register all adapters
│       ├── bash.ts                    # Shell command execution
│       ├── read.ts                    # File reading
│       ├── write.ts                   # File writing
│       ├── edit.ts                    # String replacement
│       ├── glob.ts                    # File pattern matching
│       └── grep.ts                    # Content search
├── client/
│   ├── index.ts                       # Client module exports
│   ├── client.ts                      # ToolServerClient class
│   ├── execution.ts                   # ExecutionHandle
│   ├── sse-stream.ts                  # SSE parser & accumulator
│   └── types.ts                       # Client-specific types
├── types/
│   ├── index.ts                       # Type exports
│   ├── session.ts                     # Session types & converters
│   ├── execution.ts                   # Execution types & converters
│   └── protocol.ts                    # SSE protocol types
└── tests/
    ├── storage.test.ts                # Storage utility tests
    ├── session-manager.test.ts        # Session manager tests
    ├── execution-manager.test.ts      # Execution manager tests
    ├── tools.test.ts                  # Tool registry & executor tests
    ├── server.test.ts                 # HTTP API tests
    └── client.test.ts                 # Client SDK tests
```

## Security Considerations (Future)

1. **Authentication**
   - API key authentication
   - JWT token support
   - Session binding to authenticated user

2. **Authorization**
   - Per-tool permission controls
   - Workspace isolation
   - Rate limiting

3. **Sandboxing**
   - Container-based isolation (future)
   - Resource limits (CPU, memory, disk)
   - Network restrictions

4. **Audit Logging**
   - All tool executions logged
   - Session lifecycle events
   - Security events

## Success Metrics

1. **Reliability**: 99.9% uptime for session persistence
2. **Performance**: < 50ms overhead for tool execution start
3. **Streaming**: < 100ms latency for output chunk delivery
4. **Scalability**: Support 1000+ concurrent sessions per server
5. **Recovery**: Full session recovery after server restart

## Open Questions

1. Should we support session cloning/forking?
2. Should we implement session sharing between clients?
3. What's the maximum number of concurrent executions per session?
4. Should we support tool execution queuing?
5. How should we handle filesystem quotas per session?

---

## Next Steps

1. Review and approve this plan
2. Begin Phase 1 implementation
3. Iterate based on feedback

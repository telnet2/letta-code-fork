/**
 * Bash Tool Adapter - Shell command execution
 */

import { exec, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { ExecOptions } from "node:child_process";
import { registerTool, type ToolContext, type ToolResult } from "../registry";

const execAsync = promisify(exec);

const MAX_OUTPUT_SIZE = 30000;

function truncateOutput(output: string, limit: number = MAX_OUTPUT_SIZE): string {
  if (output.length <= limit) {
    return output;
  }
  const truncateMsg = `\n\n[Output truncated: showing ${limit} of ${output.length} chars]`;
  return output.slice(0, limit - truncateMsg.length) + truncateMsg;
}

async function bashImpl(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const command = args.command as string;
  const timeout = (args.timeout as number) ?? 120000;
  const runInBackground = (args.run_in_background as boolean) ?? false;

  if (!command) {
    return {
      content: "Missing required parameter: command",
      status: "error",
      exitCode: 1,
    };
  }

  const cwd = context.cwd;
  const env = context.env;

  if (runInBackground) {
    return runBackgroundCommand(command, cwd, env, timeout, context);
  }

  return runForegroundCommand(command, cwd, env, timeout, context);
}

async function runForegroundCommand(
  command: string,
  cwd: string,
  env: Record<string, string>,
  timeout: number,
  context: ToolContext
): Promise<ToolResult> {
  const effectiveTimeout = Math.min(Math.max(timeout, 1), 600000);

  try {
    const options: ExecOptions = {
      timeout: effectiveTimeout,
      maxBuffer: 10 * 1024 * 1024,
      cwd,
      env,
      signal: context.signal,
    };

    const { stdout, stderr } = await execAsync(command, options);
    const stdoutStr = typeof stdout === "string" ? stdout : stdout.toString();
    const stderrStr = typeof stderr === "string" ? stderr : stderr.toString();

    // Stream output to callbacks
    if (stdoutStr && context.onStdout) {
      context.onStdout(stdoutStr);
    }
    if (stderrStr && context.onStderr) {
      context.onStderr(stderrStr);
    }

    let output = stdoutStr;
    if (stderrStr) {
      output = output ? `${output}\n${stderrStr}` : stderrStr;
    }

    return {
      content: truncateOutput(output || "(Command completed with no output)"),
      status: "success",
      exitCode: 0,
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      killed?: boolean;
      signal?: string;
      code?: string | number;
      name?: string;
    };

    const isAbort =
      context.signal?.aborted ||
      err.code === "ABORT_ERR" ||
      err.name === "AbortError" ||
      err.message === "The operation was aborted";

    if (isAbort) {
      return {
        content: "Command execution was cancelled",
        status: "error",
        exitCode: 130,
      };
    }

    let errorMessage = "";
    if (err.killed && err.signal === "SIGTERM") {
      errorMessage = `Command timed out after ${effectiveTimeout}ms\n`;
    }
    if (err.code) {
      errorMessage += `Exit code: ${err.code}\n`;
    }
    if (err.stderr) {
      errorMessage += err.stderr;
    } else if (err.message) {
      errorMessage += err.message;
    }
    if (err.stdout) {
      errorMessage = `${err.stdout}\n${errorMessage}`;
    }

    // Stream error output
    if (err.stdout && context.onStdout) {
      context.onStdout(err.stdout);
    }
    if (err.stderr && context.onStderr) {
      context.onStderr(err.stderr);
    }

    const exitCode = typeof err.code === "number" ? err.code : 1;

    return {
      content: truncateOutput(errorMessage.trim() || "Command failed"),
      status: "error",
      exitCode,
    };
  }
}

async function runBackgroundCommand(
  command: string,
  cwd: string,
  env: Record<string, string>,
  timeout: number,
  context: ToolContext
): Promise<ToolResult> {
  return new Promise((resolve) => {
    const childProcess = spawn(command, [], {
      shell: true,
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    childProcess.stdout?.on("data", (data: Buffer) => {
      const str = data.toString();
      stdout += str;
      if (context.onStdout) {
        context.onStdout(str);
      }
    });

    childProcess.stderr?.on("data", (data: Buffer) => {
      const str = data.toString();
      stderr += str;
      if (context.onStderr) {
        context.onStderr(str);
      }
    });

    // Set up timeout
    const timeoutId = timeout > 0
      ? setTimeout(() => {
          childProcess.kill("SIGTERM");
        }, timeout)
      : null;

    // Handle abort signal
    if (context.signal) {
      context.signal.addEventListener("abort", () => {
        childProcess.kill("SIGTERM");
      });
    }

    childProcess.on("exit", (code) => {
      if (timeoutId) clearTimeout(timeoutId);

      let output = stdout;
      if (stderr) {
        output = output ? `${output}\n${stderr}` : stderr;
      }

      resolve({
        content: truncateOutput(output || "(Command completed with no output)"),
        status: code === 0 ? "success" : "error",
        exitCode: code ?? 1,
      });
    });

    childProcess.on("error", (err) => {
      if (timeoutId) clearTimeout(timeoutId);
      resolve({
        content: err.message,
        status: "error",
        exitCode: 1,
      });
    });
  });
}

// Register the Bash tool
registerTool({
  name: "Bash",
  description: "Execute shell commands",
  implementation: bashImpl,
  schema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The command to execute",
      },
      timeout: {
        type: "number",
        description: "Timeout in milliseconds (default: 120000, max: 600000)",
      },
      run_in_background: {
        type: "boolean",
        description: "Run command in background (default: false)",
      },
    },
    required: ["command"],
  },
});

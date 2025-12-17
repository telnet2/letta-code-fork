/**
 * Glob Tool Adapter - Find files by pattern
 */

import { join, isAbsolute, resolve } from "path";
import { registerTool, type ToolContext, type ToolResult } from "../registry";

async function globImpl(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const pattern = args.pattern as string;
  const path = args.path as string | undefined;

  if (!pattern) {
    return {
      content: "Missing required parameter: pattern",
      status: "error",
    };
  }

  // Determine base path
  let basePath: string;
  if (path) {
    basePath = isAbsolute(path) ? path : resolve(context.cwd, path);
  } else {
    basePath = context.cwd;
  }

  try {
    // Use Bun's glob functionality
    const glob = new Bun.Glob(pattern);
    const matches: string[] = [];

    for await (const file of glob.scan({
      cwd: basePath,
      onlyFiles: true,
    })) {
      matches.push(file);
      // Limit results to prevent overwhelming output
      if (matches.length >= 1000) {
        break;
      }
    }

    if (matches.length === 0) {
      return {
        content: "No files found",
        status: "success",
      };
    }

    // Sort matches (most recently modified first would require stat calls)
    matches.sort();

    let output = matches.join("\n");
    if (matches.length >= 1000) {
      output += "\n\n[Results limited to 1000 files]";
    }

    if (context.onStdout) {
      context.onStdout(output);
    }

    return {
      content: output,
      status: "success",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      content: `Glob failed: ${message}`,
      status: "error",
    };
  }
}

// Register the Glob tool
registerTool({
  name: "Glob",
  description: "Find files matching a glob pattern",
  implementation: globImpl,
  schema: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: 'Glob pattern to match (e.g., "**/*.ts", "src/**/*.js")',
      },
      path: {
        type: "string",
        description: "Base directory to search in (default: current working directory)",
      },
    },
    required: ["pattern"],
  },
});

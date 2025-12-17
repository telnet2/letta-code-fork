/**
 * Write Tool Adapter - Write content to files
 */

import { dirname, isAbsolute, resolve } from "path";
import { mkdir } from "fs/promises";
import { registerTool, type ToolContext, type ToolResult } from "../registry";

async function writeImpl(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const filePath = args.file_path as string;
  const content = args.content as string;

  if (!filePath) {
    return {
      content: "Missing required parameter: file_path",
      status: "error",
    };
  }

  if (content === undefined) {
    return {
      content: "Missing required parameter: content",
      status: "error",
    };
  }

  // Resolve path relative to session workspace
  const resolvedPath = isAbsolute(filePath)
    ? filePath
    : resolve(context.cwd, filePath);

  // Security: Ensure path is within workspace for relative paths
  const workspaceRoot = context.session.workspaceRoot;
  if (!isAbsolute(filePath) && !resolvedPath.startsWith(workspaceRoot)) {
    return {
      content: `Path escapes workspace: ${filePath}`,
      status: "error",
    };
  }

  try {
    // Create parent directories if needed
    const dir = dirname(resolvedPath);
    await mkdir(dir, { recursive: true });

    // Write the file
    await Bun.write(resolvedPath, content);

    const message = `Successfully wrote ${content.length} bytes to ${resolvedPath}`;
    if (context.onStdout) {
      context.onStdout(message);
    }

    return {
      content: message,
      status: "success",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      content: `Failed to write file: ${message}`,
      status: "error",
    };
  }
}

// Register the Write tool
registerTool({
  name: "Write",
  description: "Write content to a file, creating directories as needed",
  implementation: writeImpl,
  schema: {
    type: "object",
    properties: {
      file_path: {
        type: "string",
        description: "Path to the file to write (absolute or relative to workspace)",
      },
      content: {
        type: "string",
        description: "Content to write to the file",
      },
    },
    required: ["file_path", "content"],
  },
});

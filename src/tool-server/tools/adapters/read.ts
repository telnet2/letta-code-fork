/**
 * Read Tool Adapter - Read file contents
 */

import { join, isAbsolute, resolve } from "path";
import { registerTool, type ToolContext, type ToolResult } from "../registry";

const MAX_LINES = 2000;
const MAX_LINE_LENGTH = 2000;

async function readImpl(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const filePath = args.file_path as string;
  const offset = (args.offset as number) ?? 0;
  const limit = (args.limit as number) ?? MAX_LINES;

  if (!filePath) {
    return {
      content: "Missing required parameter: file_path",
      status: "error",
    };
  }

  // Resolve path relative to session workspace
  const resolvedPath = isAbsolute(filePath)
    ? filePath
    : resolve(context.cwd, filePath);

  // Security: Check if path is within workspace
  const workspaceRoot = context.session.workspaceRoot;
  if (!resolvedPath.startsWith(workspaceRoot) && !isAbsolute(filePath)) {
    // Allow absolute paths for now (they might be system files)
    // In production, you might want to restrict this
  }

  try {
    const file = Bun.file(resolvedPath);

    if (!(await file.exists())) {
      return {
        content: `File not found: ${resolvedPath}`,
        status: "error",
      };
    }

    const content = await file.text();

    // Check for binary content (simple heuristic)
    if (content.includes("\x00")) {
      return {
        content: `Cannot read binary file: ${resolvedPath}`,
        status: "error",
      };
    }

    // Split into lines and apply offset/limit
    const lines = content.split("\n");
    const totalLines = lines.length;
    const startLine = Math.min(offset, totalLines);
    const endLine = Math.min(startLine + limit, totalLines);
    const selectedLines = lines.slice(startLine, endLine);

    // Format with line numbers and truncate long lines
    const formattedLines = selectedLines.map((line, index) => {
      const lineNum = startLine + index + 1;
      const truncatedLine =
        line.length > MAX_LINE_LENGTH
          ? line.slice(0, MAX_LINE_LENGTH) + "..."
          : line;
      // Format: "   123→content" (right-aligned line number)
      const lineNumStr = String(lineNum).padStart(6, " ");
      return `${lineNumStr}→${truncatedLine}`;
    });

    let output = formattedLines.join("\n");

    // Add truncation notice if needed
    if (endLine < totalLines) {
      output += `\n\n[Showing lines ${startLine + 1}-${endLine} of ${totalLines}. Use offset/limit to see more.]`;
    }

    if (context.onStdout) {
      context.onStdout(output);
    }

    return {
      content: output || "(empty file)",
      status: "success",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      content: `Failed to read file: ${message}`,
      status: "error",
    };
  }
}

// Register the Read tool
registerTool({
  name: "Read",
  description: "Read file contents with optional line offset and limit",
  implementation: readImpl,
  schema: {
    type: "object",
    properties: {
      file_path: {
        type: "string",
        description: "Path to the file to read (absolute or relative to workspace)",
      },
      offset: {
        type: "number",
        description: "Line number to start reading from (0-indexed, default: 0)",
      },
      limit: {
        type: "number",
        description: `Number of lines to read (default: ${MAX_LINES})`,
      },
    },
    required: ["file_path"],
  },
});

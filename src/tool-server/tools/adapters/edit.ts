/**
 * Edit Tool Adapter - Perform string replacements in files
 */

import { isAbsolute, resolve } from "path";
import { registerTool, type ToolContext, type ToolResult } from "../registry";

async function editImpl(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const filePath = args.file_path as string;
  const oldString = args.old_string as string;
  const newString = args.new_string as string;
  const replaceAll = (args.replace_all as boolean) ?? false;

  if (!filePath) {
    return {
      content: "Missing required parameter: file_path",
      status: "error",
    };
  }

  if (oldString === undefined) {
    return {
      content: "Missing required parameter: old_string",
      status: "error",
    };
  }

  if (newString === undefined) {
    return {
      content: "Missing required parameter: new_string",
      status: "error",
    };
  }

  if (oldString === newString) {
    return {
      content: "old_string and new_string must be different",
      status: "error",
    };
  }

  // Resolve path relative to session workspace
  const resolvedPath = isAbsolute(filePath)
    ? filePath
    : resolve(context.cwd, filePath);

  try {
    const file = Bun.file(resolvedPath);

    if (!(await file.exists())) {
      return {
        content: `File not found: ${resolvedPath}`,
        status: "error",
      };
    }

    const content = await file.text();

    // Check if old_string exists in the file
    if (!content.includes(oldString)) {
      return {
        content: `String not found in file: "${oldString.slice(0, 50)}${oldString.length > 50 ? "..." : ""}"`,
        status: "error",
      };
    }

    // Count occurrences
    const occurrences = content.split(oldString).length - 1;

    // Check uniqueness if not replacing all
    if (!replaceAll && occurrences > 1) {
      return {
        content: `String "${oldString.slice(0, 50)}${oldString.length > 50 ? "..." : ""}" is not unique (found ${occurrences} times). Use replace_all=true or provide more context.`,
        status: "error",
      };
    }

    // Perform replacement
    const newContent = replaceAll
      ? content.split(oldString).join(newString)
      : content.replace(oldString, newString);

    // Write back
    await Bun.write(resolvedPath, newContent);

    const replacements = replaceAll ? occurrences : 1;
    const message = `Successfully replaced ${replacements} occurrence(s) in ${resolvedPath}`;

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
      content: `Failed to edit file: ${message}`,
      status: "error",
    };
  }
}

// Register the Edit tool
registerTool({
  name: "Edit",
  description: "Perform exact string replacement in a file",
  implementation: editImpl,
  schema: {
    type: "object",
    properties: {
      file_path: {
        type: "string",
        description: "Path to the file to edit",
      },
      old_string: {
        type: "string",
        description: "The exact string to find and replace",
      },
      new_string: {
        type: "string",
        description: "The string to replace with",
      },
      replace_all: {
        type: "boolean",
        description: "Replace all occurrences (default: false)",
      },
    },
    required: ["file_path", "old_string", "new_string"],
  },
});

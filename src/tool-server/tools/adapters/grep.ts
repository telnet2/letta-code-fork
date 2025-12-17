/**
 * Grep Tool Adapter - Search file contents with regex
 */

import { isAbsolute, resolve, join } from "path";
import { registerTool, type ToolContext, type ToolResult } from "../registry";

const MAX_RESULTS = 100;
const MAX_LINE_LENGTH = 500;

type OutputMode = "files_with_matches" | "content" | "count";

async function grepImpl(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const pattern = args.pattern as string;
  const path = args.path as string | undefined;
  const glob = args.glob as string | undefined;
  const outputMode = (args.output_mode as OutputMode) ?? "files_with_matches";
  const caseInsensitive = (args["-i"] as boolean) ?? false;
  const contextBefore = (args["-B"] as number) ?? 0;
  const contextAfter = (args["-A"] as number) ?? 0;
  const contextBoth = (args["-C"] as number) ?? 0;

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
    // Create regex
    const flags = caseInsensitive ? "gi" : "g";
    const regex = new RegExp(pattern, flags);

    // Determine context lines
    const before = contextBoth || contextBefore;
    const after = contextBoth || contextAfter;

    // Find files to search
    const globPattern = glob ?? "**/*";
    const fileGlob = new Bun.Glob(globPattern);
    const results: Array<{
      file: string;
      matches: Array<{ line: number; content: string }>;
      count: number;
    }> = [];

    let totalMatches = 0;

    for await (const filePath of fileGlob.scan({
      cwd: basePath,
      onlyFiles: true,
    })) {
      if (totalMatches >= MAX_RESULTS) break;

      const fullPath = join(basePath, filePath);

      try {
        const file = Bun.file(fullPath);
        if (!(await file.exists())) continue;

        // Skip binary files (simple check)
        const size = file.size;
        if (size > 10 * 1024 * 1024) continue; // Skip files > 10MB

        const content = await file.text();
        if (content.includes("\x00")) continue; // Skip binary

        const lines = content.split("\n");
        const fileMatches: Array<{ line: number; content: string }> = [];
        let fileMatchCount = 0;

        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            fileMatchCount++;
            totalMatches++;

            if (outputMode === "content") {
              // Get context lines
              const startLine = Math.max(0, i - before);
              const endLine = Math.min(lines.length - 1, i + after);

              for (let j = startLine; j <= endLine; j++) {
                const isMatch = j === i;
                const lineContent = lines[j].slice(0, MAX_LINE_LENGTH);
                const prefix = isMatch ? ">" : " ";
                fileMatches.push({
                  line: j + 1,
                  content: `${prefix}${j + 1}: ${lineContent}`,
                });
              }

              // Add separator after context block if there's a gap
              if (endLine < lines.length - 1 && after > 0) {
                fileMatches.push({ line: -1, content: "--" });
              }
            }

            // Reset regex lastIndex for global matching
            regex.lastIndex = 0;

            if (totalMatches >= MAX_RESULTS) break;
          }
        }

        if (fileMatchCount > 0) {
          results.push({
            file: filePath,
            matches: fileMatches,
            count: fileMatchCount,
          });
        }
      } catch {
        // Skip files that can't be read
        continue;
      }
    }

    // Format output based on mode
    let output: string;

    if (results.length === 0) {
      output = "No matches found";
    } else if (outputMode === "files_with_matches") {
      output = `Found ${results.length} files\n${results.map((r) => r.file).join("\n")}`;
    } else if (outputMode === "count") {
      output = results.map((r) => `${r.file}:${r.count}`).join("\n");
    } else {
      // content mode
      const parts: string[] = [];
      for (const result of results) {
        parts.push(`\n${result.file}:`);
        parts.push(
          result.matches
            .filter((m) => m.line !== -1)
            .map((m) => m.content)
            .join("\n")
        );
      }
      output = parts.join("\n").trim();
    }

    if (totalMatches >= MAX_RESULTS) {
      output += `\n\n[Results limited to ${MAX_RESULTS} matches]`;
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
      content: `Grep failed: ${message}`,
      status: "error",
    };
  }
}

// Register the Grep tool
registerTool({
  name: "Grep",
  description: "Search file contents using regex patterns",
  implementation: grepImpl,
  schema: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "Regular expression pattern to search for",
      },
      path: {
        type: "string",
        description: "Directory to search in (default: current working directory)",
      },
      glob: {
        type: "string",
        description: 'File pattern to search (e.g., "*.ts", default: "**/*")',
      },
      output_mode: {
        type: "string",
        enum: ["files_with_matches", "content", "count"],
        description: "Output mode (default: files_with_matches)",
      },
      "-i": {
        type: "boolean",
        description: "Case insensitive search",
      },
      "-B": {
        type: "number",
        description: "Lines of context before match",
      },
      "-A": {
        type: "number",
        description: "Lines of context after match",
      },
      "-C": {
        type: "number",
        description: "Lines of context before and after match",
      },
    },
    required: ["pattern"],
  },
});

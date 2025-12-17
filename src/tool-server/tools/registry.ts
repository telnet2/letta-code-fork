/**
 * Tool Registry - Manages available tools and their implementations
 */

import type { Session } from "../types/session";

export type ToolResult = {
  content: string;
  status: "success" | "error";
  exitCode?: number;
};

export type ToolContext = {
  session: Session;
  cwd: string;
  env: Record<string, string>;
  signal?: AbortSignal;
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
};

export type ToolImplementation = (
  args: Record<string, unknown>,
  context: ToolContext
) => Promise<ToolResult>;

export interface ToolDefinition {
  name: string;
  description: string;
  implementation: ToolImplementation;
  schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  /**
   * Register a tool
   */
  register(definition: ToolDefinition): void {
    this.tools.set(definition.name, definition);
  }

  /**
   * Get a tool by name
   */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * Check if a tool exists
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * List all registered tools
   */
  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get tool names
   */
  names(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Unregister a tool
   */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * Clear all tools
   */
  clear(): void {
    this.tools.clear();
  }
}

// Singleton registry instance
export const toolRegistry = new ToolRegistry();

/**
 * Helper to register a tool
 */
export function registerTool(definition: ToolDefinition): void {
  toolRegistry.register(definition);
}

/**
 * Helper to get a tool
 */
export function getTool(name: string): ToolDefinition | undefined {
  return toolRegistry.get(name);
}

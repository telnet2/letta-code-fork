/**
 * Tool Server Configuration
 */

import { join } from "path";
import { tmpdir } from "os";

export interface ServerConfig {
  // Network
  port: number;
  host: string;

  // Session
  sessionTimeoutDays: number;
  maxSessionsPerClient: number;

  // Storage
  dataDir: string;

  // Execution
  defaultTimeoutMs: number;
  maxTimeoutMs: number;

  // Output
  outputTruncateThreshold: number;
  maxOutputFileSize: number;

  // Cleanup
  cleanupIntervalMs: number;
}

const DEFAULT_CONFIG: ServerConfig = {
  port: 3000,
  host: "0.0.0.0",
  sessionTimeoutDays: 3,
  maxSessionsPerClient: 10,
  dataDir: join(tmpdir(), "tool-server"),
  defaultTimeoutMs: 120_000, // 2 minutes
  maxTimeoutMs: 600_000, // 10 minutes
  outputTruncateThreshold: 30_000, // 30KB
  maxOutputFileSize: 10 * 1024 * 1024, // 10MB
  cleanupIntervalMs: 60 * 60 * 1000, // 1 hour
};

function parseEnvInt(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

export function loadConfig(overrides?: Partial<ServerConfig>): ServerConfig {
  const envConfig: Partial<ServerConfig> = {
    port: parseEnvInt(process.env.TOOL_SERVER_PORT, DEFAULT_CONFIG.port),
    host: process.env.TOOL_SERVER_HOST || DEFAULT_CONFIG.host,
    dataDir: process.env.TOOL_SERVER_DATA_DIR || DEFAULT_CONFIG.dataDir,
    sessionTimeoutDays: parseEnvInt(
      process.env.TOOL_SERVER_SESSION_TIMEOUT_DAYS,
      DEFAULT_CONFIG.sessionTimeoutDays
    ),
    defaultTimeoutMs: parseEnvInt(
      process.env.TOOL_SERVER_DEFAULT_TIMEOUT_MS,
      DEFAULT_CONFIG.defaultTimeoutMs
    ),
    outputTruncateThreshold: parseEnvInt(
      process.env.TOOL_SERVER_OUTPUT_TRUNCATE,
      DEFAULT_CONFIG.outputTruncateThreshold
    ),
  };

  return {
    ...DEFAULT_CONFIG,
    ...envConfig,
    ...overrides,
  };
}

// Singleton config instance
let _config: ServerConfig | null = null;

export function getConfig(): ServerConfig {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}

export function setConfig(config: ServerConfig): void {
  _config = config;
}

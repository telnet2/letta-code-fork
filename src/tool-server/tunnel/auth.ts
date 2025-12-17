/**
 * Authentication Utilities for Tunnel
 *
 * Provides token generation and validation for tunnel authentication.
 */

import { createHash, randomBytes } from "crypto";

// ============================================================================
// Token Types
// ============================================================================

export interface TokenPayload {
  clientId: string;
  createdAt: number;
  expiresAt: number;
  permissions?: string[];
}

export interface TokenValidationResult {
  valid: boolean;
  payload?: TokenPayload;
  error?: string;
}

// ============================================================================
// Simple Token Implementation
// ============================================================================

/**
 * Generate a simple bearer token
 * Format: base64(clientId:timestamp:signature)
 */
export function generateToken(
  clientId: string,
  secret: string,
  expiresInMs: number = 86400000 // 24 hours
): string {
  const createdAt = Date.now();
  const expiresAt = createdAt + expiresInMs;

  const payload: TokenPayload = {
    clientId,
    createdAt,
    expiresAt,
  };

  const payloadStr = JSON.stringify(payload);
  const signature = createSignature(payloadStr, secret);

  const token = Buffer.from(`${payloadStr}:${signature}`).toString("base64");
  return token;
}

/**
 * Validate a token
 */
export function validateToken(token: string, secret: string): TokenValidationResult {
  try {
    const decoded = Buffer.from(token, "base64").toString("utf-8");
    const lastColonIndex = decoded.lastIndexOf(":");

    if (lastColonIndex === -1) {
      return { valid: false, error: "Invalid token format" };
    }

    const payloadStr = decoded.substring(0, lastColonIndex);
    const signature = decoded.substring(lastColonIndex + 1);

    // Verify signature
    const expectedSignature = createSignature(payloadStr, secret);
    if (signature !== expectedSignature) {
      return { valid: false, error: "Invalid signature" };
    }

    // Parse payload
    const payload: TokenPayload = JSON.parse(payloadStr);

    // Check expiration
    if (Date.now() > payload.expiresAt) {
      return { valid: false, error: "Token expired" };
    }

    return { valid: true, payload };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Create HMAC signature
 */
function createSignature(data: string, secret: string): string {
  return createHash("sha256")
    .update(data + secret)
    .digest("hex");
}

// ============================================================================
// Token Validator Factory
// ============================================================================

/**
 * Create a token validator function for use with TunnelServer
 */
export function createTokenValidator(
  secret: string
): (token: string) => Promise<boolean> {
  return async (token: string): Promise<boolean> => {
    const result = validateToken(token, secret);
    return result.valid;
  };
}

/**
 * Create a token validator with custom validation logic
 */
export function createCustomTokenValidator(
  validateFn: (payload: TokenPayload) => Promise<boolean>,
  secret: string
): (token: string) => Promise<boolean> {
  return async (token: string): Promise<boolean> => {
    const result = validateToken(token, secret);
    if (!result.valid || !result.payload) {
      return false;
    }
    return validateFn(result.payload);
  };
}

// ============================================================================
// Random Secret Generation
// ============================================================================

/**
 * Generate a cryptographically secure random secret
 */
export function generateSecret(length: number = 32): string {
  return randomBytes(length).toString("hex");
}

/**
 * Generate a random client ID
 */
export function generateClientId(): string {
  return `client_${randomBytes(8).toString("hex")}`;
}

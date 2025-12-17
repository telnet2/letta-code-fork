/**
 * File System Storage Utilities
 */

import { join, dirname } from "path";

/**
 * Ensure a directory exists, creating it if necessary
 */
export async function ensureDir(dirPath: string): Promise<void> {
  const file = Bun.file(join(dirPath, ".keep"));
  if (!(await file.exists())) {
    await Bun.write(file, "");
  }
  // Clean up the .keep file
  try {
    const { unlink } = await import("fs/promises");
    await unlink(join(dirPath, ".keep"));
  } catch {
    // Ignore if file doesn't exist
  }
}

/**
 * Check if a directory exists
 */
export async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const { stat } = await import("fs/promises");
    const stats = await stat(dirPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Read JSON file
 */
export async function readJson<T>(filePath: string): Promise<T | null> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    return null;
  }
  try {
    const content = await file.text();
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/**
 * Write JSON file (creates directories if needed)
 */
export async function writeJson<T>(filePath: string, data: T): Promise<void> {
  const dir = dirname(filePath);
  const { mkdir } = await import("fs/promises");
  await mkdir(dir, { recursive: true });
  await Bun.write(filePath, JSON.stringify(data, null, 2));
}

/**
 * Append to a file
 */
export async function appendFile(filePath: string, data: string): Promise<void> {
  const { appendFile: fsAppend, mkdir } = await import("fs/promises");
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });
  await fsAppend(filePath, data);
}

/**
 * Read file with offset and limit
 */
export async function readFileRange(
  filePath: string,
  offset: number = 0,
  limit?: number
): Promise<{ data: string; totalSize: number; hasMore: boolean }> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    return { data: "", totalSize: 0, hasMore: false };
  }

  const totalSize = file.size;
  const endOffset = limit ? Math.min(offset + limit, totalSize) : totalSize;
  const data = await file.slice(offset, endOffset).text();
  const hasMore = endOffset < totalSize;

  return { data, totalSize, hasMore };
}

/**
 * Delete a file
 */
export async function deleteFile(filePath: string): Promise<boolean> {
  try {
    const { unlink } = await import("fs/promises");
    await unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete a directory recursively
 */
export async function deleteDir(dirPath: string): Promise<boolean> {
  try {
    const { rm } = await import("fs/promises");
    await rm(dirPath, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * List files in a directory
 */
export async function listDir(dirPath: string): Promise<string[]> {
  try {
    const { readdir } = await import("fs/promises");
    return await readdir(dirPath);
  } catch {
    return [];
  }
}

/**
 * Get file size
 */
export async function getFileSize(filePath: string): Promise<number> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    return 0;
  }
  return file.size;
}

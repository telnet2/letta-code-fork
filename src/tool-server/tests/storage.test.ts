/**
 * Storage Utilities Tests
 */

import { test, expect, beforeEach, afterEach, describe } from "bun:test";
import { join } from "path";
import { tmpdir } from "os";
import { rm, mkdir, writeFile } from "fs/promises";
import {
  readJson,
  writeJson,
  appendFile,
  readFileRange,
  deleteFile,
  deleteDir,
  listDir,
  getFileSize,
  dirExists,
} from "../core/storage";

describe("Storage Utilities", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `storage-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("JSON operations", () => {
    test("writes and reads JSON", async () => {
      const data = { name: "test", value: 42, nested: { a: 1 } };
      const filePath = join(testDir, "test.json");

      await writeJson(filePath, data);
      const read = await readJson<typeof data>(filePath);

      expect(read).toEqual(data);
    });

    test("returns null for non-existent file", async () => {
      const result = await readJson(join(testDir, "missing.json"));
      expect(result).toBeNull();
    });

    test("creates nested directories when writing", async () => {
      const filePath = join(testDir, "nested", "deep", "file.json");
      await writeJson(filePath, { test: true });

      const read = await readJson<{ test: boolean }>(filePath);
      expect(read).toEqual({ test: true });
    });
  });

  describe("appendFile", () => {
    test("appends to existing file", async () => {
      const filePath = join(testDir, "append.txt");
      await writeFile(filePath, "line1\n");

      await appendFile(filePath, "line2\n");
      await appendFile(filePath, "line3\n");

      const content = await Bun.file(filePath).text();
      expect(content).toBe("line1\nline2\nline3\n");
    });

    test("creates file if not exists", async () => {
      const filePath = join(testDir, "new.txt");
      await appendFile(filePath, "content");

      const content = await Bun.file(filePath).text();
      expect(content).toBe("content");
    });
  });

  describe("readFileRange", () => {
    test("reads entire file", async () => {
      const filePath = join(testDir, "range.txt");
      await writeFile(filePath, "0123456789");

      const result = await readFileRange(filePath);
      expect(result.data).toBe("0123456789");
      expect(result.totalSize).toBe(10);
      expect(result.hasMore).toBe(false);
    });

    test("reads with offset", async () => {
      const filePath = join(testDir, "range.txt");
      await writeFile(filePath, "0123456789");

      const result = await readFileRange(filePath, 5);
      expect(result.data).toBe("56789");
      expect(result.hasMore).toBe(false);
    });

    test("reads with limit", async () => {
      const filePath = join(testDir, "range.txt");
      await writeFile(filePath, "0123456789");

      const result = await readFileRange(filePath, 0, 5);
      expect(result.data).toBe("01234");
      expect(result.hasMore).toBe(true);
    });

    test("reads with offset and limit", async () => {
      const filePath = join(testDir, "range.txt");
      await writeFile(filePath, "0123456789");

      const result = await readFileRange(filePath, 3, 4);
      expect(result.data).toBe("3456");
      expect(result.hasMore).toBe(true);
    });

    test("returns empty for non-existent file", async () => {
      const result = await readFileRange(join(testDir, "missing.txt"));
      expect(result.data).toBe("");
      expect(result.totalSize).toBe(0);
      expect(result.hasMore).toBe(false);
    });
  });

  describe("directory operations", () => {
    test("checks if directory exists", async () => {
      expect(await dirExists(testDir)).toBe(true);
      expect(await dirExists(join(testDir, "missing"))).toBe(false);
    });

    test("lists directory contents", async () => {
      await writeFile(join(testDir, "a.txt"), "");
      await writeFile(join(testDir, "b.txt"), "");
      await mkdir(join(testDir, "subdir"));

      const contents = await listDir(testDir);
      expect(contents).toContain("a.txt");
      expect(contents).toContain("b.txt");
      expect(contents).toContain("subdir");
    });

    test("returns empty array for non-existent directory", async () => {
      const contents = await listDir(join(testDir, "missing"));
      expect(contents).toEqual([]);
    });

    test("deletes directory recursively", async () => {
      const subdir = join(testDir, "to-delete");
      await mkdir(subdir);
      await writeFile(join(subdir, "file.txt"), "content");

      const deleted = await deleteDir(subdir);
      expect(deleted).toBe(true);
      expect(await dirExists(subdir)).toBe(false);
    });
  });

  describe("file operations", () => {
    test("deletes a file", async () => {
      const filePath = join(testDir, "delete-me.txt");
      await writeFile(filePath, "content");

      const deleted = await deleteFile(filePath);
      expect(deleted).toBe(true);

      const exists = await Bun.file(filePath).exists();
      expect(exists).toBe(false);
    });

    test("returns false when deleting non-existent file", async () => {
      const deleted = await deleteFile(join(testDir, "missing.txt"));
      expect(deleted).toBe(false);
    });

    test("gets file size", async () => {
      const filePath = join(testDir, "sized.txt");
      await writeFile(filePath, "12345");

      const size = await getFileSize(filePath);
      expect(size).toBe(5);
    });

    test("returns 0 for non-existent file size", async () => {
      const size = await getFileSize(join(testDir, "missing.txt"));
      expect(size).toBe(0);
    });
  });
});

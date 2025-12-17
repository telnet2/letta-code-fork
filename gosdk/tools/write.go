package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// WriteTool writes files to the local filesystem.
type WriteTool struct {
	BaseTool
	workDir string
}

// WriteArgs represents the arguments for the Write tool.
type WriteArgs struct {
	FilePath string `json:"file_path"`
	Content  string `json:"content"`
}

// NewWriteTool creates a new Write tool instance.
func NewWriteTool(workDir string) *WriteTool {
	return &WriteTool{
		BaseTool: BaseTool{
			name: "Write",
			description: `Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST use the Read tool first to read the file's contents. This tool will fail if you did not read the file first.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.
- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.`,
		},
		workDir: workDir,
	}
}

// Call executes the write operation.
func (t *WriteTool) Call(ctx context.Context, input string) (string, error) {
	if err := validateContext(ctx); err != nil {
		return ErrorResult(err), nil
	}

	var args WriteArgs
	if err := json.Unmarshal([]byte(input), &args); err != nil {
		return ErrorResult(fmt.Errorf("invalid input: %w", err)), nil
	}

	if args.FilePath == "" {
		return ErrorResult(fmt.Errorf("file_path is required")), nil
	}

	if args.Content == "" {
		return ErrorResult(fmt.Errorf("content is required")), nil
	}

	// Validate absolute path
	if !filepath.IsAbs(args.FilePath) {
		return ErrorResult(fmt.Errorf("file path must be absolute, got: %s", args.FilePath)), nil
	}

	// Create parent directories if needed
	dir := filepath.Dir(args.FilePath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return ErrorResult(fmt.Errorf("failed to create directory: %w", err)), nil
	}

	// Check if path is a directory
	if stat, err := os.Stat(args.FilePath); err == nil && stat.IsDir() {
		return ErrorResult(fmt.Errorf("path is a directory, not a file: %s", args.FilePath)), nil
	}

	// Write the file
	if err := os.WriteFile(args.FilePath, []byte(args.Content), 0644); err != nil {
		if os.IsPermission(err) {
			return ErrorResult(fmt.Errorf("permission denied: %s", args.FilePath)), nil
		}
		return ErrorResult(err), nil
	}

	return SuccessResult(fmt.Sprintf("Successfully wrote %d characters to %s", len(args.Content), args.FilePath)), nil
}

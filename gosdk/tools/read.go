package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

// ReadTool reads files from the local filesystem.
type ReadTool struct {
	BaseTool
	workDir string
}

// ReadArgs represents the arguments for the Read tool.
type ReadArgs struct {
	FilePath string `json:"file_path"`
	Offset   int    `json:"offset,omitempty"` // Line number to start from (0-based)
	Limit    int    `json:"limit,omitempty"`  // Number of lines to read
}

// NewReadTool creates a new Read tool instance.
func NewReadTool(workDir string) *ReadTool {
	return &ReadTool{
		BaseTool: BaseTool{
			name: "Read",
			description: `Reads a file from the local filesystem. You can access any file directly by using this tool.
Assume this tool is able to read all files on the machine. If the User provides a path to a file assume that path is valid. It is okay to read a file that does not exist; an error will be returned.

Usage:
- The file_path parameter must be an absolute path, not a relative path
- By default, it reads up to 2000 lines starting from the beginning of the file
- You can optionally specify a line offset and limit (especially handy for long files), but it's recommended to read the whole file by not providing these parameters
- Any lines longer than 2000 characters will be truncated
- Results are returned using cat -n format, with line numbers starting at 1
- This tool can only read files, not directories. To read a directory, use the ls command via Bash.
- You can call multiple tools in a single response. It is always better to speculatively read multiple potentially useful files in parallel.
- If you read a file that exists but has empty contents you will receive a system reminder warning in place of file contents.`,
		},
		workDir: workDir,
	}
}

// Call executes the read operation.
func (t *ReadTool) Call(ctx context.Context, input string) (string, error) {
	if err := validateContext(ctx); err != nil {
		return ErrorResult(err), nil
	}

	var args ReadArgs
	if err := json.Unmarshal([]byte(input), &args); err != nil {
		return ErrorResult(fmt.Errorf("invalid input: %w", err)), nil
	}

	if args.FilePath == "" {
		return ErrorResult(fmt.Errorf("file_path is required")), nil
	}

	// Resolve path
	resolvedPath := args.FilePath
	if !filepath.IsAbs(resolvedPath) {
		resolvedPath = filepath.Join(t.workDir, resolvedPath)
	}

	// Check if path exists and is not a directory
	stat, err := os.Stat(resolvedPath)
	if err != nil {
		if os.IsNotExist(err) {
			return ErrorResult(fmt.Errorf("file does not exist. Attempted path: %s. Current working directory: %s", resolvedPath, t.workDir)), nil
		}
		if os.IsPermission(err) {
			return ErrorResult(fmt.Errorf("permission denied: %s", resolvedPath)), nil
		}
		return ErrorResult(err), nil
	}

	if stat.IsDir() {
		return ErrorResult(fmt.Errorf("path is a directory, not a file: %s", resolvedPath)), nil
	}

	// Check file size (10MB max)
	maxSize := int64(10 * 1024 * 1024)
	if stat.Size() > maxSize {
		return ErrorResult(fmt.Errorf("file too large: %d bytes (max %d bytes)", stat.Size(), maxSize)), nil
	}

	// Check if binary file
	if isBinary, err := isBinaryFile(resolvedPath); err != nil {
		return ErrorResult(err), nil
	} else if isBinary {
		return ErrorResult(fmt.Errorf("cannot read binary file: %s", resolvedPath)), nil
	}

	// Read file content
	content, err := os.ReadFile(resolvedPath)
	if err != nil {
		return ErrorResult(err), nil
	}

	// Check for empty file
	if len(strings.TrimSpace(string(content))) == 0 {
		return SuccessResult(fmt.Sprintf("<system-reminder>\nThe file %s exists but has empty contents.\n</system-reminder>", resolvedPath)), nil
	}

	// Format with line numbers
	formatted := formatWithLineNumbers(string(content), args.Offset, args.Limit)
	return SuccessResult(formatted), nil
}

// isBinaryFile checks if a file appears to be binary.
func isBinaryFile(path string) (bool, error) {
	file, err := os.Open(path)
	if err != nil {
		return false, err
	}
	defer file.Close()

	// Read up to 8KB
	buf := make([]byte, 8192)
	n, err := file.Read(buf)
	if err != nil && n == 0 {
		return false, nil // Empty file is not binary
	}
	buf = buf[:n]

	// Check for null bytes (definite binary indicator)
	for _, b := range buf {
		if b == 0 {
			return true, nil
		}
	}

	// Check if valid UTF-8
	if !utf8.Valid(buf) {
		return true, nil
	}

	// Count control characters (excluding whitespace)
	controlCount := 0
	for _, b := range buf {
		if b < 9 || (b > 13 && b < 32) {
			controlCount++
		}
	}

	// If more than 30% control characters, consider binary
	return float64(controlCount)/float64(len(buf)) > 0.3, nil
}

// formatWithLineNumbers formats content with line numbers like cat -n.
func formatWithLineNumbers(content string, offset, limit int) string {
	lines := strings.Split(content, "\n")
	originalLineCount := len(lines)

	// Apply default limit if not specified
	effectiveLimit := limit
	if effectiveLimit <= 0 {
		effectiveLimit = Limits.ReadMaxLines
	}

	startLine := offset
	if startLine < 0 {
		startLine = 0
	}
	if startLine > len(lines) {
		startLine = len(lines)
	}

	endLine := startLine + effectiveLimit
	if endLine > len(lines) {
		endLine = len(lines)
	}

	selectedLines := lines[startLine:endLine]

	// Calculate padding for line numbers
	maxLineNum := startLine + len(selectedLines)
	padding := len(fmt.Sprintf("%d", maxLineNum))
	if padding < 1 {
		padding = 1
	}

	var result strings.Builder
	var truncatedLines bool

	for i, line := range selectedLines {
		lineNum := startLine + i + 1 // 1-based line numbers

		// Truncate long lines
		if len(line) > Limits.ReadMaxCharsPerLine {
			line = line[:Limits.ReadMaxCharsPerLine] + "... [line truncated]"
			truncatedLines = true
		}

		result.WriteString(fmt.Sprintf("%*d→%s", padding, lineNum, line))
		if i < len(selectedLines)-1 {
			result.WriteString("\n")
		}
	}

	// Add truncation notices
	var notices []string
	wasTruncatedByLineCount := endLine < originalLineCount

	if wasTruncatedByLineCount && limit <= 0 {
		notices = append(notices, fmt.Sprintf(
			"\n\n[File truncated: showing lines %d-%d of %d total lines. Use offset and limit parameters to read other sections.]",
			startLine+1, endLine, originalLineCount,
		))
	}

	if truncatedLines {
		notices = append(notices, fmt.Sprintf(
			"\n\n[Some lines exceeded %d characters and were truncated.]",
			Limits.ReadMaxCharsPerLine,
		))
	}

	for _, notice := range notices {
		result.WriteString(notice)
	}

	return result.String()
}

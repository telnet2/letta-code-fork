package tools

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

// GrepTool performs powerful regex-based content search using ripgrep.
type GrepTool struct {
	BaseTool
	workDir string
}

// GrepArgs represents the arguments for the Grep tool.
type GrepArgs struct {
	Pattern    string `json:"pattern"`
	Path       string `json:"path,omitempty"`
	Glob       string `json:"glob,omitempty"`
	OutputMode string `json:"output_mode,omitempty"` // "content", "files_with_matches", "count"
	Before     int    `json:"-B,omitempty"`
	After      int    `json:"-A,omitempty"`
	Context    int    `json:"-C,omitempty"`
	LineNums   *bool  `json:"-n,omitempty"`
	IgnoreCase bool   `json:"-i,omitempty"`
	FileType   string `json:"type,omitempty"`
	HeadLimit  int    `json:"head_limit,omitempty"`
	Offset     int    `json:"offset,omitempty"`
	Multiline  bool   `json:"multiline,omitempty"`
}

// GrepResult represents the result of a grep operation.
type GrepResult struct {
	Output  string `json:"output"`
	Matches int    `json:"matches,omitempty"`
	Files   int    `json:"files,omitempty"`
}

// NewGrepTool creates a new Grep tool instance.
func NewGrepTool(workDir string) *GrepTool {
	return &GrepTool{
		BaseTool: BaseTool{
			name: "Grep",
			description: `A powerful search tool built on ripgrep.

Usage:
- ALWAYS use Grep for search tasks. NEVER invoke ` + "`grep`" + ` or ` + "`rg`" + ` as a Bash command. The Grep tool has been optimized for correct permissions and access.
- Supports full regex syntax (e.g., "log.*Error", "function\s+\w+")
- Filter files with glob parameter (e.g., "*.js", "**/*.tsx") or type parameter (e.g., "js", "py", "rust")
- Output modes: "content" shows matching lines, "files_with_matches" shows only file paths (default), "count" shows match counts
- Use Task tool for open-ended searches requiring multiple rounds
- Pattern syntax: Uses ripgrep (not grep) - literal braces need escaping (use ` + "`interface\\{\\}`" + ` to find ` + "`interface{}`" + ` in Go code)
- Multiline matching: By default patterns match within single lines only. For cross-line patterns like ` + "`struct \\{[\\s\\S]*?field`" + `, use ` + "`multiline: true`" + `
- If the output exceeds 10,000 characters, it will be truncated before being returned to you`,
		},
		workDir: workDir,
	}
}

// Call executes the grep operation.
func (t *GrepTool) Call(ctx context.Context, input string) (string, error) {
	if err := validateContext(ctx); err != nil {
		return ErrorResult(err), nil
	}

	var args GrepArgs
	if err := json.Unmarshal([]byte(input), &args); err != nil {
		return ErrorResult(fmt.Errorf("invalid input: %w", err)), nil
	}

	if args.Pattern == "" {
		return ErrorResult(fmt.Errorf("pattern is required")), nil
	}

	// Default output mode
	outputMode := args.OutputMode
	if outputMode == "" {
		outputMode = "files_with_matches"
	}

	// Default head limit
	headLimit := args.HeadLimit
	if headLimit == 0 {
		headLimit = 100
	}

	// Build ripgrep arguments
	rgArgs := []string{}

	switch outputMode {
	case "files_with_matches":
		rgArgs = append(rgArgs, "-l")
	case "count":
		rgArgs = append(rgArgs, "-c")
	case "content":
		if args.Context > 0 {
			rgArgs = append(rgArgs, "-C", strconv.Itoa(args.Context))
		} else {
			if args.Before > 0 {
				rgArgs = append(rgArgs, "-B", strconv.Itoa(args.Before))
			}
			if args.After > 0 {
				rgArgs = append(rgArgs, "-A", strconv.Itoa(args.After))
			}
		}
		// Line numbers default to true for content mode
		showLineNums := true
		if args.LineNums != nil {
			showLineNums = *args.LineNums
		}
		if showLineNums {
			rgArgs = append(rgArgs, "-n")
		}
	}

	if args.IgnoreCase {
		rgArgs = append(rgArgs, "-i")
	}

	if args.FileType != "" {
		rgArgs = append(rgArgs, "--type", args.FileType)
	}

	if args.Glob != "" {
		rgArgs = append(rgArgs, "--glob", args.Glob)
	}

	if args.Multiline {
		rgArgs = append(rgArgs, "-U", "--multiline-dotall")
	}

	rgArgs = append(rgArgs, args.Pattern)

	// Determine search path
	searchPath := t.workDir
	if args.Path != "" {
		if filepath.IsAbs(args.Path) {
			searchPath = args.Path
		} else {
			searchPath = filepath.Join(t.workDir, args.Path)
		}
	}
	rgArgs = append(rgArgs, searchPath)

	// Execute ripgrep
	cmd := exec.CommandContext(ctx, "rg", rgArgs...)
	cmd.Dir = t.workDir

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()

	// Handle ripgrep exit codes
	// Exit code 1 means no matches found (not an error)
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			if exitErr.ExitCode() == 1 {
				// No matches found
				return t.formatNoMatches(outputMode), nil
			}
		}
		return ErrorResult(fmt.Errorf("grep failed: %s", stderr.String())), nil
	}

	output := stdout.String()
	return t.formatOutput(output, outputMode, args.Offset, headLimit), nil
}

func (t *GrepTool) formatNoMatches(outputMode string) string {
	switch outputMode {
	case "files_with_matches":
		result := GrepResult{Output: "No files found", Files: 0}
		data, _ := json.Marshal(result)
		return SuccessResult(string(data))
	case "count":
		result := GrepResult{
			Output:  "0\n\nFound 0 total occurrences across 0 files.",
			Matches: 0,
			Files:   0,
		}
		data, _ := json.Marshal(result)
		return SuccessResult(string(data))
	default:
		result := GrepResult{Output: "No matches found", Matches: 0}
		data, _ := json.Marshal(result)
		return SuccessResult(string(data))
	}
}

func (t *GrepTool) formatOutput(output, outputMode string, offset, headLimit int) string {
	lines := strings.Split(strings.TrimSpace(output), "\n")
	if len(lines) == 1 && lines[0] == "" {
		return t.formatNoMatches(outputMode)
	}

	// Apply offset and limit
	if offset > 0 {
		if offset >= len(lines) {
			lines = []string{}
		} else {
			lines = lines[offset:]
		}
	}

	totalCount := len(lines)
	if headLimit > 0 && len(lines) > headLimit {
		lines = lines[:headLimit]
	}

	var result GrepResult

	switch outputMode {
	case "files_with_matches":
		fileCount := len(lines)
		showing := ""
		if fileCount < totalCount {
			showing = fmt.Sprintf(" (showing %d)", fileCount)
		}
		result = GrepResult{
			Output: fmt.Sprintf("Found %d file%s%s\n%s",
				totalCount,
				pluralize(totalCount),
				showing,
				strings.Join(lines, "\n"),
			),
			Files: totalCount,
		}

	case "count":
		var totalMatches, filesWithMatches int
		for _, line := range lines {
			parts := strings.Split(line, ":")
			if len(parts) >= 2 {
				lastPart := parts[len(parts)-1]
				if count, err := strconv.Atoi(strings.TrimSpace(lastPart)); err == nil && count > 0 {
					totalMatches += count
					filesWithMatches++
				}
			}
		}
		result = GrepResult{
			Output: fmt.Sprintf("%s\n\nFound %d total occurrence%s across %d file%s.",
				strings.Join(lines, "\n"),
				totalMatches, pluralize(totalMatches),
				filesWithMatches, pluralize(filesWithMatches),
			),
			Matches: totalMatches,
			Files:   filesWithMatches,
		}

	default: // content
		content := strings.Join(lines, "\n")
		// Apply character limit
		if len(content) > Limits.GrepOutputChars {
			content = content[:Limits.GrepOutputChars] + "\n[Output truncated]"
		}
		result = GrepResult{
			Output:  content,
			Matches: totalCount,
		}
	}

	data, _ := json.Marshal(result)
	return SuccessResult(string(data))
}

func pluralize(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}

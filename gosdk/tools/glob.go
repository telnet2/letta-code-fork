package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/bmatcuk/doublestar/v4"
)

// GlobTool performs fast file pattern matching.
type GlobTool struct {
	BaseTool
	workDir string
}

// GlobArgs represents the arguments for the Glob tool.
type GlobArgs struct {
	Pattern string `json:"pattern"`
	Path    string `json:"path,omitempty"`
}

// GlobResult represents the result of a glob operation.
type GlobResult struct {
	Files     []string `json:"files"`
	Truncated bool     `json:"truncated,omitempty"`
	Total     int      `json:"total,omitempty"`
}

// NewGlobTool creates a new Glob tool instance.
func NewGlobTool(workDir string) *GlobTool {
	return &GlobTool{
		BaseTool: BaseTool{
			name: "Glob",
			description: `Fast file pattern matching tool that works with any codebase size.

- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the Agent tool instead
- You have the capability to call multiple tools in a single response. It is always better to speculatively perform multiple searches as a batch that are potentially useful.
- If more than 2,000 files match the pattern, only the first 2,000 will be returned`,
		},
		workDir: workDir,
	}
}

// Call executes the glob operation.
func (t *GlobTool) Call(ctx context.Context, input string) (string, error) {
	if err := validateContext(ctx); err != nil {
		return ErrorResult(err), nil
	}

	var args GlobArgs
	if err := json.Unmarshal([]byte(input), &args); err != nil {
		return ErrorResult(fmt.Errorf("invalid input: %w", err)), nil
	}

	if args.Pattern == "" {
		return ErrorResult(fmt.Errorf("pattern is required")), nil
	}

	// Determine base directory
	baseDir := t.workDir
	if args.Path != "" {
		if filepath.IsAbs(args.Path) {
			baseDir = args.Path
		} else {
			baseDir = filepath.Join(t.workDir, args.Path)
		}
	}

	// Verify directory exists
	stat, err := os.Stat(baseDir)
	if err != nil {
		if os.IsNotExist(err) {
			return ErrorResult(fmt.Errorf("directory does not exist: %s", baseDir)), nil
		}
		return ErrorResult(err), nil
	}
	if !stat.IsDir() {
		return ErrorResult(fmt.Errorf("path is not a directory: %s", baseDir)), nil
	}

	// Walk directory and collect files
	allFiles, err := walkDirectory(baseDir)
	if err != nil {
		return ErrorResult(err), nil
	}

	// Match files against pattern
	matchedFiles := matchFiles(allFiles, baseDir, args.Pattern)

	// Sort by modification time (most recent first is default, but we sort alphabetically for consistency)
	sort.Strings(matchedFiles)

	// Apply file limit
	result := applyGlobLimit(matchedFiles)

	// Return as JSON
	data, err := json.Marshal(result)
	if err != nil {
		return ErrorResult(err), nil
	}

	return SuccessResult(string(data)), nil
}

// walkDirectory recursively walks a directory and returns all file paths.
func walkDirectory(dir string) ([]string, error) {
	var files []string

	err := filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			// Skip permission errors
			if os.IsPermission(err) {
				return nil
			}
			return err
		}

		// Skip node_modules and .git directories
		if d.IsDir() {
			name := d.Name()
			if name == "node_modules" || name == ".git" {
				return filepath.SkipDir
			}
			return nil
		}

		files = append(files, path)
		return nil
	})

	return files, err
}

// matchFiles filters files based on a glob pattern.
func matchFiles(files []string, baseDir, pattern string) []string {
	var matched []string

	// Handle different pattern types
	if strings.HasPrefix(pattern, "**/") {
		// Match against basename only
		subPattern := pattern[3:]
		for _, file := range files {
			basename := filepath.Base(file)
			if match, _ := doublestar.Match(subPattern, basename); match {
				matched = append(matched, file)
			}
		}
	} else if strings.Contains(pattern, "**") {
		// Match full path
		fullPattern := filepath.Join(baseDir, pattern)
		for _, file := range files {
			if match, _ := doublestar.Match(fullPattern, file); match {
				matched = append(matched, file)
			}
		}
	} else {
		// Match relative path
		for _, file := range files {
			relPath, err := filepath.Rel(baseDir, file)
			if err != nil {
				continue
			}
			if match, _ := doublestar.Match(pattern, relPath); match {
				matched = append(matched, file)
			}
		}
	}

	return matched
}

// applyGlobLimit truncates the file list if it exceeds the limit.
func applyGlobLimit(files []string) GlobResult {
	total := len(files)

	if total <= Limits.GlobMaxFiles {
		return GlobResult{Files: files}
	}

	truncated := files[:Limits.GlobMaxFiles]
	truncated = append(truncated, fmt.Sprintf(
		"\n[Output truncated: showing %d of %d files.]",
		Limits.GlobMaxFiles, total,
	))

	return GlobResult{
		Files:     truncated,
		Truncated: true,
		Total:     total,
	}
}

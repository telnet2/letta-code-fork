package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// EditTool performs exact string replacements in files.
type EditTool struct {
	BaseTool
	workDir string
}

// EditArgs represents the arguments for the Edit tool.
type EditArgs struct {
	FilePath   string `json:"file_path"`
	OldString  string `json:"old_string"`
	NewString  string `json:"new_string"`
	ReplaceAll bool   `json:"replace_all,omitempty"`
}

// NewEditTool creates a new Edit tool instance.
func NewEditTool(workDir string) *EditTool {
	return &EditTool{
		BaseTool: BaseTool{
			name: "Edit",
			description: `Performs exact string replacements in files.

Usage:
- You must use your ` + "`Read`" + ` tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file.
- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: spaces + line number + tab. Everything after that tab is the actual file content to match. Never include any part of the line number prefix in the old_string or new_string.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.
- The edit will FAIL if ` + "`old_string`" + ` is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use ` + "`replace_all`" + ` to change every instance of ` + "`old_string`" + `.
- Use ` + "`replace_all`" + ` for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.`,
		},
		workDir: workDir,
	}
}

// Call executes the edit operation.
func (t *EditTool) Call(ctx context.Context, input string) (string, error) {
	if err := validateContext(ctx); err != nil {
		return ErrorResult(err), nil
	}

	var args EditArgs
	if err := json.Unmarshal([]byte(input), &args); err != nil {
		return ErrorResult(fmt.Errorf("invalid input: %w", err)), nil
	}

	// Validate required parameters
	if args.FilePath == "" {
		return ErrorResult(fmt.Errorf("file_path is required")), nil
	}
	if args.OldString == "" {
		return ErrorResult(fmt.Errorf("old_string is required")), nil
	}
	if args.NewString == "" {
		return ErrorResult(fmt.Errorf("new_string is required")), nil
	}

	// Validate absolute path
	if !filepath.IsAbs(args.FilePath) {
		return ErrorResult(fmt.Errorf("file path must be absolute, got: %s", args.FilePath)), nil
	}

	// Check if old_string and new_string are the same
	if args.OldString == args.NewString {
		return ErrorResult(fmt.Errorf("no changes to make: old_string and new_string are exactly the same")), nil
	}

	// Read the file
	content, err := os.ReadFile(args.FilePath)
	if err != nil {
		if os.IsNotExist(err) {
			return ErrorResult(fmt.Errorf("file does not exist. Current working directory: %s", t.workDir)), nil
		}
		if os.IsPermission(err) {
			return ErrorResult(fmt.Errorf("permission denied: %s", args.FilePath)), nil
		}
		return ErrorResult(err), nil
	}

	contentStr := string(content)

	// Count occurrences
	occurrences := strings.Count(contentStr, args.OldString)
	if occurrences == 0 {
		return ErrorResult(fmt.Errorf("string to replace not found in file.\nString: %s", args.OldString)), nil
	}

	var newContent string
	var replacements int

	if args.ReplaceAll {
		newContent = strings.ReplaceAll(contentStr, args.OldString, args.NewString)
		replacements = occurrences
	} else {
		// Replace only the first occurrence
		index := strings.Index(contentStr, args.OldString)
		if index == -1 {
			return ErrorResult(fmt.Errorf("string not found in file: %s", args.OldString)), nil
		}
		newContent = contentStr[:index] + args.NewString + contentStr[index+len(args.OldString):]
		replacements = 1
	}

	// Write the file
	if err := os.WriteFile(args.FilePath, []byte(newContent), 0644); err != nil {
		return ErrorResult(err), nil
	}

	plural := ""
	if replacements != 1 {
		plural = "s"
	}

	return SuccessResult(fmt.Sprintf("Successfully replaced %d occurrence%s in %s", replacements, plural, args.FilePath)), nil
}

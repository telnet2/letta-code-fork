// Package tools provides LLM agent tools compatible with langchaingo.
// These tools are clones of the Letta Code TypeScript tools, providing
// file operations, shell execution, and task management capabilities.
package tools

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/tmc/langchaingo/tools"
)

// ToolResult represents the standard result from tool execution.
type ToolResult struct {
	Content string `json:"content"`
	Status  string `json:"status"` // "success" or "error"
}

// MarshalResult converts a ToolResult to JSON string.
func MarshalResult(result ToolResult) string {
	data, err := json.Marshal(result)
	if err != nil {
		return fmt.Sprintf(`{"content": "Failed to marshal result: %s", "status": "error"}`, err.Error())
	}
	return string(data)
}

// SuccessResult creates a successful tool result.
func SuccessResult(content string) string {
	return MarshalResult(ToolResult{Content: content, Status: "success"})
}

// ErrorResult creates an error tool result.
func ErrorResult(err error) string {
	return MarshalResult(ToolResult{Content: err.Error(), Status: "error"})
}

// BaseTool provides common functionality for all tools.
type BaseTool struct {
	name        string
	description string
}

// Name returns the tool name.
func (t *BaseTool) Name() string {
	return t.name
}

// Description returns the tool description.
func (t *BaseTool) Description() string {
	return t.description
}

// Limits defines default limits matching the original TypeScript implementation.
var Limits = struct {
	BashOutputChars    int
	GrepOutputChars    int
	ReadMaxLines       int
	ReadMaxCharsPerLine int
	GlobMaxFiles       int
}{
	BashOutputChars:    30000,
	GrepOutputChars:    10000,
	ReadMaxLines:       2000,
	ReadMaxCharsPerLine: 2000,
	GlobMaxFiles:       2000,
}

// AllTools returns all available tools as a slice compatible with langchaingo.
func AllTools(workDir string) []tools.Tool {
	return []tools.Tool{
		NewBashTool(workDir),
		NewReadTool(workDir),
		NewWriteTool(workDir),
		NewEditTool(workDir),
		NewGlobTool(workDir),
		NewGrepTool(workDir),
		NewTodoWriteTool(),
	}
}

// validateContext checks if context is cancelled.
func validateContext(ctx context.Context) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
		return nil
	}
}

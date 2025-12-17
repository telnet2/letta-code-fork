package tools

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// TestBashTool tests the Bash tool implementation.
func TestBashTool(t *testing.T) {
	workDir := t.TempDir()
	bash := NewBashTool(workDir)

	t.Run("Name and Description", func(t *testing.T) {
		if bash.Name() != "Bash" {
			t.Errorf("Expected name 'Bash', got '%s'", bash.Name())
		}
		if !strings.Contains(bash.Description(), "Executes a given bash command") {
			t.Error("Description should mention executing bash commands")
		}
	})

	t.Run("Simple command execution", func(t *testing.T) {
		ctx := context.Background()
		result, err := bash.Call(ctx, `{"command": "echo hello"}`)
		if err != nil {
			t.Fatalf("Unexpected error: %v", err)
		}

		var toolResult ToolResult
		if err := json.Unmarshal([]byte(result), &toolResult); err != nil {
			t.Fatalf("Failed to parse result: %v", err)
		}

		if toolResult.Status != "success" {
			t.Errorf("Expected success status, got: %s", toolResult.Status)
		}
		if !strings.Contains(toolResult.Content, "hello") {
			t.Errorf("Expected output to contain 'hello', got: %s", toolResult.Content)
		}
	})

	t.Run("Command with working directory", func(t *testing.T) {
		// Create a test file in workDir
		testFile := filepath.Join(workDir, "test.txt")
		os.WriteFile(testFile, []byte("test content"), 0644)

		ctx := context.Background()
		result, err := bash.Call(ctx, `{"command": "ls"}`)
		if err != nil {
			t.Fatalf("Unexpected error: %v", err)
		}

		var toolResult ToolResult
		json.Unmarshal([]byte(result), &toolResult)

		if !strings.Contains(toolResult.Content, "test.txt") {
			t.Errorf("Expected output to contain 'test.txt', got: %s", toolResult.Content)
		}
	})

	t.Run("Command failure returns error status", func(t *testing.T) {
		ctx := context.Background()
		result, err := bash.Call(ctx, `{"command": "exit 1"}`)
		if err != nil {
			t.Fatalf("Unexpected error: %v", err)
		}

		var toolResult ToolResult
		json.Unmarshal([]byte(result), &toolResult)

		if toolResult.Status != "error" {
			t.Errorf("Expected error status for failed command, got: %s", toolResult.Status)
		}
	})

	t.Run("Timeout enforcement", func(t *testing.T) {
		ctx := context.Background()
		result, err := bash.Call(ctx, `{"command": "sleep 10", "timeout": 100}`)
		if err != nil {
			t.Fatalf("Unexpected error: %v", err)
		}

		var toolResult ToolResult
		json.Unmarshal([]byte(result), &toolResult)

		if toolResult.Status != "error" {
			t.Errorf("Expected error status for timed out command")
		}
		if !strings.Contains(toolResult.Content, "timed out") {
			t.Errorf("Expected timeout message, got: %s", toolResult.Content)
		}
	})

	t.Run("Missing command parameter", func(t *testing.T) {
		ctx := context.Background()
		result, _ := bash.Call(ctx, `{}`)

		var toolResult ToolResult
		json.Unmarshal([]byte(result), &toolResult)

		if toolResult.Status != "error" {
			t.Error("Expected error for missing command")
		}
		if !strings.Contains(toolResult.Content, "command is required") {
			t.Errorf("Expected 'command is required' error, got: %s", toolResult.Content)
		}
	})

	t.Run("Background process listing", func(t *testing.T) {
		ctx := context.Background()
		result, _ := bash.Call(ctx, `{"command": "/bg"}`)

		var toolResult ToolResult
		json.Unmarshal([]byte(result), &toolResult)

		if toolResult.Status != "success" {
			t.Errorf("Expected success for /bg command")
		}
	})

	t.Run("Context cancellation", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		cancel() // Cancel immediately

		result, _ := bash.Call(ctx, `{"command": "echo test"}`)

		var toolResult ToolResult
		json.Unmarshal([]byte(result), &toolResult)

		if toolResult.Status != "error" {
			t.Error("Expected error for cancelled context")
		}
	})
}

// TestReadTool tests the Read tool implementation.
func TestReadTool(t *testing.T) {
	workDir := t.TempDir()
	read := NewReadTool(workDir)

	t.Run("Name and Description", func(t *testing.T) {
		if read.Name() != "Read" {
			t.Errorf("Expected name 'Read', got '%s'", read.Name())
		}
		if !strings.Contains(read.Description(), "Reads a file from the local filesystem") {
			t.Error("Description should mention reading files")
		}
	})

	t.Run("Read existing file", func(t *testing.T) {
		testFile := filepath.Join(workDir, "test.txt")
		os.WriteFile(testFile, []byte("line 1\nline 2\nline 3"), 0644)

		ctx := context.Background()
		input := `{"file_path": "` + testFile + `"}`
		result, err := read.Call(ctx, input)
		if err != nil {
			t.Fatalf("Unexpected error: %v", err)
		}

		var toolResult ToolResult
		json.Unmarshal([]byte(result), &toolResult)

		if toolResult.Status != "success" {
			t.Errorf("Expected success status, got: %s", toolResult.Status)
		}
		// Check for line numbers (cat -n format)
		if !strings.Contains(toolResult.Content, "1→line 1") {
			t.Errorf("Expected line numbers in output, got: %s", toolResult.Content)
		}
	})

	t.Run("Read with offset and limit", func(t *testing.T) {
		testFile := filepath.Join(workDir, "multi.txt")
		lines := make([]string, 10)
		for i := range lines {
			lines[i] = "line " + string(rune('A'+i))
		}
		os.WriteFile(testFile, []byte(strings.Join(lines, "\n")), 0644)

		ctx := context.Background()
		input := `{"file_path": "` + testFile + `", "offset": 2, "limit": 3}`
		result, _ := read.Call(ctx, input)

		var toolResult ToolResult
		json.Unmarshal([]byte(result), &toolResult)

		if !strings.Contains(toolResult.Content, "line C") {
			t.Errorf("Expected to start from line C (offset 2), got: %s", toolResult.Content)
		}
	})

	t.Run("Read non-existent file", func(t *testing.T) {
		ctx := context.Background()
		input := `{"file_path": "/nonexistent/file.txt"}`
		result, _ := read.Call(ctx, input)

		var toolResult ToolResult
		json.Unmarshal([]byte(result), &toolResult)

		if toolResult.Status != "error" {
			t.Error("Expected error for non-existent file")
		}
		if !strings.Contains(toolResult.Content, "does not exist") {
			t.Errorf("Expected 'does not exist' error, got: %s", toolResult.Content)
		}
	})

	t.Run("Read directory returns error", func(t *testing.T) {
		ctx := context.Background()
		input := `{"file_path": "` + workDir + `"}`
		result, _ := read.Call(ctx, input)

		var toolResult ToolResult
		json.Unmarshal([]byte(result), &toolResult)

		if toolResult.Status != "error" {
			t.Error("Expected error when reading directory")
		}
		if !strings.Contains(toolResult.Content, "directory") {
			t.Errorf("Expected directory error, got: %s", toolResult.Content)
		}
	})

	t.Run("Empty file returns system reminder", func(t *testing.T) {
		testFile := filepath.Join(workDir, "empty.txt")
		os.WriteFile(testFile, []byte(""), 0644)

		ctx := context.Background()
		input := `{"file_path": "` + testFile + `"}`
		result, _ := read.Call(ctx, input)

		var toolResult ToolResult
		json.Unmarshal([]byte(result), &toolResult)

		if !strings.Contains(toolResult.Content, "empty contents") {
			t.Errorf("Expected empty file notice, got: %s", toolResult.Content)
		}
	})

	t.Run("Missing file_path parameter", func(t *testing.T) {
		ctx := context.Background()
		result, _ := read.Call(ctx, `{}`)

		var toolResult ToolResult
		json.Unmarshal([]byte(result), &toolResult)

		if toolResult.Status != "error" {
			t.Error("Expected error for missing file_path")
		}
	})

	t.Run("Relative path resolution", func(t *testing.T) {
		testFile := filepath.Join(workDir, "relative.txt")
		os.WriteFile(testFile, []byte("relative content"), 0644)

		ctx := context.Background()
		input := `{"file_path": "relative.txt"}`
		result, _ := read.Call(ctx, input)

		var toolResult ToolResult
		json.Unmarshal([]byte(result), &toolResult)

		if toolResult.Status != "success" {
			t.Errorf("Expected success for relative path, got: %s - %s", toolResult.Status, toolResult.Content)
		}
	})
}

// TestWriteTool tests the Write tool implementation.
func TestWriteTool(t *testing.T) {
	workDir := t.TempDir()
	write := NewWriteTool(workDir)

	t.Run("Name and Description", func(t *testing.T) {
		if write.Name() != "Write" {
			t.Errorf("Expected name 'Write', got '%s'", write.Name())
		}
		if !strings.Contains(write.Description(), "Writes a file") {
			t.Error("Description should mention writing files")
		}
	})

	t.Run("Write new file", func(t *testing.T) {
		testFile := filepath.Join(workDir, "new.txt")
		content := "Hello, World!"

		ctx := context.Background()
		input := `{"file_path": "` + testFile + `", "content": "` + content + `"}`
		result, err := write.Call(ctx, input)
		if err != nil {
			t.Fatalf("Unexpected error: %v", err)
		}

		var toolResult ToolResult
		json.Unmarshal([]byte(result), &toolResult)

		if toolResult.Status != "success" {
			t.Errorf("Expected success status, got: %s - %s", toolResult.Status, toolResult.Content)
		}

		// Verify file was written
		written, _ := os.ReadFile(testFile)
		if string(written) != content {
			t.Errorf("Expected file content '%s', got '%s'", content, string(written))
		}
	})

	t.Run("Write creates parent directories", func(t *testing.T) {
		testFile := filepath.Join(workDir, "a", "b", "c", "nested.txt")

		ctx := context.Background()
		input := `{"file_path": "` + testFile + `", "content": "nested content"}`
		result, _ := write.Call(ctx, input)

		var toolResult ToolResult
		json.Unmarshal([]byte(result), &toolResult)

		if toolResult.Status != "success" {
			t.Errorf("Expected success for nested path, got: %s", toolResult.Content)
		}

		if _, err := os.Stat(testFile); os.IsNotExist(err) {
			t.Error("Expected file to be created")
		}
	})

	t.Run("Relative path rejected", func(t *testing.T) {
		ctx := context.Background()
		input := `{"file_path": "relative.txt", "content": "test"}`
		result, _ := write.Call(ctx, input)

		var toolResult ToolResult
		json.Unmarshal([]byte(result), &toolResult)

		if toolResult.Status != "error" {
			t.Error("Expected error for relative path")
		}
		if !strings.Contains(toolResult.Content, "absolute") {
			t.Errorf("Expected absolute path error, got: %s", toolResult.Content)
		}
	})

	t.Run("Missing parameters", func(t *testing.T) {
		ctx := context.Background()

		// Missing content
		result, _ := write.Call(ctx, `{"file_path": "/tmp/test.txt"}`)
		var toolResult ToolResult
		json.Unmarshal([]byte(result), &toolResult)
		if toolResult.Status != "error" {
			t.Error("Expected error for missing content")
		}

		// Missing file_path
		result, _ = write.Call(ctx, `{"content": "test"}`)
		json.Unmarshal([]byte(result), &toolResult)
		if toolResult.Status != "error" {
			t.Error("Expected error for missing file_path")
		}
	})
}

// TestEditTool tests the Edit tool implementation.
func TestEditTool(t *testing.T) {
	workDir := t.TempDir()
	edit := NewEditTool(workDir)

	t.Run("Name and Description", func(t *testing.T) {
		if edit.Name() != "Edit" {
			t.Errorf("Expected name 'Edit', got '%s'", edit.Name())
		}
		if !strings.Contains(edit.Description(), "string replacements") {
			t.Error("Description should mention string replacements")
		}
	})

	t.Run("Single replacement", func(t *testing.T) {
		testFile := filepath.Join(workDir, "edit_test.txt")
		os.WriteFile(testFile, []byte("Hello, World!"), 0644)

		ctx := context.Background()
		input := `{"file_path": "` + testFile + `", "old_string": "World", "new_string": "Go"}`
		result, _ := edit.Call(ctx, input)

		var toolResult ToolResult
		json.Unmarshal([]byte(result), &toolResult)

		if toolResult.Status != "success" {
			t.Errorf("Expected success, got: %s - %s", toolResult.Status, toolResult.Content)
		}

		content, _ := os.ReadFile(testFile)
		if string(content) != "Hello, Go!" {
			t.Errorf("Expected 'Hello, Go!', got '%s'", string(content))
		}
	})

	t.Run("Replace all occurrences", func(t *testing.T) {
		testFile := filepath.Join(workDir, "replace_all.txt")
		os.WriteFile(testFile, []byte("foo bar foo baz foo"), 0644)

		ctx := context.Background()
		input := `{"file_path": "` + testFile + `", "old_string": "foo", "new_string": "qux", "replace_all": true}`
		result, _ := edit.Call(ctx, input)

		var toolResult ToolResult
		json.Unmarshal([]byte(result), &toolResult)

		if toolResult.Status != "success" {
			t.Errorf("Expected success, got: %s", toolResult.Content)
		}
		if !strings.Contains(toolResult.Content, "3 occurrence") {
			t.Errorf("Expected 3 replacements, got: %s", toolResult.Content)
		}

		content, _ := os.ReadFile(testFile)
		if string(content) != "qux bar qux baz qux" {
			t.Errorf("Expected all 'foo' replaced, got '%s'", string(content))
		}
	})

	t.Run("String not found", func(t *testing.T) {
		testFile := filepath.Join(workDir, "not_found.txt")
		os.WriteFile(testFile, []byte("Hello, World!"), 0644)

		ctx := context.Background()
		input := `{"file_path": "` + testFile + `", "old_string": "nonexistent", "new_string": "replacement"}`
		result, _ := edit.Call(ctx, input)

		var toolResult ToolResult
		json.Unmarshal([]byte(result), &toolResult)

		if toolResult.Status != "error" {
			t.Error("Expected error when string not found")
		}
		if !strings.Contains(toolResult.Content, "not found") {
			t.Errorf("Expected 'not found' error, got: %s", toolResult.Content)
		}
	})

	t.Run("Same old and new string", func(t *testing.T) {
		testFile := filepath.Join(workDir, "same.txt")
		os.WriteFile(testFile, []byte("test"), 0644)

		ctx := context.Background()
		input := `{"file_path": "` + testFile + `", "old_string": "test", "new_string": "test"}`
		result, _ := edit.Call(ctx, input)

		var toolResult ToolResult
		json.Unmarshal([]byte(result), &toolResult)

		if toolResult.Status != "error" {
			t.Error("Expected error for same strings")
		}
	})

	t.Run("File not found", func(t *testing.T) {
		ctx := context.Background()
		input := `{"file_path": "/nonexistent/file.txt", "old_string": "a", "new_string": "b"}`
		result, _ := edit.Call(ctx, input)

		var toolResult ToolResult
		json.Unmarshal([]byte(result), &toolResult)

		if toolResult.Status != "error" {
			t.Error("Expected error for non-existent file")
		}
	})
}

// TestGlobTool tests the Glob tool implementation.
func TestGlobTool(t *testing.T) {
	workDir := t.TempDir()
	glob := NewGlobTool(workDir)

	// Create test files
	os.MkdirAll(filepath.Join(workDir, "src"), 0755)
	os.WriteFile(filepath.Join(workDir, "file1.txt"), []byte(""), 0644)
	os.WriteFile(filepath.Join(workDir, "file2.txt"), []byte(""), 0644)
	os.WriteFile(filepath.Join(workDir, "src", "main.go"), []byte(""), 0644)
	os.WriteFile(filepath.Join(workDir, "src", "util.go"), []byte(""), 0644)

	t.Run("Name and Description", func(t *testing.T) {
		if glob.Name() != "Glob" {
			t.Errorf("Expected name 'Glob', got '%s'", glob.Name())
		}
		if !strings.Contains(glob.Description(), "Fast file pattern matching") {
			t.Error("Description should mention file pattern matching")
		}
	})

	t.Run("Match all txt files", func(t *testing.T) {
		ctx := context.Background()
		input := `{"pattern": "*.txt"}`
		result, _ := glob.Call(ctx, input)

		var toolResult ToolResult
		json.Unmarshal([]byte(result), &toolResult)

		if toolResult.Status != "success" {
			t.Errorf("Expected success, got: %s", toolResult.Content)
		}

		var globResult GlobResult
		json.Unmarshal([]byte(toolResult.Content), &globResult)

		if len(globResult.Files) != 2 {
			t.Errorf("Expected 2 txt files, got %d: %v", len(globResult.Files), globResult.Files)
		}
	})

	t.Run("Match with ** pattern", func(t *testing.T) {
		ctx := context.Background()
		input := `{"pattern": "**/*.go"}`
		result, _ := glob.Call(ctx, input)

		var toolResult ToolResult
		json.Unmarshal([]byte(result), &toolResult)

		var globResult GlobResult
		json.Unmarshal([]byte(toolResult.Content), &globResult)

		if len(globResult.Files) != 2 {
			t.Errorf("Expected 2 go files, got %d: %v", len(globResult.Files), globResult.Files)
		}
	})

	t.Run("Match with path parameter", func(t *testing.T) {
		ctx := context.Background()
		input := `{"pattern": "*.go", "path": "src"}`
		result, _ := glob.Call(ctx, input)

		var toolResult ToolResult
		json.Unmarshal([]byte(result), &toolResult)

		var globResult GlobResult
		json.Unmarshal([]byte(toolResult.Content), &globResult)

		if len(globResult.Files) != 2 {
			t.Errorf("Expected 2 go files in src, got %d", len(globResult.Files))
		}
	})

	t.Run("No matches", func(t *testing.T) {
		ctx := context.Background()
		input := `{"pattern": "*.xyz"}`
		result, _ := glob.Call(ctx, input)

		var toolResult ToolResult
		json.Unmarshal([]byte(result), &toolResult)

		var globResult GlobResult
		json.Unmarshal([]byte(toolResult.Content), &globResult)

		if len(globResult.Files) != 0 {
			t.Errorf("Expected 0 matches, got %d", len(globResult.Files))
		}
	})

	t.Run("Non-existent directory", func(t *testing.T) {
		ctx := context.Background()
		input := `{"pattern": "*.txt", "path": "/nonexistent"}`
		result, _ := glob.Call(ctx, input)

		var toolResult ToolResult
		json.Unmarshal([]byte(result), &toolResult)

		if toolResult.Status != "error" {
			t.Error("Expected error for non-existent directory")
		}
	})
}

// TestGrepTool tests the Grep tool implementation.
func TestGrepTool(t *testing.T) {
	workDir := t.TempDir()
	grep := NewGrepTool(workDir)

	// Create test files
	os.WriteFile(filepath.Join(workDir, "test1.txt"), []byte("Hello World\nfoo bar\nHello Go"), 0644)
	os.WriteFile(filepath.Join(workDir, "test2.txt"), []byte("Another file\nHello Python"), 0644)

	t.Run("Name and Description", func(t *testing.T) {
		if grep.Name() != "Grep" {
			t.Errorf("Expected name 'Grep', got '%s'", grep.Name())
		}
		if !strings.Contains(grep.Description(), "ripgrep") {
			t.Error("Description should mention ripgrep")
		}
	})

	t.Run("Basic pattern search - files_with_matches", func(t *testing.T) {
		ctx := context.Background()
		input := `{"pattern": "Hello"}`
		result, _ := grep.Call(ctx, input)

		var toolResult ToolResult
		json.Unmarshal([]byte(result), &toolResult)

		if toolResult.Status != "success" {
			t.Errorf("Expected success, got: %s - %s", toolResult.Status, toolResult.Content)
		}

		var grepResult GrepResult
		json.Unmarshal([]byte(toolResult.Content), &grepResult)

		if grepResult.Files != 2 {
			t.Errorf("Expected 2 files with matches, got %d", grepResult.Files)
		}
	})

	t.Run("Content output mode", func(t *testing.T) {
		ctx := context.Background()
		input := `{"pattern": "Hello", "output_mode": "content"}`
		result, _ := grep.Call(ctx, input)

		var toolResult ToolResult
		json.Unmarshal([]byte(result), &toolResult)

		var grepResult GrepResult
		json.Unmarshal([]byte(toolResult.Content), &grepResult)

		if !strings.Contains(grepResult.Output, "Hello") {
			t.Errorf("Expected output to contain 'Hello', got: %s", grepResult.Output)
		}
	})

	t.Run("Count output mode", func(t *testing.T) {
		ctx := context.Background()
		input := `{"pattern": "Hello", "output_mode": "count"}`
		result, _ := grep.Call(ctx, input)

		var toolResult ToolResult
		json.Unmarshal([]byte(result), &toolResult)

		var grepResult GrepResult
		json.Unmarshal([]byte(toolResult.Content), &grepResult)

		// test1.txt has 2 "Hello", test2.txt has 1 "Hello" = 3 total
		if grepResult.Matches != 3 {
			t.Errorf("Expected 3 matches, got %d", grepResult.Matches)
		}
	})

	t.Run("No matches", func(t *testing.T) {
		ctx := context.Background()
		input := `{"pattern": "nonexistent_pattern_xyz"}`
		result, _ := grep.Call(ctx, input)

		var toolResult ToolResult
		json.Unmarshal([]byte(result), &toolResult)

		var grepResult GrepResult
		json.Unmarshal([]byte(toolResult.Content), &grepResult)

		if grepResult.Files != 0 {
			t.Errorf("Expected 0 files, got %d", grepResult.Files)
		}
	})

	t.Run("Case insensitive search", func(t *testing.T) {
		ctx := context.Background()
		input := `{"pattern": "hello", "-i": true, "output_mode": "count"}`
		result, _ := grep.Call(ctx, input)

		var toolResult ToolResult
		json.Unmarshal([]byte(result), &toolResult)

		var grepResult GrepResult
		json.Unmarshal([]byte(toolResult.Content), &grepResult)

		if grepResult.Matches < 3 {
			t.Errorf("Expected at least 3 case-insensitive matches, got %d", grepResult.Matches)
		}
	})

	t.Run("Glob filter", func(t *testing.T) {
		ctx := context.Background()
		input := `{"pattern": "Hello", "glob": "test1.*"}`
		result, _ := grep.Call(ctx, input)

		var toolResult ToolResult
		json.Unmarshal([]byte(result), &toolResult)

		var grepResult GrepResult
		json.Unmarshal([]byte(toolResult.Content), &grepResult)

		if grepResult.Files != 1 {
			t.Errorf("Expected 1 file with glob filter, got %d", grepResult.Files)
		}
	})
}

// TestTodoWriteTool tests the TodoWrite tool implementation.
func TestTodoWriteTool(t *testing.T) {
	todo := NewTodoWriteTool()

	t.Run("Name and Description", func(t *testing.T) {
		if todo.Name() != "TodoWrite" {
			t.Errorf("Expected name 'TodoWrite', got '%s'", todo.Name())
		}
		if !strings.Contains(todo.Description(), "structured task list") {
			t.Error("Description should mention structured task list")
		}
	})

	t.Run("Valid todo list", func(t *testing.T) {
		ctx := context.Background()
		input := `{
			"todos": [
				{"content": "First task", "status": "completed", "activeForm": "Completing first task"},
				{"content": "Second task", "status": "in_progress", "activeForm": "Working on second task"},
				{"content": "Third task", "status": "pending", "activeForm": "Preparing third task"}
			]
		}`
		result, _ := todo.Call(ctx, input)

		var toolResult ToolResult
		json.Unmarshal([]byte(result), &toolResult)

		if toolResult.Status != "success" {
			t.Errorf("Expected success, got: %s - %s", toolResult.Status, toolResult.Content)
		}
		if !strings.Contains(toolResult.Content, "modified successfully") {
			t.Errorf("Expected success message, got: %s", toolResult.Content)
		}

		// Verify todos were stored
		todos := todo.GetTodos()
		if len(todos) != 3 {
			t.Errorf("Expected 3 todos, got %d", len(todos))
		}
	})

	t.Run("Invalid status", func(t *testing.T) {
		ctx := context.Background()
		input := `{
			"todos": [
				{"content": "Task", "status": "invalid_status", "activeForm": "Working"}
			]
		}`
		result, _ := todo.Call(ctx, input)

		var toolResult ToolResult
		json.Unmarshal([]byte(result), &toolResult)

		if toolResult.Status != "error" {
			t.Error("Expected error for invalid status")
		}
	})

	t.Run("Missing content", func(t *testing.T) {
		ctx := context.Background()
		input := `{
			"todos": [
				{"status": "pending", "activeForm": "Working"}
			]
		}`
		result, _ := todo.Call(ctx, input)

		var toolResult ToolResult
		json.Unmarshal([]byte(result), &toolResult)

		if toolResult.Status != "error" {
			t.Error("Expected error for missing content")
		}
	})

	t.Run("Missing activeForm", func(t *testing.T) {
		ctx := context.Background()
		input := `{
			"todos": [
				{"content": "Task", "status": "pending"}
			]
		}`
		result, _ := todo.Call(ctx, input)

		var toolResult ToolResult
		json.Unmarshal([]byte(result), &toolResult)

		if toolResult.Status != "error" {
			t.Error("Expected error for missing activeForm")
		}
	})

	t.Run("Empty todos array", func(t *testing.T) {
		ctx := context.Background()
		input := `{"todos": []}`
		result, _ := todo.Call(ctx, input)

		var toolResult ToolResult
		json.Unmarshal([]byte(result), &toolResult)

		if toolResult.Status != "success" {
			t.Error("Expected success for empty todos")
		}

		todos := todo.GetTodos()
		if len(todos) != 0 {
			t.Errorf("Expected empty todos, got %d", len(todos))
		}
	})

	t.Run("Null todos", func(t *testing.T) {
		ctx := context.Background()
		input := `{}`
		result, _ := todo.Call(ctx, input)

		var toolResult ToolResult
		json.Unmarshal([]byte(result), &toolResult)

		if toolResult.Status != "error" {
			t.Error("Expected error for null todos")
		}
	})
}

// TestAllTools verifies the AllTools function returns all expected tools.
func TestAllTools(t *testing.T) {
	workDir := t.TempDir()
	tools := AllTools(workDir)

	expectedTools := []string{"Bash", "Read", "Write", "Edit", "Glob", "Grep", "TodoWrite"}

	if len(tools) != len(expectedTools) {
		t.Errorf("Expected %d tools, got %d", len(expectedTools), len(tools))
	}

	toolNames := make(map[string]bool)
	for _, tool := range tools {
		toolNames[tool.Name()] = true
	}

	for _, name := range expectedTools {
		if !toolNames[name] {
			t.Errorf("Expected tool '%s' not found", name)
		}
	}
}

// TestToolResultHelpers tests the result helper functions.
func TestToolResultHelpers(t *testing.T) {
	t.Run("SuccessResult", func(t *testing.T) {
		result := SuccessResult("test content")

		var toolResult ToolResult
		json.Unmarshal([]byte(result), &toolResult)

		if toolResult.Status != "success" {
			t.Errorf("Expected success status, got: %s", toolResult.Status)
		}
		if toolResult.Content != "test content" {
			t.Errorf("Expected 'test content', got: %s", toolResult.Content)
		}
	})

	t.Run("ErrorResult", func(t *testing.T) {
		result := ErrorResult(os.ErrNotExist)

		var toolResult ToolResult
		json.Unmarshal([]byte(result), &toolResult)

		if toolResult.Status != "error" {
			t.Errorf("Expected error status, got: %s", toolResult.Status)
		}
	})
}

// TestLimits verifies the default limits match the original TypeScript implementation.
func TestLimits(t *testing.T) {
	if Limits.BashOutputChars != 30000 {
		t.Errorf("Expected BashOutputChars 30000, got %d", Limits.BashOutputChars)
	}
	if Limits.GrepOutputChars != 10000 {
		t.Errorf("Expected GrepOutputChars 10000, got %d", Limits.GrepOutputChars)
	}
	if Limits.ReadMaxLines != 2000 {
		t.Errorf("Expected ReadMaxLines 2000, got %d", Limits.ReadMaxLines)
	}
	if Limits.ReadMaxCharsPerLine != 2000 {
		t.Errorf("Expected ReadMaxCharsPerLine 2000, got %d", Limits.ReadMaxCharsPerLine)
	}
	if Limits.GlobMaxFiles != 2000 {
		t.Errorf("Expected GlobMaxFiles 2000, got %d", Limits.GlobMaxFiles)
	}
}

// TestBackgroundProcess tests background process execution.
func TestBackgroundProcess(t *testing.T) {
	workDir := t.TempDir()
	bash := NewBashTool(workDir)

	t.Run("Run in background", func(t *testing.T) {
		ctx := context.Background()
		input := `{"command": "sleep 0.1 && echo done", "run_in_background": true}`
		result, _ := bash.Call(ctx, input)

		var toolResult ToolResult
		json.Unmarshal([]byte(result), &toolResult)

		if toolResult.Status != "success" {
			t.Errorf("Expected success, got: %s", toolResult.Content)
		}
		if !strings.Contains(toolResult.Content, "background with ID") {
			t.Errorf("Expected background ID in response, got: %s", toolResult.Content)
		}

		// Wait for process to complete
		time.Sleep(200 * time.Millisecond)
	})
}

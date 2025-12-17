# Letta Code Go SDK

A high-quality Go SDK providing LLM agent tools compatible with [langchaingo](https://github.com/tmc/langchaingo). This is a clone of the Letta Code TypeScript tools, providing file operations, shell execution, and task management capabilities for AI agents.

## Features

- **7 Core Tools**: Bash, Read, Write, Edit, Glob, Grep, TodoWrite
- **langchaingo Compatible**: Implements the `tools.Tool` interface
- **Full Feature Parity**: Matches the original TypeScript implementation behavior
- **Comprehensive Tests**: Validates against original tool specifications

## Installation

```bash
go get github.com/letta-ai/letta-code/gosdk
```

## Quick Start

```go
package main

import (
    "context"
    "fmt"

    "github.com/letta-ai/letta-code/gosdk/tools"
)

func main() {
    // Create all tools for a working directory
    workDir := "/path/to/project"
    allTools := tools.AllTools(workDir)

    // Or create individual tools
    bash := tools.NewBashTool(workDir)
    read := tools.NewReadTool(workDir)

    // Use with langchaingo
    ctx := context.Background()
    result, _ := bash.Call(ctx, `{"command": "ls -la"}`)
    fmt.Println(result)
}
```

## Tools

### Bash

Executes bash commands with optional timeout and background execution.

```go
bash := tools.NewBashTool(workDir)

// Simple command
result, _ := bash.Call(ctx, `{"command": "echo hello"}`)

// With timeout (milliseconds)
result, _ := bash.Call(ctx, `{"command": "long-running-task", "timeout": 60000}`)

// Background execution
result, _ := bash.Call(ctx, `{"command": "npm run build", "run_in_background": true}`)

// List background processes
result, _ := bash.Call(ctx, `{"command": "/bg"}`)
```

### Read

Reads files with line numbers, supporting offset and limit for large files.

```go
read := tools.NewReadTool(workDir)

// Read entire file
result, _ := read.Call(ctx, `{"file_path": "/path/to/file.txt"}`)

// Read with offset and limit (for large files)
result, _ := read.Call(ctx, `{"file_path": "/path/to/large.txt", "offset": 100, "limit": 50}`)
```

### Write

Writes content to files, creating parent directories as needed.

```go
write := tools.NewWriteTool(workDir)

result, _ := write.Call(ctx, `{
    "file_path": "/path/to/new/file.txt",
    "content": "Hello, World!"
}`)
```

### Edit

Performs exact string replacements in files.

```go
edit := tools.NewEditTool(workDir)

// Single replacement
result, _ := edit.Call(ctx, `{
    "file_path": "/path/to/file.txt",
    "old_string": "oldValue",
    "new_string": "newValue"
}`)

// Replace all occurrences
result, _ := edit.Call(ctx, `{
    "file_path": "/path/to/file.txt",
    "old_string": "foo",
    "new_string": "bar",
    "replace_all": true
}`)
```

### Glob

Fast file pattern matching using glob patterns.

```go
glob := tools.NewGlobTool(workDir)

// Find all Go files
result, _ := glob.Call(ctx, `{"pattern": "**/*.go"}`)

// Find in specific directory
result, _ := glob.Call(ctx, `{"pattern": "*.ts", "path": "src"}`)
```

### Grep

Powerful content search using ripgrep (must be installed).

```go
grep := tools.NewGrepTool(workDir)

// Find files containing pattern
result, _ := grep.Call(ctx, `{"pattern": "TODO"}`)

// Get matching content
result, _ := grep.Call(ctx, `{
    "pattern": "func.*Error",
    "output_mode": "content"
}`)

// Count matches
result, _ := grep.Call(ctx, `{
    "pattern": "import",
    "output_mode": "count",
    "glob": "*.go"
}`)
```

### TodoWrite

Manages structured task lists for coding sessions.

```go
todo := tools.NewTodoWriteTool()

result, _ := todo.Call(ctx, `{
    "todos": [
        {"content": "Implement feature", "status": "in_progress", "activeForm": "Implementing feature"},
        {"content": "Write tests", "status": "pending", "activeForm": "Writing tests"}
    ]
}`)
```

## Integration with langchaingo

```go
package main

import (
    "context"

    "github.com/tmc/langchaingo/agents"
    "github.com/tmc/langchaingo/llms/openai"
    "github.com/letta-ai/letta-code/gosdk/tools"
)

func main() {
    llm, _ := openai.New()

    // Get all tools
    allTools := tools.AllTools("/path/to/project")

    // Create agent with tools
    agent := agents.NewOneShotAgent(llm, allTools)

    // Execute
    ctx := context.Background()
    result, _ := agent.Call(ctx, "Read the main.go file and summarize it")
}
```

## Default Limits

These limits match the original TypeScript implementation:

| Limit | Value | Description |
|-------|-------|-------------|
| BashOutputChars | 30,000 | Max characters for bash output |
| GrepOutputChars | 10,000 | Max characters for grep output |
| ReadMaxLines | 2,000 | Default max lines to read |
| ReadMaxCharsPerLine | 2,000 | Max characters per line before truncation |
| GlobMaxFiles | 2,000 | Max files returned by glob |

## Requirements

- Go 1.22+
- ripgrep (`rg`) for Grep tool

## Running Tests

```bash
cd gosdk
go test ./tools -v
```

## License

Same as the parent Letta Code project.

## References

- [langchaingo](https://github.com/tmc/langchaingo) - LangChain for Go
- [Letta Code](https://letta.com) - Original TypeScript implementation
- [ripgrep](https://github.com/BurntSushi/ripgrep) - Required for Grep tool

package tools

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"sync"
	"sync/atomic"
	"time"
)

// BashTool executes bash commands with optional timeout and background execution.
type BashTool struct {
	BaseTool
	workDir string
}

// BashArgs represents the arguments for the Bash tool.
type BashArgs struct {
	Command         string `json:"command"`
	Timeout         int    `json:"timeout,omitempty"`          // milliseconds, max 600000
	Description     string `json:"description,omitempty"`      // 5-10 word description
	RunInBackground bool   `json:"run_in_background,omitempty"`
}

// BackgroundProcess tracks a running background process.
type BackgroundProcess struct {
	ID        string
	Command   string
	Stdout    []string
	Stderr    []string
	Status    string // "running", "completed", "failed"
	ExitCode  *int
	StartTime time.Time
	mu        sync.Mutex
}

var (
	backgroundProcesses = make(map[string]*BackgroundProcess)
	backgroundMu        sync.RWMutex
	bashIDCounter       int64
)

// NewBashTool creates a new Bash tool instance.
func NewBashTool(workDir string) *BashTool {
	return &BashTool{
		BaseTool: BaseTool{
			name: "Bash",
			description: `Executes a given bash command in a persistent shell session with optional timeout, ensuring proper handling and security measures.

IMPORTANT: This tool is for terminal operations like git, npm, docker, etc. DO NOT use it for file operations (reading, writing, editing, searching, finding files) - use the specialized tools for this instead.

Before executing the command, please follow these steps:

1. Directory Verification:
   - If the command will create new directories or files, first use ` + "`ls`" + ` to verify the parent directory exists and is the correct location
   - For example, before running "mkdir foo/bar", first use ` + "`ls foo`" + ` to check that "foo" exists and is the intended parent directory

2. Command Execution:
   - Always quote file paths that contain spaces with double quotes (e.g., cd "path with spaces/file.txt")
   - After ensuring proper quoting, execute the command.
   - Capture the output of the command.

Usage notes:
  - The command argument is required.
  - You can specify an optional timeout in milliseconds (up to 600000ms / 10 minutes). If not specified, commands will timeout after 120000ms (2 minutes).
  - It is very helpful if you write a clear, concise description of what this command does in 5-10 words.
  - If the output exceeds 30000 characters, output will be truncated before being returned to you.
  - You can use the ` + "`run_in_background`" + ` parameter to run the command in the background.

  - Avoid using Bash with the ` + "`find`, `grep`, `cat`, `head`, `tail`, `sed`, `awk`, or `echo`" + ` commands. Instead, prefer using the dedicated tools:
    - File search: Use Glob (NOT find or ls)
    - Content search: Use Grep (NOT grep or rg)
    - Read files: Use Read (NOT cat/head/tail)
    - Edit files: Use Edit (NOT sed/awk)
    - Write files: Use Write (NOT echo >/cat <<EOF)`,
		},
		workDir: workDir,
	}
}

// Call executes the bash command.
func (t *BashTool) Call(ctx context.Context, input string) (string, error) {
	if err := validateContext(ctx); err != nil {
		return ErrorResult(err), nil
	}

	var args BashArgs
	if err := json.Unmarshal([]byte(input), &args); err != nil {
		return ErrorResult(fmt.Errorf("invalid input: %w", err)), nil
	}

	if args.Command == "" {
		return ErrorResult(fmt.Errorf("command is required")), nil
	}

	// Handle /bg command to list background processes
	if args.Command == "/bg" {
		return t.listBackgroundProcesses(), nil
	}

	if args.RunInBackground {
		return t.runInBackground(ctx, args)
	}

	return t.runForeground(ctx, args)
}

func (t *BashTool) listBackgroundProcesses() string {
	backgroundMu.RLock()
	defer backgroundMu.RUnlock()

	if len(backgroundProcesses) == 0 {
		return SuccessResult("(no content)")
	}

	var output string
	for id, proc := range backgroundProcesses {
		runtime := time.Since(proc.StartTime).Round(time.Second)
		output += fmt.Sprintf("%s: %s (%s, runtime: %s)\n", id, proc.Command, proc.Status, runtime)
	}
	return SuccessResult(output)
}

func (t *BashTool) runInBackground(ctx context.Context, args BashArgs) (string, error) {
	bashID := fmt.Sprintf("bash_%d", atomic.AddInt64(&bashIDCounter, 1))

	cmd := exec.Command("bash", "-c", args.Command)
	cmd.Dir = t.workDir
	cmd.Env = os.Environ()

	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()

	proc := &BackgroundProcess{
		ID:        bashID,
		Command:   args.Command,
		Status:    "running",
		StartTime: time.Now(),
		Stdout:    make([]string, 0),
		Stderr:    make([]string, 0),
	}

	backgroundMu.Lock()
	backgroundProcesses[bashID] = proc
	backgroundMu.Unlock()

	if err := cmd.Start(); err != nil {
		proc.mu.Lock()
		proc.Status = "failed"
		proc.Stderr = append(proc.Stderr, err.Error())
		proc.mu.Unlock()
		return ErrorResult(err), nil
	}

	// Read stdout in goroutine
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := stdout.Read(buf)
			if n > 0 {
				proc.mu.Lock()
				proc.Stdout = append(proc.Stdout, string(buf[:n]))
				proc.mu.Unlock()
			}
			if err != nil {
				break
			}
		}
	}()

	// Read stderr in goroutine
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := stderr.Read(buf)
			if n > 0 {
				proc.mu.Lock()
				proc.Stderr = append(proc.Stderr, string(buf[:n]))
				proc.mu.Unlock()
			}
			if err != nil {
				break
			}
		}
	}()

	// Wait for process completion in goroutine
	go func() {
		err := cmd.Wait()
		proc.mu.Lock()
		defer proc.mu.Unlock()

		exitCode := 0
		if err != nil {
			if exitErr, ok := err.(*exec.ExitError); ok {
				exitCode = exitErr.ExitCode()
			}
			proc.Status = "failed"
		} else {
			proc.Status = "completed"
		}
		proc.ExitCode = &exitCode
	}()

	// Handle timeout
	if args.Timeout > 0 {
		go func() {
			time.Sleep(time.Duration(args.Timeout) * time.Millisecond)
			proc.mu.Lock()
			defer proc.mu.Unlock()
			if proc.Status == "running" {
				cmd.Process.Kill()
				proc.Status = "failed"
				proc.Stderr = append(proc.Stderr, fmt.Sprintf("Command timed out after %dms", args.Timeout))
			}
		}()
	}

	return SuccessResult(fmt.Sprintf("Command running in background with ID: %s", bashID)), nil
}

func (t *BashTool) runForeground(ctx context.Context, args BashArgs) (string, error) {
	timeout := args.Timeout
	if timeout <= 0 {
		timeout = 120000 // 2 minutes default
	}
	if timeout > 600000 {
		timeout = 600000 // 10 minutes max
	}

	ctx, cancel := context.WithTimeout(ctx, time.Duration(timeout)*time.Millisecond)
	defer cancel()

	cmd := exec.CommandContext(ctx, "bash", "-c", args.Command)
	cmd.Dir = t.workDir
	cmd.Env = os.Environ()

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()

	output := stdout.String()
	if stderr.Len() > 0 {
		if output != "" {
			output += "\n"
		}
		output += stderr.String()
	}

	if output == "" {
		output = "(Command completed with no output)"
	}

	// Truncate output if too long
	if len(output) > Limits.BashOutputChars {
		output = output[:Limits.BashOutputChars] + "\n[Output truncated]"
	}

	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return ErrorResult(fmt.Errorf("command timed out after %dms\n%s", timeout, output)), nil
		}
		if ctx.Err() == context.Canceled {
			return ErrorResult(fmt.Errorf("user interrupted tool execution")), nil
		}
		errMsg := output
		if exitErr, ok := err.(*exec.ExitError); ok {
			errMsg = fmt.Sprintf("Exit code: %d\n%s", exitErr.ExitCode(), output)
		}
		return ErrorResult(fmt.Errorf("%s", errMsg)), nil
	}

	return SuccessResult(output), nil
}

// GetBackgroundProcess retrieves a background process by ID.
func GetBackgroundProcess(id string) (*BackgroundProcess, bool) {
	backgroundMu.RLock()
	defer backgroundMu.RUnlock()
	proc, ok := backgroundProcesses[id]
	return proc, ok
}

// GetBackgroundOutput returns new output from a background process.
func (p *BackgroundProcess) GetBackgroundOutput() (stdout, stderr []string, status string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]string{}, p.Stdout...), append([]string{}, p.Stderr...), p.Status
}

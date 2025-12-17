package tools

import (
	"context"
	"encoding/json"
	"fmt"
)

// TodoWriteTool manages structured task lists for coding sessions.
type TodoWriteTool struct {
	BaseTool
	todos []TodoItem
}

// TodoItem represents a single todo item.
type TodoItem struct {
	Content    string `json:"content"`
	Status     string `json:"status"`     // "pending", "in_progress", "completed"
	ActiveForm string `json:"activeForm"` // Present continuous form for display
}

// TodoWriteArgs represents the arguments for the TodoWrite tool.
type TodoWriteArgs struct {
	Todos []TodoItem `json:"todos"`
}

// NewTodoWriteTool creates a new TodoWrite tool instance.
func NewTodoWriteTool() *TodoWriteTool {
	return &TodoWriteTool{
		BaseTool: BaseTool{
			name: "TodoWrite",
			description: `Use this tool to create and manage a structured task list for your current coding session. This helps you track progress, organize complex tasks, and demonstrate thoroughness to the user.
It also helps the user understand the progress of the task and overall progress of their requests.

## When to Use This Tool
Use this tool proactively in these scenarios:

1. Complex multi-step tasks - When a task requires 3 or more distinct steps or actions
2. Non-trivial and complex tasks - Tasks that require careful planning or multiple operations
3. User explicitly requests todo list - When the user directly asks you to use the todo list
4. User provides multiple tasks - When users provide a list of things to be done (numbered or comma-separated)
5. After receiving new instructions - Immediately capture user requirements as todos
6. When you start working on a task - Mark it as in_progress BEFORE beginning work. Ideally you should only have one todo as in_progress at a time
7. After completing a task - Mark it as completed and add any new follow-up tasks discovered during implementation

## When NOT to Use This Tool

Skip using this tool when:
1. There is only a single, straightforward task
2. The task is trivial and tracking it provides no organizational benefit
3. The task can be completed in less than 3 trivial steps
4. The task is purely conversational or informational

## Task States and Management

1. **Task States**: Use these states to track progress:
   - pending: Task not yet started
   - in_progress: Currently working on (limit to ONE task at a time)
   - completed: Task finished successfully

   **IMPORTANT**: Task descriptions must have two forms:
   - content: The imperative form describing what needs to be done (e.g., "Run tests", "Build the project")
   - activeForm: The present continuous form shown during execution (e.g., "Running tests", "Building the project")

2. **Task Management**:
   - Update task status in real-time as you work
   - Mark tasks complete IMMEDIATELY after finishing (don't batch completions)
   - Exactly ONE task must be in_progress at any time (not less, not more)
   - Complete current tasks before starting new ones
   - Remove tasks that are no longer relevant from the list entirely

3. **Task Completion Requirements**:
   - ONLY mark a task as completed when you have FULLY accomplished it
   - If you encounter errors, blockers, or cannot finish, keep the task as in_progress
   - When blocked, create a new task describing what needs to be resolved

4. **Task Breakdown**:
   - Create specific, actionable items
   - Break complex tasks into smaller, manageable steps
   - Use clear, descriptive task names

When in doubt, use this tool. Being proactive with task management demonstrates attentiveness and ensures you complete all requirements successfully.`,
		},
		todos: make([]TodoItem, 0),
	}
}

// Call executes the todo write operation.
func (t *TodoWriteTool) Call(ctx context.Context, input string) (string, error) {
	if err := validateContext(ctx); err != nil {
		return ErrorResult(err), nil
	}

	var args TodoWriteArgs
	if err := json.Unmarshal([]byte(input), &args); err != nil {
		return ErrorResult(fmt.Errorf("invalid input: %w", err)), nil
	}

	if args.Todos == nil {
		return ErrorResult(fmt.Errorf("todos must be an array")), nil
	}

	// Validate each todo item
	validStatuses := map[string]bool{
		"pending":     true,
		"in_progress": true,
		"completed":   true,
	}

	for i, todo := range args.Todos {
		if todo.Content == "" {
			return ErrorResult(fmt.Errorf("todo %d: content is required", i+1)), nil
		}
		if !validStatuses[todo.Status] {
			return ErrorResult(fmt.Errorf("todo %d: status must be 'pending', 'in_progress', or 'completed'", i+1)), nil
		}
		if todo.ActiveForm == "" {
			return ErrorResult(fmt.Errorf("todo %d: activeForm is required", i+1)), nil
		}
	}

	// Update the todos
	t.todos = args.Todos

	return SuccessResult("Todos have been modified successfully. Ensure that you continue to use the todo list to track your progress. Please proceed with the current tasks if applicable"), nil
}

// GetTodos returns the current todo list.
func (t *TodoWriteTool) GetTodos() []TodoItem {
	return append([]TodoItem{}, t.todos...)
}

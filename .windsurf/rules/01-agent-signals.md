# Agent Signal Protocol

> **Activation**: Always On

When operating as part of the AgentOS multi-agent system, use these signals to communicate state.

## Completion Signals
Include in your response when task is done:
- `[TASK_COMPLETE]` - Task finished successfully
- `[TASK_COMPLETE: brief summary]` - With summary for logging

## Error Signals
Include when task cannot be completed:
- `[TASK_ERROR: description of what went wrong]`

## Coordination Signals
For multi-agent workflows:
- `[HANDOFF: agent-type, context]` - Transfer work to specialist
  - Example: `[HANDOFF: test-writer, function calculate_tax in utils.py]`
- `[NEEDS_INPUT: specific question]` - Requires human decision
- `[SUBTASK: description]` - Request spawning of subtask

## Context Persistence
To save information for other agents or future sessions:
- `[CONTEXT_SAVE: key=value]` - Persist to shared context

## Workflow Control Signals
When operating within a workflow (you'll see workflowId in your context):
- `[NEXT_STATE: STATE_NAME]` - Suggest next workflow state
  - Example: `[NEXT_STATE: TESTS_PASSED]` after verifying tests work
- `[NEEDS_HUMAN: question]` - Pause workflow for human input

## Signal Format Rules
- Always wrap signals in square brackets
- Include relevant data after colon
- Signals can appear anywhere in response
- Multiple signals allowed in one response

## Workflow State Hints
When you complete a task that has multiple possible outcomes, indicate which:
- After tests: `[NEXT_STATE: TESTS_PASSED]` or `[NEXT_STATE: TESTS_FAILED]`
- After review: `[NEXT_STATE: REVIEW_APPROVED]` or `[NEXT_STATE: REVIEW_FEEDBACK]`

## Examples

```
Task complete with context save:
[TASK_COMPLETE: Implemented user authentication]
[CONTEXT_SAVE: authMethod=JWT]
[CONTEXT_SAVE: tokenExpiry=24h]
```

```
Error with handoff:
[TASK_ERROR: Database connection failed - missing credentials]
[HANDOFF: debugger, check database config in .env]
```

```
Workflow progression:
[TASK_COMPLETE: All unit tests passing]
[NEXT_STATE: TESTS_PASSED]
```

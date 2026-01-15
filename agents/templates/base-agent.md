# Base Agent Template

This document defines the foundational behavior and structure for all AgentOS agents.

## Agent Lifecycle

1. **Initialization** - Agent is created with configuration
2. **Ready** - Agent is ready to receive tasks
3. **Bound** - Agent is bound to Cascade instance
4. **Working** - Agent is actively processing a task
5. **Idle** - Agent completed task, waiting for next
6. **Error** - Agent encountered an error
7. **Terminated** - Agent is shutting down

## Signal Protocol

All agents communicate using text-based signals:

### Task Signals
- `[TASK_COMPLETE]` - Task finished successfully
- `[TASK_COMPLETE:summary]` - Task finished with summary

### Handoff Signals
- `[HANDOFF:agent-type]` - Transfer to another agent
- `[HANDOFF:agent-type:context]` - Transfer with context

### Context Signals
- `[CONTEXT_SAVE:key:value]` - Save to memory bank
- `[NEXT_STATE:state]` - Transition workflow state

### Status Signals
- `[ESCALATE:reason]` - Escalate to human
- `[ERROR:message]` - Report error
- `[BLOCKED:reason]` - Report blockage

### Polling Signals
- `[POLL_START:system:interval]` - Start polling
- `[POLL_STOP:system]` - Stop polling

## Memory Bank Access

Agents can read/write to the memory bank:

```
memory-bank/
├── context/           # Session context
├── knowledge/         # Accumulated knowledge
├── workflows/         # Workflow patterns
├── history/           # Interaction history
└── cache/             # Temporary cache
```

## Required Behaviors

1. **Signal Emission** - Always emit appropriate signals
2. **Context Preservation** - Save important context before handoff
3. **Error Reporting** - Report errors clearly with context
4. **Human Escalation** - Escalate when blocked or uncertain
5. **State Awareness** - Track and report workflow state

## Configuration Structure

```json
{
  "type": "agent-type",
  "name": "Human Readable Name",
  "description": "What this agent does",
  "capabilities": ["capability1", "capability2"],
  "requiredContext": ["context1", "context2"],
  "outputFormat": "format description",
  "escalationTriggers": ["trigger1", "trigger2"]
}
```

## Prompt Structure

Each agent has system prompts defined in `prompts.md`:

1. **Identity** - Who the agent is
2. **Capabilities** - What the agent can do
3. **Constraints** - What the agent cannot do
4. **Output Format** - How to format responses
5. **Signal Usage** - When to emit signals
6. **Escalation Rules** - When to escalate

## Skills Integration

Agents can execute skills defined in `/skills/`:

1. Load skill by name
2. Validate required inputs
3. Execute skill logic
4. Return skill outputs
5. Emit completion signal

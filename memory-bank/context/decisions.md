# Architectural Decisions

Document significant decisions with context and rationale.

---

## Decision Template

### ADR-XXX: [Title]

**Date**: [date]
**Status**: [Proposed | Accepted | Deprecated | Superseded]

#### Context
[What is the issue that we're seeing that is motivating this decision?]

#### Decision
[What is the change that we're proposing?]

#### Consequences
[What becomes easier or more difficult because of this change?]

---

## Decisions

### ADR-001: CDP Integration for Agent Orchestration

**Date**: 2025-01-14
**Status**: Accepted

#### Context
Windsurf's Skills and MCP features are unavailable in our environment. We need an alternative approach for multi-agent orchestration.

#### Decision
Use Chrome DevTools Protocol to create an extended agent orchestration layer. Agents are represented as DOM nodes for inspection, with state persisted to localStorage.

#### Consequences
- **Easier**: No dependency on proprietary features
- **Easier**: Full control over agent lifecycle
- **Harder**: Manual loading required each session
- **Harder**: No native integration with Cascade internals

---

### ADR-002: Text-Based Signal Protocol for Agent Communication

**Date**: 2025-01-14
**Status**: Accepted

#### Context
Without MCP, agents cannot communicate through structured tool calls. Need an alternative coordination mechanism.

#### Decision
Use text-based signals in Cascade output that are parsed by the orchestrator:
- `[TASK_COMPLETE]`
- `[TASK_ERROR: reason]`
- `[HANDOFF: agent-type, context]`
- `[CONTEXT_SAVE: key=value]`

#### Consequences
- **Easier**: Works within Cascade's existing text output
- **Easier**: Human-readable for debugging
- **Harder**: Relies on regex parsing (fragile)
- **Harder**: Must train agents via rules to use signals

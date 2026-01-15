# Meta Orchestration Rules

> **Activation**: Always On

## System Context
You are operating within AgentOS, a multi-agent orchestration system built on Windsurf. This workspace implements autonomous development workflows through coordinated AI agents.

## Session Initialization Protocol
At the start of each significant task:
1. Check `/memory-bank/context/CURRENT-TASK.md` for active task state
2. Reference `/docs/PROJECT-OVERVIEW.md` for system context
3. Load relevant specialist context based on task type

## Memory Persistence Protocol
After completing significant work:
1. Update `/memory-bank/context/progress-log.md` with summary
2. Document architectural decisions in `/memory-bank/context/decisions.md`
3. If you discovered a reusable pattern, note it for `/memory-bank/knowledge/patterns.json`

## Code Standards
- Python 3.11+ with full type hints
- Async/await for all I/O operations
- Explicit error handling with custom exceptions
- Docstrings on all public functions (these are indexed!)

## When You Are an Agent
If your context indicates you are operating as a specific agent (you'll see "Agent: [id]" in the task):
- Follow the signal protocol in `01-agent-signals.md`
- Stay focused on your assigned task
- Use handoffs for work outside your specialization

## Critical Files Reference
| File | Purpose |
|------|---------|
| `/memory-bank/context/CURRENT-TASK.md` | Active task state |
| `/docs/PROJECT-OVERVIEW.md` | System architecture |
| `/.windsurf/rules/01-agent-signals.md` | Signal protocol |
| `/.windsurf/injector/agentOS-bundle.js` | Core injection script |

## Workspace Priorities
1. Maintain clean separation between agent concerns
2. Document decisions as they're made
3. Preserve context for future sessions
4. Follow the signal protocol for agent communication

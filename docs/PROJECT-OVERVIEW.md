# Project Overview: AgentOS - Multi-Agent Development Platform

## Vision
Build autonomous development workflows that 10-100x engineering productivity through coordinated AI agents operating within Windsurf.

## Architecture

### Core Components

```
+-----------------------------------------------------------------------+
|                    EXTENDED AGENT ORCHESTRATION LAYER                  |
+-----------------------------------------------------------------------+
|                                                                        |
|  +--------------------+                                                |
|  |  RUNTIME SCRIPT    |<-- Cmd+Shift+I (spawn new agent)              |
|  |  (DevTools Port)   |<-- Cmd+Shift+K (toggle panel)                 |
|  +--------+-----------+                                                |
|           |                                                            |
|           v                                                            |
|  +---------------------------------------------------------------------+
|  |                     DOM AGENT REGISTRY                              |
|  |  +-------------+  +-------------+  +-------------+                 |
|  |  | <agent-node |  | <agent-node |  | <agent-node |                 |
|  |  |  id="a-001" |  |  id="a-002" |  |  id="a-003" |                 |
|  |  |  status=    |  |  status=    |  |  status=    |                 |
|  |  |  "working"> |  |  "idle">    |  |  "bound">   |                 |
|  |  +-------------+  +-------------+  +-------------+                 |
|  |         ^ inspectable via DevTools Elements panel                  |
|  +---------------------------------------------------------------------+
|           |                                                            |
|           v                                                            |
|  +---------------------------------------------------------------------+
|  |                     ATOMIC STATE MAP                                |
|  |  {                                                                  |
|  |    "a-001": { task, context, status, cascade_ref, results },       |
|  |    "a-002": { task, context, status, cascade_ref, results },       |
|  |  }                                                                  |
|  |         ^ persists to localStorage (survives refresh)              |
|  +---------------------------------------------------------------------+
|           |                                                            |
|           v                                                            |
|  +---------------------------------------------------------------------+
|  |                     CASCADE INSTANCES                               |
|  |  [Cascade 1: Agent-001]  [Cascade 2: Agent-002]  [Cascade 3: ...]  |
|  |         ^ output parsed for signals ([TASK_COMPLETE], etc.)        |
|  +---------------------------------------------------------------------+
|                                                                        |
+-----------------------------------------------------------------------+
```

### Component Descriptions

1. **Agent Orchestrator** (`agentOS-bundle.js`)
   - Spawns/destroys agent instances
   - Manages DOM registry for inspection
   - Handles state persistence
   - Parses output signals

2. **Workflow Engine** (`workflow-engine-bundle.js`)
   - Event-driven state machine
   - Hook system for reactions
   - Polling infrastructure for external systems
   - Command parser for workflow initiation

3. **Memory Bank** (`/memory-bank/`)
   - Persistent state across sessions
   - Shared context between agents
   - Pattern/preference learning

4. **Rules System** (`.windsurf/rules/`)
   - Agent behavior definitions
   - Signal protocol
   - Specialist configurations

### Agent Types

| Type | Purpose | Trigger |
|------|---------|---------|
| orchestrator | Coordinate complex tasks | Manual spawn |
| code-generator | Write implementation | Task assignment |
| test-writer | Generate tests | Handoff from code-gen |
| reviewer | Code review | Handoff from test |
| debugger | Fix issues | Error signals |
| team-lead | Task breakdown, reviews | Workflow states |
| qa-engineer | E2E testing | QA workflow states |

### Data Flow

```
User Task -> Orchestrator -> [Specialist Agents] -> Results
                |                    |
           Memory Bank <---- Context Saves
```

## Tech Stack
- **Runtime**: Windsurf + AgentOS extension
- **State**: localStorage + DOM nodes
- **Communication**: Text signals in Cascade output
- **Persistence**: `/memory-bank/` markdown/JSON files

## Key Files

| File | Purpose |
|------|---------|
| `/.windsurf/injector/agentOS-bundle.js` | Core agent lifecycle |
| `/.windsurf/injector/workflow-engine-bundle.js` | Workflow state machine |
| `/.windsurf/rules/01-agent-signals.md` | Signal protocol |
| `/memory-bank/context/CURRENT-TASK.md` | Active task state |
| `/docs/PROJECT-OVERVIEW.md` | This file |

## Getting Started

### Loading Order
```bash
# 1. Open DevTools Console (Cmd+Option+I)
# 2. Paste agentOS-bundle.js -> Enter
# 3. Paste workflow-engine-bundle.js -> Enter
# 4. Ready to use:
AgentOS.spawnAgent({ type: 'code-generator', name: 'Coder-1' })
```

### Keyboard Shortcuts
| Shortcut | Action |
|----------|--------|
| `Cmd+Shift+I` | Spawn new agent |
| `Cmd+Shift+K` | Toggle agent panel |
| `Cmd+Shift+L` | List agents (console) |

### Workflow Commands
```javascript
// Start full SDLC workflow
await CommandParser.parse('/implement-work-item ABC-123');

// Check status
WorkflowEngine.status();
PollManager.status();

// Manual intervention
WorkflowEngine.forceTransition('wf-xxx', 'TESTS_PASSED');
```

## Development Workflow

### Session Start
1. Load AgentOS (`Cmd+Option+I` -> paste -> enter)
2. Update `CURRENT-TASK.md` with today's goal
3. Pin key context files
4. Spawn agents as needed

### During Work
1. Let Cascade generate auto-memories
2. Use signal protocol in complex tasks
3. Document decisions in `memory-bank/context/decisions.md`

### Session End
1. Update `progress-log.md`
2. Extract patterns to `knowledge/`
3. `AgentOS.exportState()` for backup
4. Commit changes

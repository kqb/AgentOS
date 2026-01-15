# AgentOS Architecture

## System Overview

AgentOS is an extended agent orchestration layer that operates within Windsurf IDE. It provides multi-agent coordination capabilities through Chrome DevTools Protocol integration.

## Feature Availability & Alternatives

| Feature | Status | Alternative Approach |
|---------|--------|----------------------|
| Windsurf Skills | Not available | `.windsurf/rules/` + memory-bank patterns |
| MCP Servers | Disabled | CDP integration + custom tooling |
| Agent Lifecycle | Manual | Script loading via DevTools protocol |
| State Sync | None native | Atomic map structure with DOM binding |

## What Still Works

| Feature | Status | Notes |
|---------|--------|-------|
| `.windsurf/rules/` | Full support | All activation modes functional |
| Auto-generated memories | Works | Cascade creates these automatically |
| Codebase indexing | Works | M-Query retrieval fully functional |
| Context pinning | Works | @mentions, file/directory pins |
| Multiple Cascades | Works | Your agent instances |

## Core Subsystems

### 1. Agent Orchestrator (`agentOS-bundle.js`)

Responsibilities:
- Agent lifecycle management (spawn, destroy)
- DOM registry for DevTools inspection
- State persistence to localStorage
- Cascade binding and output parsing
- Signal protocol implementation

Key Classes:
- `AgentOS` - Main orchestrator singleton
- `AgentNode` - Individual agent representation

### 2. Workflow Engine (`workflow-engine-bundle.js`)

Responsibilities:
- Event-driven state machine
- Hook system for event reactions
- Polling infrastructure for external systems
- Command parsing

Key Components:
- `EventBus` - Pub/sub for decoupled communication
- `PollManager` - External system polling
- `WorkflowEngine` - State machine execution
- `CommandParser` - CLI-style commands

### 3. Signal Protocol

Text-based signals in Cascade output, parsed by orchestrator:

```
[TASK_COMPLETE]           - Task finished
[TASK_ERROR: reason]      - Task failed
[HANDOFF: type, context]  - Transfer to agent
[CONTEXT_SAVE: key=value] - Persist data
[NEXT_STATE: STATE]       - Workflow transition
```

### 4. State Persistence

Two layers:
1. **localStorage** - Agent state, workflow state
2. **Memory Bank** - Markdown/JSON files for cross-session persistence

## Workflow State Machine

Full SDLC workflow states:

```
INIT -> JIRA_FETCHED -> GH_ISSUE_CREATED -> LINKED
                                              |
                                       TASKS_ASSIGNED
                                              |
+-------------------------------------------------------------+
|                     IMPLEMENTING                             |
|  (parallel SWE agents, hooks: onAgentComplete/Error)        |
|  On failure: -> IMPLEMENTATION_FAILED (retry 3x)            |
+-------------------------------------------------------------+
                                              |
                    TESTS_WRITTEN -> TESTS_RUNNING (poll terminal)
                                              |
                    TESTS_PASSED -> IN_REVIEW -> REVIEW_APPROVED
                                              |
                         PR_CREATED (poll GitHub every 60s)
                                              |
                              PR_APPROVED -> MERGED
                                              |
                              (poll Jenkins every 30s)
                                              |
                    BUILD_SUCCESS -> IN_QA -> QA_PASSED
                                              |
                     READY_FOR_PM_REVIEW (poll Jira every 2min)
                                              |
                         PM_APPROVED -> COMPLETED
```

## File Structure

```
AgentOS/
+-- .windsurf/
|   +-- rules/                    # Cascade behavior rules
|   |   +-- 00-meta-orchestration.md
|   |   +-- 01-agent-signals.md
|   |   +-- 02-code-standards.md
|   |   +-- 03-specialist-code.md
|   |   +-- 04-specialist-test.md
|   |   +-- 05-specialist-review.md
|   +-- injector/                 # Runtime scripts
|       +-- agentOS-bundle.js
|       +-- workflow-engine-bundle.js
|       +-- loader.js
+-- docs/                         # Documentation
|   +-- PROJECT-OVERVIEW.md
|   +-- ARCHITECTURE.md
+-- memory-bank/                  # Persistent memory
|   +-- context/
|   |   +-- CURRENT-TASK.md
|   |   +-- progress-log.md
|   |   +-- decisions.md
|   +-- knowledge/
|   |   +-- patterns.json
|   |   +-- preferences.json
|   |   +-- lessons-learned.json
|   +-- handoffs/
|       +-- pending/
+-- agents/                       # Agent implementations
+-- skills/                       # Skill definitions
+-- scripts/                      # Utility scripts
+-- .codeiumignore               # Indexing exclusions
```

## Integration Points

### CDP Integration (Recommended)

Primary loading method using Chrome DevTools Protocol. More reliable than console paste for Electron-based apps.

**Prerequisites:**
Start Windsurf with remote debugging enabled:

```bash
# macOS
/Applications/Windsurf.app/Contents/MacOS/Electron --remote-debugging-port=9222

# Linux
windsurf --remote-debugging-port=9222

# Windows
windsurf.exe --remote-debugging-port=9222
```

**Loading Commands:**

```bash
# Build the bundle first
npm run bundle

# Load into running Windsurf
npm run inject

# Load persistently (survives page reloads)
npm run inject:persistent

# List available targets
npm run inject -- --list

# Load into specific target
npm run inject -- --target <targetId>
```

**Programmatic Loading:**

```javascript
import { CdpClient, CdpInjector } from './src/cdp/index.js';

// Configure and connect
CdpClient.configure({ port: 9222 });
await CdpClient.connect();

// Load bundle
await CdpInjector.loadBundle('./dist/agentOS-combined.js');
await CdpInjector.injectPersistent();

// Execute commands in page context
await CdpInjector.execute('AgentOS.list()');
```

### DOM Registry
Hidden `<agent-node>` elements in `#agent-os-registry` div. Inspectable via DevTools Elements panel.

### localStorage Keys
- `agentOS_state` - Agent state
- `workflowEngine_state` - Workflow state
- `mock_{source}_{endpoint}` - Poll mock data

### Cascade Integration
- Output parsing via MutationObserver
- Input insertion via textarea manipulation
- Panel binding via DOM selectors

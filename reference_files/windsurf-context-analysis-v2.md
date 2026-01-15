# Windsurf Context System Deep Dive & Custom Multi-Agent Infrastructure

## Executive Summary

This document provides a comprehensive analysis of Windsurf's context system internals and a complete architecture for building multi-agent orchestration **without** relying on Windsurf's Skills feature or MCP (both unavailable in your environment). Instead, we use Chrome DevTools Protocol integration, DOM-based agent registry, and atomic state synchronization.

**Your Constraints:**
| Feature | Status | Alternative Approach |
|---------|--------|----------------------|
| Windsurf Skills | ❌ Not available | `.windsurf/rules/` + memory-bank patterns |
| MCP Servers | ❌ Disabled | CDP integration + custom tooling |
| Agent Lifecycle | ❌ No native support | Script loading via DevTools protocol |
| State Sync | ❌ None native | Atomic map structure with DOM binding |

**What Still Works:**
| Feature | Status | Notes |
|---------|--------|-------|
| `.windsurf/rules/` | ✅ Full support | All activation modes functional |
| Auto-generated memories | ✅ Works | Cascade creates these automatically |
| Codebase indexing | ✅ Works | M-Query retrieval fully functional |
| Context pinning | ✅ Works | @mentions, file/directory pins |
| Multiple Cascades | ✅ Works | Your agent instances |

---

## Part 1: How Windsurf's Context System Works

### 1.1 The Core Architecture

Windsurf's context engine is built on a **Retrieval-Augmented Generation (RAG)** architecture with three primary subsystems. Understanding this lets you leverage it effectively:

```
┌─────────────────────────────────────────────────────────────────┐
│                    WINDSURF CONTEXT ENGINE                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────────┐ │
│  │   INDEXING   │   │   MEMORIES   │   │   RULES/WORKFLOWS   │ │
│  │   ENGINE     │   │   SYSTEM     │   │   SYSTEM            │ │
│  └──────┬───────┘   └──────┬───────┘   └──────────┬──────────┘ │
│         │                  │                      │             │
│         ▼                  ▼                      ▼             │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              M-QUERY RETRIEVAL LAYER                        ││
│  │     (Semantic search + Re-ranking + Context assembly)       ││
│  └─────────────────────────────────────────────────────────────┘│
│                              │                                   │
│                              ▼                                   │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              FLOW AWARENESS LAYER                           ││
│  │     (Real-time action tracking + Intent prediction)         ││
│  └─────────────────────────────────────────────────────────────┘│
│                              │                                   │
│                              ▼                                   │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              CASCADE AGENT                                  ││
│  │     (ReAct loop + Tool calling + Multi-file operations)     ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 The Indexing Engine

**How It Works:**

1. **Embedding Generation**: Converts all code into numerical vectors (embeddings) that capture semantic meaning. Uses specialized encoder models that **heavily weight comments and docstrings**.

2. **Local Indexing Constraints**:
   - Default enabled, indexes files on your machine
   - Cap of ~10,000 files (10GB RAM constraint)
   - Respects `.codeiumignore` (same syntax as `.gitignore`)

3. **M-Query Retrieval**: Windsurf's proprietary two-stage retrieval:
   - Stage 1: Vector similarity search across entire codebase
   - Stage 2: AI-powered re-ranking for relevance to current task

4. **What Gets Indexed** (in priority order):
   - Comments and docstrings (heavily weighted - use this to your advantage)
   - Function/class signatures
   - File paths and structure
   - Import/dependency relationships
   - Variable names and types

**Key Insight**: The indexing engine treats comments and docstrings as high-signal content. You can effectively "program" the context engine by strategically placing documentation that describes your agent architecture.

### 1.3 The Memories System

There are **two distinct memory types** that work without Skills/MCP:

#### Auto-Generated Memories (Still Works ✅)
- Cascade autonomously identifies and saves useful context
- Workspace-scoped (don't transfer between projects)
- Examples: "Project uses Python 3.11", "Authentication handled via JWT"
- **FREE** - don't consume credits
- Retrieved when Cascade believes relevant
- You can prompt: "Create a memory of [X]"

#### User-Defined Rules (Still Works ✅)

| Level | Location | Scope |
|-------|----------|-------|
| Global | `global_rules.md` | All workspaces |
| Workspace | `.windsurf/rules/*.md` | Current project only |

**Rule Activation Modes** (all still functional):

1. **Manual**: Triggered via `@mention` in Cascade input
2. **Always On**: Applied to every Cascade interaction
3. **Model Decision**: AI decides based on natural language description
4. **Glob**: Applied when working with matching files (e.g., `*.py`)

**Character Limits**:
- Individual rule files: 12,000 characters max
- Total combined rules: Truncation occurs if exceeded (global rules prioritized)

### 1.4 Flow Awareness (The Secret Weapon)

This is what makes Windsurf different and what we leverage for agent coordination:

**Real-Time Tracking**:
- Code edits and cursor position
- Terminal output and errors
- Clipboard content (opt-in)
- Open files and tabs

**Behavioral Implication**: Cascade adjusts its plan mid-execution if you modify code during an AI Flow. This event-driven architecture means you can "steer" agent behavior through your own actions - or through loaded scripts.

### 1.5 Context Window Management

Windsurf uses sophisticated strategies to manage limited context:

1. **Priority Hierarchy**:
   - Pinned context (highest priority)
   - Current file + open files
   - Recent edits/actions
   - Retrieved codebase snippets
   - Memories/rules

2. **70% Reload Trigger**: When context reaches ~70% capacity, global and workspace rulesets reload to prevent losing critical information

3. **Context Pinning**: Users can explicitly pin:
   - Specific files
   - Directories
   - Code snippets
   - Documentation references

---

## Part 2: Custom Multi-Agent Infrastructure (No Skills/MCP)

Since Skills and MCP are unavailable, we build our own orchestration layer using Chrome DevTools Protocol.

### 2.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    EXTENDED AGENT ORCHESTRATION LAYER                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌────────────────────┐                                                  │
│  │  RUNTIME SCRIPT    │◀── Cmd+Shift+I (spawn new agent)                │
│  │  (DevTools Port)   │◀── Cmd+Shift+K (toggle panel)                   │
│  └─────────┬──────────┘                                                  │
│            │                                                             │
│            ▼                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                     DOM AGENT REGISTRY                              ││
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                 ││
│  │  │ <agent-node │  │ <agent-node │  │ <agent-node │                 ││
│  │  │  id="a-001" │  │  id="a-002" │  │  id="a-003" │                 ││
│  │  │  status=    │  │  status=    │  │  status=    │                 ││
│  │  │  "working"> │  │  "idle">    │  │  "bound">   │                 ││
│  │  └─────────────┘  └─────────────┘  └─────────────┘                 ││
│  │         ↕ inspectable via DevTools Elements panel                  ││
│  └─────────────────────────────────────────────────────────────────────┘│
│            │                                                             │
│            ▼                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                     ATOMIC STATE MAP                                ││
│  │  {                                                                  ││
│  │    "a-001": { task, context, status, cascade_ref, results },        ││
│  │    "a-002": { task, context, status, cascade_ref, results },        ││
│  │  }                                                                  ││
│  │         ↕ persists to localStorage (survives refresh)              ││
│  └─────────────────────────────────────────────────────────────────────┘│
│            │                                                             │
│            ▼                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                     CASCADE INSTANCES                               ││
│  │  [Cascade 1: Agent-001]  [Cascade 2: Agent-002]  [Cascade 3: ...]  ││
│  │         ↕ output parsed for signals ([TASK_COMPLETE], etc.)        ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Agent Lifecycle Flow

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   SPAWN      │────▶│    BIND      │────▶│   WORKING    │
│ Cmd+Shift+I  │     │  to Cascade  │     │  executing   │
└──────────────┘     └──────────────┘     └──────┬───────┘
                                                  │
                     ┌────────────────────────────┼────────────────────────────┐
                     │                            │                            │
                     ▼                            ▼                            ▼
              ┌──────────────┐           ┌──────────────┐           ┌──────────────┐
              │ [TASK_COMPLETE]│          │ [HANDOFF:    │           │ [TASK_ERROR: │
              │   → idle     │           │  type,ctx]   │           │  reason]     │
              └──────────────┘           │   → spawn    │           └──────────────┘
                                         │     target   │
                                         └──────────────┘
```

### 2.3 Signal Protocol (Works via Rules)

Since we can't use MCP for agent communication, we use text signals that Cascade outputs and our injected script parses:

| Signal | Purpose | Example |
|--------|---------|---------|
| `[TASK_COMPLETE]` | Task finished successfully | `[TASK_COMPLETE]` |
| `[TASK_ERROR: x]` | Task failed with reason | `[TASK_ERROR: API timeout]` |
| `[HANDOFF: type, ctx]` | Transfer to another agent | `[HANDOFF: reviewer, PR#123]` |
| `[NEEDS_INPUT: q]` | Requires human decision | `[NEEDS_INPUT: Which DB to use?]` |
| `[CONTEXT_SAVE: k=v]` | Persist to shared state | `[CONTEXT_SAVE: endpoint=/api/v2]` |
| `[SUBTASK: desc]` | Spawn subtask agent | `[SUBTASK: write unit tests]` |

---

## Part 3: Recommended Workspace Structure

### 3.1 Directory Layout

```
your-workspace/
├── .windsurf/
│   ├── rules/
│   │   ├── 00-meta-orchestration.md      # Core agent coordination (Always On)
│   │   ├── 01-agent-signals.md           # Signal protocol (Always On)
│   │   ├── 02-code-standards.md          # Your coding conventions (Always On)
│   │   ├── 03-specialist-code.md         # Code agent rules (Glob: *.py,*.js)
│   │   ├── 04-specialist-test.md         # Test agent rules (Glob: *test*)
│   │   └── 05-specialist-review.md       # Review agent rules (Model Decision)
│   │
│   └── injector/
│       ├── agentOS-bundle.js             # Main injection script
│       ├── loader.js                     # Quick-load helper
│       └── README.md                     # Usage instructions
│
├── .codeiumignore                        # Exclude noise from indexing
│
├── docs/
│   ├── PROJECT-OVERVIEW.md              # High-level context (PIN THIS)
│   ├── ARCHITECTURE.md                  # System architecture
│   ├── ADR/                             # Architecture Decision Records
│   │   ├── 001-agent-communication.md
│   │   ├── 002-state-persistence.md
│   │   └── ...
│   └── patterns/
│       ├── map-reduce.md
│       ├── orchestrator-worker.md
│       └── evaluator-optimizer.md
│
├── agents/
│   ├── core/
│   │   ├── orchestrator/                # Central coordination logic
│   │   ├── workflow-dna/                # Pattern extraction
│   │   └── skill-registry/              # Skill marketplace
│   ├── specialists/
│   │   ├── code-generator/
│   │   ├── test-writer/
│   │   ├── code-reviewer/
│   │   ├── doc-writer/
│   │   └── debugger/
│   └── templates/
│       └── base-agent.py
│
├── memory-bank/                         # Persistent agent memory
│   ├── context/
│   │   ├── CURRENT-TASK.md             # Active task state (PIN THIS)
│   │   ├── progress-log.md
│   │   └── decisions.md
│   ├── knowledge/
│   │   ├── patterns.json               # Learned workflow patterns
│   │   ├── preferences.json            # Your "taste model"
│   │   └── lessons-learned.json
│   └── handoffs/
│       └── pending/                    # Inter-agent handoff queue
│
├── skills/
│   ├── registry.json                   # Skill catalog
│   ├── builtin/
│   │   ├── refactor/
│   │   ├── test-gen/
│   │   └── api-scaffold/
│   └── custom/
│
└── scripts/
    ├── inject-agents.sh               # Quick injection helper
    └── export-state.js                # State export utility
```

### 3.2 Critical Files

#### `.windsurf/rules/00-meta-orchestration.md` (Always On)

```markdown
# Meta Orchestration Rules

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
```

#### `.windsurf/rules/01-agent-signals.md` (Always On)

```markdown
# Agent Signal Protocol

When operating as part of the AgentOS multi-agent system, use these signals to communicate state:

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

## Signal Format Rules
- Always wrap signals in square brackets
- Include relevant data after colon
- Signals can appear anywhere in response
- Multiple signals allowed in one response
```

#### `.windsurf/rules/03-specialist-code.md` (Glob: `*.py, *.js, *.ts`)

```markdown
# Code Generation Specialist Rules

## Activation
These rules apply when working on source code files.

## Code Quality Standards
- Every function must have a docstring (critical for indexing)
- Use type hints in Python, TypeScript types in JS/TS
- Prefer composition over inheritance
- Maximum function length: 50 lines
- Extract magic numbers to named constants

## Documentation Pattern
```python
def function_name(param: Type) -> ReturnType:
    """
    Brief description of what this does.
    
    This docstring is indexed by Windsurf for context retrieval.
    Include: purpose, key behaviors, edge cases.
    
    Args:
        param: Description of parameter
        
    Returns:
        Description of return value
        
    Raises:
        ExceptionType: When this happens
    """
```

## Agent Context
If operating as code-generator agent:
- Focus only on implementation
- Handoff testing to: `[HANDOFF: test-writer, <function/file>]`
- Handoff review to: `[HANDOFF: reviewer, <changes summary>]`
```

#### `docs/PROJECT-OVERVIEW.md` (Pin This File)

```markdown
# Project Overview: AgentOS - Multi-Agent Development Platform

## Vision
Build autonomous development workflows that 10-100x engineering productivity through coordinated AI agents operating within Windsurf.

## Architecture

### Core Components

1. **Agent Orchestrator** (injected via DevTools)
   - Spawns/destroys agent instances
   - Manages DOM registry for inspection
   - Handles state persistence
   - Parses output signals

2. **Cascade Instances** (native Windsurf)
   - Each agent binds to a Cascade panel
   - Context loaded via rules system
   - Output parsed for signals

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

### Data Flow

```
User Task → Orchestrator → [Specialist Agents] → Results
                ↓                    ↓
           Memory Bank ←──── Context Saves
```

## Tech Stack
- **Runtime**: Windsurf + injected AgentOS
- **State**: localStorage + DOM nodes
- **Communication**: Text signals in Cascade output
- **Persistence**: `/memory-bank/` markdown/JSON files

## Key Files
- `/memory-bank/context/CURRENT-TASK.md` - Active task state
- `/.windsurf/rules/01-agent-signals.md` - Signal protocol
- `/.windsurf/injector/agentOS-bundle.js` - Injection script
```

#### `memory-bank/context/CURRENT-TASK.md`

```markdown
# Current Task Context

**Last Updated**: [timestamp]
**Active Agents**: [list]

## Current Objective
[Describe the current high-level goal]

## Progress Checkpoints
- [ ] Checkpoint 1: [description]
- [ ] Checkpoint 2: [description]
- [ ] Checkpoint 3: [description]

## Active Agent States
| Agent ID | Type | Status | Current Work |
|----------|------|--------|--------------|
| a-xxx    | code | working | implementing X |

## Decisions Made This Session
- [Decision 1]: [rationale]

## Shared Context
```json
{
  "key": "value"
}
```

## Pending Handoffs
- [ ] [from] → [to]: [context]

## Blockers / Questions
- [Question needing human input]

## Next Steps
1. [Next action]
```

### 3.3 The `.codeiumignore` File

```gitignore
# Exclude from Windsurf indexing to keep context clean and fast

# Dependencies (massive noise, not useful)
node_modules/
venv/
.venv/
__pycache__/
*.pyc
.pytest_cache/
.mypy_cache/

# Build artifacts
dist/
build/
*.egg-info/
.next/
out/

# Large/binary files
*.csv
*.xlsx
*.pdf
*.zip
*.tar.gz
*.log

# Temp files
*.tmp
*.bak
*.swp
.DS_Store

# Test coverage (noise)
coverage/
htmlcov/
.coverage

# IDE configs (not useful for context)
.idea/
.vscode/settings.json

# ===========================================
# DO NOT IGNORE (important for agent context):
# - .windsurf/rules/  (agent behavior)
# - docs/             (architecture context)
# - memory-bank/      (persistent state)
# - agents/           (agent implementations)
# - skills/           (skill definitions)
# ===========================================
```

---

## Part 4: AgentOS Injection System

### 4.1 How to Use

1. **Open Windsurf DevTools**: `Cmd+Option+I` (Mac) or `Ctrl+Shift+I` (Win/Linux)
2. **Go to Console tab**
3. **Paste entire contents of** `agentOS-bundle.js`
4. **Press Enter**

You'll see:
```
╔═══════════════════════════════════════════════════════════════╗
║                     🤖 AgentOS Loaded                          ║
╠═══════════════════════════════════════════════════════════════╣
║  Cmd+Shift+I  →  Spawn new agent                              ║
║  Cmd+Shift+K  →  Toggle agent panel                           ║
║  Cmd+Shift+L  →  List agents (console)                        ║
╚═══════════════════════════════════════════════════════════════╝
```

### 4.2 Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+Shift+I` | Spawn new agent |
| `Cmd+Shift+K` | Toggle visual agent panel |
| `Cmd+Shift+L` | List all agents in console |

### 4.3 Console API

```javascript
// List all agents
AgentOS.list()

// Inspect specific agent
AgentOS.inspect('a-xxx')

// Spawn with custom config
AgentOS.spawnAgent({
  type: 'code-generator',
  name: 'CodeBot-1',
  context: { targetFile: 'utils.py' }
})

// Assign task to agent
AgentOS.assignTask('a-xxx', {
  type: 'implement',
  description: 'Add validation to user input',
  files: ['src/handlers.py']
})

// Kill agent
AgentOS.destroyAgent('a-xxx')

// Export full state
AgentOS.exportState()

// Sync all agents
AgentOS.syncAll()

// Restore from localStorage
AgentOS.restoreState()
```

### 4.4 DOM Inspection

Each agent creates an `<agent-node>` element inspectable in DevTools:

```html
<agent-node 
  id="aos-agent-a-xxx"
  data-agent-id="a-xxx"
  data-status="working"
  data-type="code-generator"
  data-created="2025-01-14T12:00:00Z"
  data-state='{"id":"a-xxx","config":{...},"taskQueue":[...],"context":{...}}'>
</agent-node>
```

**To inspect**: DevTools → Elements → Find `#agent-os-registry` → Expand to see all `<agent-node>` elements

---

## Part 5: Optimization Strategies

### 5.1 Maximizing Context Quality

**Strategy 1: Documentation-Driven Context**

The indexing engine heavily weights comments and docstrings. Use this to your advantage:

```python
"""
Agent: Code Generator
Purpose: Implement features based on specifications
Dependencies: ast, black, isort
Orchestration: Called via AgentOS, outputs to test-writer

CRITICAL CONTEXT FOR CASCADE:
- Always run black formatter before completing
- Follow patterns in /docs/patterns/
- Check /memory-bank/knowledge/preferences.json for style
"""

class FeatureImplementer:
    """
    Implements features following the team's established patterns.
    
    This class is indexed by Windsurf. Include key behavioral notes here.
    Cascade will retrieve this when working on related code.
    """
```

**Strategy 2: Strategic File Placement**

Files at workspace root get higher context priority:

```
workspace/
├── ARCHITECTURE.md      # Always high priority
├── CURRENT-TASK.md      # Symlink to memory-bank version
├── agents/...
```

**Strategy 3: Context Pinning Protocol**

Before complex multi-agent work:
1. Pin `docs/PROJECT-OVERVIEW.md`
2. Pin `memory-bank/context/CURRENT-TASK.md`
3. Pin relevant agent directory

### 5.2 Building Your Workflow DNA Extractor

Track interventions to build your "taste model":

```python
# memory-bank/knowledge/workflow_dna.py
"""
Workflow DNA - Captures patterns from your interventions
Indexed by Windsurf for context awareness
"""

LEARNED_PATTERNS = {
    "refactor_approval": {
        "description": "When to auto-approve refactoring",
        "auto_approve_when": [
            "has_existing_tests",
            "changes_under_50_lines",
            "no_public_api_changes"
        ],
        "require_review_when": [
            "modifies_authentication",
            "changes_database_schema",
            "affects_external_api"
        ]
    },
    "test_generation": {
        "description": "Test generation preferences",
        "always": [
            "pytest_style",
            "fixtures_over_setup",
            "descriptive_test_names"
        ],
        "never": [
            "unittest_style",
            "mock_everything"
        ]
    }
}

# When Cascade retrieves this, it learns your preferences
```

### 5.3 Multi-Agent Task Execution Pattern

```
User: "Add user authentication to the API"
                    │
                    ▼
┌─────────────────────────────────────────────────┐
│  Orchestrator Agent (you, manually)             │
│  - Break down into subtasks                     │
│  - Spawn specialists                            │
└─────────────────────────────────────────────────┘
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
   ┌─────────┐ ┌─────────┐ ┌─────────┐
   │ Code    │ │ Code    │ │ Code    │
   │ Agent 1 │ │ Agent 2 │ │ Agent 3 │
   │ (model) │ │ (routes)│ │ (middleware)
   └────┬────┘ └────┬────┘ └────┬────┘
        │           │           │
        └─────┬─────┴─────┬─────┘
              ▼           
   [TASK_COMPLETE] signals parsed
              │
              ▼
   ┌─────────────────────┐
   │    Test Agent       │
   │ [HANDOFF: test-     │
   │  writer, auth/*]    │
   └──────────┬──────────┘
              │
              ▼
   [TASK_COMPLETE]
              │
              ▼
   ┌─────────────────────┐
   │   Review Agent      │
   │ [HANDOFF: reviewer, │
   │  PR summary]        │
   └─────────────────────┘
```

---

## Part 6: Quick Reference

### 6.1 File Purposes

| File | Purpose | When to Update |
|------|---------|----------------|
| `.windsurf/rules/00-meta-orchestration.md` | Core agent behavior | Rarely |
| `.windsurf/rules/01-agent-signals.md` | Signal protocol | Never (stable) |
| `docs/PROJECT-OVERVIEW.md` | System context | When architecture changes |
| `memory-bank/context/CURRENT-TASK.md` | Active task state | Every session |
| `memory-bank/knowledge/patterns.json` | Learned patterns | When patterns discovered |

### 6.2 Daily Workflow

**Session Start:**
1. Inject AgentOS (`Cmd+Option+I` → paste → enter)
2. Update `CURRENT-TASK.md` with today's goal
3. Pin key context files
4. Spawn agents as needed

**During Work:**
1. Let Cascade generate auto-memories (free)
2. Use signal protocol in complex tasks
3. Document decisions in `memory-bank/context/decisions.md`

**Session End:**
1. Update `progress-log.md`
2. Extract patterns to `knowledge/`
3. `AgentOS.exportState()` for backup
4. Commit `.windsurf/rules/` changes

### 6.3 Signal Quick Reference

```
[TASK_COMPLETE]                    - Done, move to next
[TASK_COMPLETE: built auth API]    - Done with summary
[TASK_ERROR: DB connection failed] - Failed, need help
[HANDOFF: test-writer, auth.py]    - Pass to specialist
[NEEDS_INPUT: SQL or NoSQL?]       - Need human decision
[CONTEXT_SAVE: db_type=postgres]   - Save for other agents
[SUBTASK: add rate limiting]       - Spawn sub-agent
```

---

---

## Part 7: Workflow Orchestration (Hooks & Polling)

For complex workflows like `/implement-work-item ABC-123`, simple signals aren't enough. You need:

### 7.1 The Problem

| Scenario | Why Signals Fail |
|----------|------------------|
| Waiting for PR approval | External system, indefinite wait |
| Jenkins build status | Async, could take 30+ minutes |
| PM acceptance on Jira | Human-in-the-loop, polling required |
| Parallel agent work | Need to track multiple completions |
| Retries on failure | State machine with branching |

### 7.2 The Solution: Event-Driven State Machine

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   EVENT BUS     │────▶│  STATE MACHINE  │────▶│   POLL MANAGER  │
│   (hooks)       │     │  (transitions)  │     │   (external)    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         ▲                       │                       │
         │                       ▼                       │
         │              ┌─────────────────┐              │
         └──────────────│   AGENT POOL    │◀─────────────┘
                        │   (execution)   │
                        └─────────────────┘
```

### 7.3 Key Components

**Event Bus**: Decouples components via pub/sub
```javascript
EventBus.on('agent:complete', handler);
EventBus.emit('workflow:transition', { from, to });
```

**Poll Manager**: Watches external systems
```javascript
PollManager.start('pr-status', {
  source: 'github',
  endpoint: 'pr_status',
  interval: 60000,  // Every minute
  workflowId: 'wf-xxx'
});
```

**Hooks**: React to events synchronously
```javascript
registerHook('onJenkinsBuild', async (payload) => {
  if (payload.result === 'SUCCESS') {
    workflow.transition('BUILD_SUCCESS');
  }
});
```

### 7.4 Full SDLC Workflow States

```
INIT → JIRA_FETCHED → GH_ISSUE_CREATED → LINKED
                                            ↓
                                     TASKS_ASSIGNED
                                            ↓
┌─────────────────────────────────────────────────────────────┐
│                     IMPLEMENTING                             │
│  (parallel SWE agents, hooks: onAgentComplete/Error)        │
│  On failure: → IMPLEMENTATION_FAILED (retry 3x)             │
└─────────────────────────────────────────────────────────────┘
                                            ↓
                    TESTS_WRITTEN → TESTS_RUNNING (poll terminal)
                                            ↓
                    TESTS_PASSED → IN_REVIEW → REVIEW_APPROVED
                                            ↓
                         PR_CREATED (poll GitHub every 60s)
                                            ↓
                              PR_APPROVED → MERGED
                                            ↓
                              (poll Jenkins every 30s)
                                            ↓
                    BUILD_SUCCESS → IN_QA → QA_PASSED
                                            ↓
                     READY_FOR_PM_REVIEW (poll Jira every 2min)
                                            ↓
                         PM_APPROVED → COMPLETED ✓
```

### 7.5 Usage

```javascript
// Start full workflow
await CommandParser.parse('/implement-work-item ABC-123');

// Or programmatically
await WorkflowEngine.start('implement-work-item', { jiraKey: 'ABC-123' });

// Monitor
WorkflowEngine.status();
PollManager.status();

// Manual intervention
WorkflowEngine.forceTransition('wf-xxx', 'TESTS_PASSED');
WorkflowEngine.abort('wf-xxx');

// Mock external data for testing
PollManager.setMockData('github', 'pr_status', { state: 'approved' });
```

### 7.6 Extended Signals for Workflows

```markdown
# In your .windsurf/rules/01-agent-signals.md

## Workflow Control Signals
- `[NEXT_STATE: STATE_NAME]` - Suggest next state transition
- `[CONTEXT_SAVE: key=value]` - Persist data for workflow
- `[NEEDS_HUMAN: question]` - Pause for human input

## Examples
After tests pass:     `[TASK_COMPLETE] [NEXT_STATE: TESTS_PASSED]`
After review:         `[TASK_COMPLETE] [NEXT_STATE: REVIEW_APPROVED]`
Save branch name:     `[CONTEXT_SAVE: branchName=feature/abc-123]`
```

See `workflow-orchestration-system.md` and `workflow-engine-bundle.js` for complete implementation.

---

## Summary

Your multi-agent orchestration system works by leveraging Windsurf's native context features (rules, memories, indexing) combined with a custom runtime layer for agent lifecycle management:

| Layer | Implementation |
|-------|---------------|
| Agent Spawning | `Cmd+Shift+I` → DevTools loading |
| Agent Registry | DOM `<agent-node>` elements |
| State Persistence | Atomic map + localStorage |
| Inter-Agent Comms | Text signals parsed from Cascade output |
| Context Loading | `.windsurf/rules/` (native, works fully) |
| Memory Persistence | `/memory-bank/` files + auto-memories |
| **Workflow Engine** | Event-driven state machine |
| **Event Bus** | Pub/sub for hooks and reactions |
| **Poll Manager** | External system monitoring (Jira/GH/Jenkins) |
| **Command Parser** | `/implement-work-item` style commands |

## Deliverables

| File | Purpose |
|------|---------|
| `agentOS-bundle.js` | Core agent lifecycle + DOM registry |
| `workflow-engine-bundle.js` | State machine + polling + hooks (inject AFTER AgentOS) |
| `windsurf-context-analysis-v2.md` | This document |
| `workflow-orchestration-system.md` | Deep dive on workflow architecture |
| `custom-agent-infrastructure.md` | Technical implementation details |

## Injection Order

```bash
# 1. Open DevTools Console (Cmd+Option+I)
# 2. Paste agentOS-bundle.js → Enter
# 3. Paste workflow-engine-bundle.js → Enter
# 4. Ready to use:
/implement-work-item ABC-123
```

The key insight: **Windsurf's context system is programmable infrastructure**. By structuring your workspace correctly and using the rules system effectively, you get sophisticated AI agent coordination without needing Skills or MCP.

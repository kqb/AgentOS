# Custom Multi-Agent Infrastructure via Chrome DevTools Protocol

## Constraint Analysis

| Feature | Status | Alternative Approach |
|---------|--------|----------------------|
| Windsurf Skills | Not available | Use `.windsurf/rules/` + memory-bank patterns |
| MCP Servers | Disabled | CDP integration + custom tooling |
| Agent Lifecycle | Manual | Script loading via DevTools protocol |
| State Sync | None native | Atomic map structure with DOM binding |

**Key Insight**: The context system (rules, memories, indexing) is **decoupled** from Skills/MCP. Your rules still load, memories still persist, indexing still works. We're just building our own orchestration layer.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    EXTENDED AGENT ORCHESTRATION LAYER                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌────────────────────┐                                                  │
│  │  RUNTIME SCRIPT    │◀── Cmd+Shift+I (spawn new agent)                │
│  │  (DevTools Port)   │                                                  │
│  └─────────┬──────────┘                                                  │
│            │                                                             │
│            ▼                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                     DOM AGENT REGISTRY                              ││
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                 ││
│  │  │ <agent-node │  │ <agent-node │  │ <agent-node │                 ││
│  │  │  id="a-001" │  │  id="a-002" │  │  id="a-003" │                 ││
│  │  │  status=    │  │  status=    │  │  status=    │                 ││
│  │  │  "active">  │  │  "working"> │  │  "idle">    │                 ││
│  │  └─────────────┘  └─────────────┘  └─────────────┘                 ││
│  └─────────────────────────────────────────────────────────────────────┘│
│            │                                                             │
│            ▼                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                     ATOMIC STATE MAP                                ││
│  │  {                                                                  ││
│  │    "a-001": { task, context, status, cascade_instance },            ││
│  │    "a-002": { task, context, status, cascade_instance },            ││
│  │  }                                                                  ││
│  └─────────────────────────────────────────────────────────────────────┘│
│            │                                                             │
│            ▼                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                     CASCADE INSTANCES                               ││
│  │  [Tab 1: Agent-001]  [Tab 2: Agent-002]  [Tab 3: Agent-003]        ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Part 1: Chrome DevTools Protocol Integration

### 1.1 The CDP Entry Point

Windsurf (Electron-based) exposes Chrome DevTools Protocol. We load scripts via:

```javascript
// injector-bootstrap.js
// Load this via DevTools console or as extension

(function() {
  'use strict';
  
  const AGENT_ORCHESTRATOR = {
    version: '1.0.0',
    agents: new Map(),
    domRegistry: null,
    stateMap: null,
    
    // Initialize the orchestration infrastructure
    init() {
      this.createDOMRegistry();
      this.initStateMap();
      this.bindKeyboardShortcuts();
      this.injectStyles();
      console.log('[AgentOS] Infrastructure initialized');
    },
    
    // Cmd+Shift+I spawns new agent
    bindKeyboardShortcuts() {
      document.addEventListener('keydown', (e) => {
        // Cmd+Shift+I (Mac) or Ctrl+Shift+I (Win/Linux)
        if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'I') {
          e.preventDefault();
          this.spawnAgent();
        }
        // Cmd+Shift+K to open agent panel
        if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'K') {
          e.preventDefault();
          this.toggleAgentPanel();
        }
      });
    }
  };
  
  // Expose globally for console access
  window.AgentOS = AGENT_ORCHESTRATOR;
  window.AgentOS.init();
})();
```

### 1.2 DOM Registry Creation

```javascript
// dom-registry.js
// Creates invisible DOM structure for agent tracking

AGENT_ORCHESTRATOR.createDOMRegistry = function() {
  // Create hidden container (invisible, inspectable via DevTools)
  const registry = document.createElement('div');
  registry.id = 'agent-registry';
  registry.setAttribute('data-agent-os', 'true');
  registry.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 0;
    height: 0;
    overflow: hidden;
    pointer-events: none;
    z-index: -1;
  `;
  
  document.body.appendChild(registry);
  this.domRegistry = registry;
  
  // Also create visible panel (toggleable)
  this.createAgentPanel();
};

AGENT_ORCHESTRATOR.createAgentPanel = function() {
  const panel = document.createElement('div');
  panel.id = 'agent-panel';
  panel.innerHTML = `
    <div class="agent-panel-header">
      <span>🤖 Agent Registry</span>
      <button onclick="AgentOS.toggleAgentPanel()">×</button>
    </div>
    <div class="agent-panel-body" id="agent-list"></div>
    <div class="agent-panel-footer">
      <button onclick="AgentOS.spawnAgent()">+ New Agent</button>
      <button onclick="AgentOS.syncAll()">⟳ Sync</button>
    </div>
  `;
  panel.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    width: 320px;
    max-height: 400px;
    background: #1e1e1e;
    border: 1px solid #3c3c3c;
    border-radius: 8px;
    font-family: system-ui;
    font-size: 12px;
    color: #ccc;
    display: none;
    z-index: 99999;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  `;
  document.body.appendChild(panel);
  this.agentPanel = panel;
};
```

---

## Part 2: Agent Lifecycle Management

### 2.1 Agent Node Structure

```javascript
// agent-node.js
// Each agent is represented as a DOM node for inspection

class AgentNode {
  constructor(id, config) {
    this.id = id;
    this.config = config;
    this.status = 'initializing';
    this.cascadeInstance = null;
    this.taskQueue = [];
    this.context = {};
    this.domNode = this.createDOMNode();
  }
  
  createDOMNode() {
    const node = document.createElement('agent-node');
    node.id = `agent-${this.id}`;
    node.setAttribute('data-status', this.status);
    node.setAttribute('data-type', this.config.type || 'general');
    node.setAttribute('data-created', new Date().toISOString());
    
    // Store serialized state as data attribute (inspectable)
    node.setAttribute('data-state', JSON.stringify({
      id: this.id,
      config: this.config,
      status: this.status,
      taskQueue: this.taskQueue,
      context: this.context
    }));
    
    AgentOS.domRegistry.appendChild(node);
    return node;
  }
  
  updateStatus(newStatus) {
    this.status = newStatus;
    this.domNode.setAttribute('data-status', newStatus);
    this.syncState();
    AgentOS.renderAgentList();
  }
  
  syncState() {
    this.domNode.setAttribute('data-state', JSON.stringify({
      id: this.id,
      config: this.config,
      status: this.status,
      taskQueue: this.taskQueue,
      context: this.context,
      lastSync: Date.now()
    }));
  }
  
  destroy() {
    this.domNode.remove();
    AgentOS.agents.delete(this.id);
    AgentOS.stateMap.delete(this.id);
    AgentOS.renderAgentList();
  }
}
```

### 2.2 Agent Spawning

```javascript
// agent-spawner.js
// Cmd+Shift+I triggers this

AGENT_ORCHESTRATOR.spawnAgent = function(config = {}) {
  const id = this.generateAgentId();
  
  const defaultConfig = {
    type: 'general',
    name: `Agent-${id.slice(0, 4)}`,
    autoStart: true,
    context: {},
    rules: [],  // Additional rules to inject
    ...config
  };
  
  // Create agent node
  const agent = new AgentNode(id, defaultConfig);
  this.agents.set(id, agent);
  
  // Initialize in state map
  this.stateMap.set(id, {
    agent: agent,
    cascadeTab: null,
    tasks: [],
    results: [],
    createdAt: Date.now()
  });
  
  // Auto-open new Cascade instance if configured
  if (defaultConfig.autoStart) {
    this.openCascadeForAgent(agent);
  }
  
  agent.updateStatus('ready');
  this.renderAgentList();
  
  console.log(`[AgentOS] Spawned agent: ${id}`);
  return agent;
};

AGENT_ORCHESTRATOR.generateAgentId = function() {
  return 'a-' + Math.random().toString(36).substr(2, 9);
};
```

### 2.3 Cascade Instance Binding

```javascript
// cascade-binding.js
// Associates Cascade panels with agents

AGENT_ORCHESTRATOR.openCascadeForAgent = function(agent) {
  // Method 1: Programmatic new Cascade (if API available)
  // This depends on Windsurf's internal API exposure
  
  // Method 2: Simulate keyboard shortcut for new Cascade
  // Windsurf uses Cmd+L or similar for new Cascade
  
  // Method 3: Track existing Cascade panels
  const cascadePanels = document.querySelectorAll('[data-cascade-panel]');
  
  // Find unassigned panel or prompt user
  const unassignedPanel = Array.from(cascadePanels).find(panel => {
    return !panel.hasAttribute('data-agent-bound');
  });
  
  if (unassignedPanel) {
    this.bindCascadeToAgent(unassignedPanel, agent);
  } else {
    // Queue for binding when new panel opens
    this.pendingBindings.push(agent);
    this.showNotification(`Open new Cascade (Cmd+L) to bind Agent ${agent.id}`);
  }
};

AGENT_ORCHESTRATOR.bindCascadeToAgent = function(cascadePanel, agent) {
  cascadePanel.setAttribute('data-agent-bound', agent.id);
  agent.cascadeInstance = cascadePanel;
  
  const stateEntry = this.stateMap.get(agent.id);
  stateEntry.cascadeTab = cascadePanel;
  
  // Inject agent context into Cascade
  this.injectAgentContext(agent);
  
  agent.updateStatus('bound');
  console.log(`[AgentOS] Bound Cascade to agent: ${agent.id}`);
};
```

---

## Part 3: Atomic State Synchronization

### 3.1 State Map Structure

```javascript
// state-map.js
// Central state with atomic operations

AGENT_ORCHESTRATOR.initStateMap = function() {
  this.stateMap = new Map();
  
  // Persist to localStorage for recovery
  this.loadPersistedState();
  
  // Set up periodic sync
  this.syncInterval = setInterval(() => {
    this.persistState();
  }, 5000);
};

AGENT_ORCHESTRATOR.persistState = function() {
  const serializable = {};
  
  this.stateMap.forEach((value, key) => {
    serializable[key] = {
      id: key,
      config: value.agent?.config,
      status: value.agent?.status,
      tasks: value.tasks,
      results: value.results,
      context: value.agent?.context,
      createdAt: value.createdAt,
      lastSync: Date.now()
    };
  });
  
  localStorage.setItem('agentOS_state', JSON.stringify(serializable));
};

AGENT_ORCHESTRATOR.loadPersistedState = function() {
  try {
    const saved = localStorage.getItem('agentOS_state');
    if (saved) {
      const parsed = JSON.parse(saved);
      console.log(`[AgentOS] Recovered ${Object.keys(parsed).length} agents from state`);
      // Optionally restore agents
    }
  } catch (e) {
    console.warn('[AgentOS] Could not load persisted state:', e);
  }
};
```

### 3.2 Atomic Operations

```javascript
// atomic-ops.js
// Thread-safe(ish) state updates

AGENT_ORCHESTRATOR.atomicUpdate = function(agentId, updateFn) {
  const state = this.stateMap.get(agentId);
  if (!state) {
    throw new Error(`Agent ${agentId} not found`);
  }
  
  // Create transaction
  const transaction = {
    timestamp: Date.now(),
    agentId: agentId,
    previousState: JSON.parse(JSON.stringify(state)),
    applied: false
  };
  
  try {
    // Apply update
    updateFn(state);
    
    // Sync to DOM
    state.agent?.syncState();
    
    transaction.applied = true;
    
    // Log transaction for debugging
    this.transactionLog.push(transaction);
    
    return true;
  } catch (e) {
    // Rollback
    this.stateMap.set(agentId, transaction.previousState);
    console.error(`[AgentOS] Transaction failed for ${agentId}:`, e);
    return false;
  }
};

// Usage example
AGENT_ORCHESTRATOR.assignTask = function(agentId, task) {
  return this.atomicUpdate(agentId, (state) => {
    state.tasks.push({
      id: this.generateTaskId(),
      ...task,
      assignedAt: Date.now(),
      status: 'pending'
    });
    state.agent.updateStatus('working');
  });
};
```

---

## Part 4: DOM ↔ Agent Inspection Bridge

### 4.1 DevTools Inspection Support

```javascript
// inspection-bridge.js
// Makes agents inspectable via DevTools Elements panel

AGENT_ORCHESTRATOR.enableInspection = function() {
  // Custom element for better DevTools display
  if (!customElements.get('agent-node')) {
    customElements.define('agent-node', class extends HTMLElement {
      connectedCallback() {
        // Makes the element visible in DevTools with meaningful info
      }
      
      // Getter for DevTools properties panel
      get agentState() {
        return JSON.parse(this.getAttribute('data-state') || '{}');
      }
      
      get agentStatus() {
        return this.getAttribute('data-status');
      }
    });
  }
};

// Console helpers for inspection
AGENT_ORCHESTRATOR.inspect = function(agentId) {
  const agent = this.agents.get(agentId);
  if (!agent) {
    console.error(`Agent ${agentId} not found`);
    return null;
  }
  
  console.group(`🤖 Agent: ${agentId}`);
  console.log('Status:', agent.status);
  console.log('Config:', agent.config);
  console.log('Context:', agent.context);
  console.log('Task Queue:', agent.taskQueue);
  console.log('DOM Node:', agent.domNode);
  console.groupEnd();
  
  return agent;
};

// List all agents
AGENT_ORCHESTRATOR.list = function() {
  console.table(
    Array.from(this.agents.entries()).map(([id, agent]) => ({
      id,
      status: agent.status,
      type: agent.config.type,
      tasks: agent.taskQueue.length
    }))
  );
};
```

### 4.2 Visual Agent Panel

```javascript
// agent-panel-ui.js
// Toggleable visual interface

AGENT_ORCHESTRATOR.injectStyles = function() {
  const style = document.createElement('style');
  style.textContent = `
    #agent-panel .agent-panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 12px;
      background: #2d2d2d;
      border-bottom: 1px solid #3c3c3c;
      border-radius: 8px 8px 0 0;
    }
    
    #agent-panel .agent-panel-body {
      max-height: 280px;
      overflow-y: auto;
      padding: 8px;
    }
    
    #agent-panel .agent-card {
      background: #252525;
      border: 1px solid #3c3c3c;
      border-radius: 4px;
      padding: 8px;
      margin-bottom: 8px;
    }
    
    #agent-panel .agent-card[data-status="working"] {
      border-color: #4fc3f7;
    }
    
    #agent-panel .agent-card[data-status="ready"] {
      border-color: #81c784;
    }
    
    #agent-panel .agent-card[data-status="error"] {
      border-color: #e57373;
    }
    
    #agent-panel .agent-card-header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 4px;
    }
    
    #agent-panel .agent-card-actions {
      display: flex;
      gap: 4px;
      margin-top: 8px;
    }
    
    #agent-panel .agent-card-actions button {
      flex: 1;
      padding: 4px 8px;
      background: #3c3c3c;
      border: none;
      border-radius: 3px;
      color: #ccc;
      cursor: pointer;
      font-size: 11px;
    }
    
    #agent-panel .agent-card-actions button:hover {
      background: #4c4c4c;
    }
    
    #agent-panel .agent-panel-footer {
      display: flex;
      gap: 8px;
      padding: 8px 12px;
      border-top: 1px solid #3c3c3c;
    }
    
    #agent-panel .agent-panel-footer button {
      flex: 1;
      padding: 6px 12px;
      background: #0e639c;
      border: none;
      border-radius: 4px;
      color: white;
      cursor: pointer;
    }
    
    .status-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      margin-right: 6px;
    }
    
    .status-dot.ready { background: #81c784; }
    .status-dot.working { background: #4fc3f7; animation: pulse 1s infinite; }
    .status-dot.error { background: #e57373; }
    .status-dot.idle { background: #9e9e9e; }
    
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
  `;
  document.head.appendChild(style);
};

AGENT_ORCHESTRATOR.renderAgentList = function() {
  const container = document.getElementById('agent-list');
  if (!container) return;
  
  container.innerHTML = Array.from(this.agents.entries()).map(([id, agent]) => `
    <div class="agent-card" data-status="${agent.status}">
      <div class="agent-card-header">
        <span>
          <span class="status-dot ${agent.status}"></span>
          ${agent.config.name}
        </span>
        <span style="color: #888; font-size: 10px;">${id}</span>
      </div>
      <div style="color: #888; font-size: 11px;">
        Type: ${agent.config.type} | Tasks: ${agent.taskQueue.length}
      </div>
      <div class="agent-card-actions">
        <button onclick="AgentOS.inspect('${id}')">Inspect</button>
        <button onclick="AgentOS.focusAgent('${id}')">Focus</button>
        <button onclick="AgentOS.destroyAgent('${id}')" style="background:#5c2626;">Kill</button>
      </div>
    </div>
  `).join('') || '<div style="color:#888;text-align:center;padding:20px;">No agents running</div>';
};

AGENT_ORCHESTRATOR.toggleAgentPanel = function() {
  const panel = this.agentPanel;
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  if (panel.style.display === 'block') {
    this.renderAgentList();
  }
};
```

---

## Part 5: Context Injection (Replacing MCP)

### 5.1 Rule-Based Context Loading

Since MCP is disabled, we inject context through Cascade's text input:

```javascript
// context-injection.js
// Programmatically inject context into Cascade

AGENT_ORCHESTRATOR.injectAgentContext = function(agent) {
  const contextPrompt = this.buildContextPrompt(agent);
  
  // Find Cascade input
  const cascadeInput = agent.cascadeInstance?.querySelector('[data-cascade-input]') 
    || agent.cascadeInstance?.querySelector('textarea');
  
  if (cascadeInput) {
    // Programmatically set input value
    cascadeInput.value = contextPrompt;
    
    // Dispatch input event to trigger Cascade's handlers
    cascadeInput.dispatchEvent(new Event('input', { bubbles: true }));
    
    // Optionally auto-submit
    // this.submitCascadeInput(cascadeInput);
  }
};

AGENT_ORCHESTRATOR.buildContextPrompt = function(agent) {
  return `
# Agent Context Initialization

You are operating as Agent ${agent.id} (${agent.config.name}) in a multi-agent system.

## Your Role
Type: ${agent.config.type}
Specialization: ${agent.config.specialization || 'General purpose'}

## Current Task
${agent.taskQueue[0] ? JSON.stringify(agent.taskQueue[0], null, 2) : 'Awaiting task assignment'}

## Coordination Rules
- Report task completion by including [TASK_COMPLETE] in your response
- Report errors by including [TASK_ERROR: reason] in your response  
- Request human input by including [NEEDS_INPUT: question]
- Hand off to another agent by including [HANDOFF: agent-type, context]

## Shared Context
${JSON.stringify(agent.context, null, 2)}

Acknowledge this context and await further instructions.
`.trim();
};
```

### 5.2 Output Parsing for Agent Communication

```javascript
// output-parser.js
// Parse Cascade output for agent signals

AGENT_ORCHESTRATOR.watchCascadeOutput = function(agent) {
  const cascadePanel = agent.cascadeInstance;
  if (!cascadePanel) return;
  
  // Set up mutation observer for Cascade output
  const outputContainer = cascadePanel.querySelector('[data-cascade-output]')
    || cascadePanel.querySelector('.cascade-messages');
  
  if (outputContainer) {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.addedNodes.length) {
          mutation.addedNodes.forEach((node) => {
            if (node.textContent) {
              this.parseAgentOutput(agent, node.textContent);
            }
          });
        }
      });
    });
    
    observer.observe(outputContainer, { childList: true, subtree: true });
    agent.outputObserver = observer;
  }
};

AGENT_ORCHESTRATOR.parseAgentOutput = function(agent, output) {
  // Check for completion signal
  if (output.includes('[TASK_COMPLETE]')) {
    this.handleTaskComplete(agent, output);
  }
  
  // Check for error signal
  const errorMatch = output.match(/\[TASK_ERROR:\s*(.+?)\]/);
  if (errorMatch) {
    this.handleTaskError(agent, errorMatch[1]);
  }
  
  // Check for handoff signal
  const handoffMatch = output.match(/\[HANDOFF:\s*(.+?),\s*(.+?)\]/);
  if (handoffMatch) {
    this.handleHandoff(agent, handoffMatch[1], handoffMatch[2]);
  }
  
  // Check for input request
  const inputMatch = output.match(/\[NEEDS_INPUT:\s*(.+?)\]/);
  if (inputMatch) {
    this.handleInputRequest(agent, inputMatch[1]);
  }
};

AGENT_ORCHESTRATOR.handleTaskComplete = function(agent, output) {
  console.log(`[AgentOS] Agent ${agent.id} completed task`);
  
  this.atomicUpdate(agent.id, (state) => {
    const completedTask = state.tasks.shift();
    if (completedTask) {
      state.results.push({
        task: completedTask,
        output: output,
        completedAt: Date.now()
      });
    }
  });
  
  agent.updateStatus(agent.taskQueue.length > 0 ? 'working' : 'idle');
  
  // Process next task if queued
  if (agent.taskQueue.length > 0) {
    this.processNextTask(agent);
  }
};

AGENT_ORCHESTRATOR.handleHandoff = function(agent, targetType, context) {
  console.log(`[AgentOS] Handoff from ${agent.id} to ${targetType}`);
  
  // Find or spawn agent of target type
  let targetAgent = Array.from(this.agents.values())
    .find(a => a.config.type === targetType && a.status === 'idle');
  
  if (!targetAgent) {
    targetAgent = this.spawnAgent({ type: targetType, name: `${targetType}-auto` });
  }
  
  // Transfer context and assign task
  this.assignTask(targetAgent.id, {
    type: 'handoff',
    from: agent.id,
    context: context
  });
};
```

---

## Part 6: Integration with Existing Workspace Structure

### 6.1 Loader Script

Create a file in your workspace that auto-loads the infrastructure:

```javascript
// .windsurf/injector/loader.js
// Paste this into DevTools console to initialize

(async function loadAgentOS() {
  const modules = [
    'injector-bootstrap.js',
    'dom-registry.js', 
    'agent-node.js',
    'agent-spawner.js',
    'cascade-binding.js',
    'state-map.js',
    'atomic-ops.js',
    'inspection-bridge.js',
    'agent-panel-ui.js',
    'context-injection.js',
    'output-parser.js'
  ];
  
  // For local development, load from workspace
  // In production, inline everything
  
  console.log('[AgentOS] Loading modules...');
  
  // If modules are in workspace:
  // for (const mod of modules) {
  //   await import(`/path/to/workspace/.windsurf/injector/${mod}`);
  // }
  
  // Or use inline version (compile all above into single file)
  
  console.log('[AgentOS] Ready. Press Cmd+Shift+I to spawn agent, Cmd+Shift+K for panel.');
})();
```

### 6.2 Combined Single-File Version

For easy injection, combine everything into one file:

```javascript
// agentOS-bundle.js
// Single file version - paste entire contents into DevTools console

(function() {
  'use strict';
  
  // [All the code from above sections combined here]
  
  // Initialize
  window.AgentOS = AGENT_ORCHESTRATOR;
  window.AgentOS.init();
  
  // Console API
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                     🤖 AgentOS Loaded                          ║
╠═══════════════════════════════════════════════════════════════╣
║  Cmd+Shift+I  →  Spawn new agent                              ║
║  Cmd+Shift+K  →  Toggle agent panel                           ║
║                                                                ║
║  Console Commands:                                             ║
║    AgentOS.list()           - List all agents                 ║
║    AgentOS.inspect(id)      - Inspect specific agent          ║
║    AgentOS.spawnAgent({})   - Spawn with config               ║
║    AgentOS.assignTask(id,t) - Assign task to agent            ║
║    AgentOS.destroyAgent(id) - Kill agent                      ║
╚═══════════════════════════════════════════════════════════════╝
  `);
})();
```

---

## Part 7: Syncing with Your Existing Rules

Your `.windsurf/rules/` still work! The rules load into Cascade normally. Add these integration rules:

### `.windsurf/rules/05-agent-signals.md` (Always On)

```markdown
# Agent Communication Protocol

When operating as part of the AgentOS system, use these signals:

## Completion Signals
- `[TASK_COMPLETE]` - Task finished successfully
- `[TASK_COMPLETE: summary]` - With summary

## Error Signals  
- `[TASK_ERROR: description]` - Task failed

## Coordination Signals
- `[HANDOFF: agent-type, context]` - Transfer to another agent
- `[NEEDS_INPUT: question]` - Requires human decision
- `[SUBTASK: description]` - Spawn subtask

## Context Markers
- `[CONTEXT_SAVE: key=value]` - Save to shared context
- `[CONTEXT_LOAD: key]` - Request context value

Always wrap signal in square brackets. Include relevant data after colon.
```

---

## Summary

| Component | Implementation | Status |
|-----------|---------------|--------|
| Agent Spawning | Cmd+Shift+I → DevTools injection | ✅ |
| DOM Registry | Custom `<agent-node>` elements | ✅ |
| State Map | In-memory + localStorage persistence | ✅ |
| Cascade Binding | DOM query + programmatic input | ✅ |
| Context Injection | Text prompt injection (replaces MCP) | ✅ |
| Agent Communication | Output parsing for signals | ✅ |
| Visual Panel | Toggleable overlay (Cmd+Shift+K) | ✅ |
| Inspection | DevTools Elements + Console API | ✅ |

This gives you full multi-agent orchestration without Skills or MCP, running entirely through debug port injection.

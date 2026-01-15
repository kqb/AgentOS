/**
 * AgentOS - Multi-Agent Orchestration System
 * Load via DevTools Console (Cmd+Option+I -> Console -> Paste)
 *
 * Provides multi-agent coordination via Chrome DevTools Protocol
 *
 * Shortcuts:
 *   Cmd+Shift+I  ->  Spawn new agent
 *   Cmd+Shift+K  ->  Toggle agent panel
 *   Cmd+Shift+L  ->  List agents (console)
 */

(function() {
  'use strict';

  // Prevent double initialization
  if (window.AgentOS) {
    console.warn('[AgentOS] Already initialized');
    return;
  }

  // ==========================================================================
  // CORE ORCHESTRATOR
  // ==========================================================================

  const AgentOS = {
    version: '1.0.0',
    agents: new Map(),
    stateMap: new Map(),
    transactionLog: [],
    pendingBindings: [],
    domRegistry: null,
    agentPanel: null,
    syncInterval: null,

    // ------------------------------------------------------------------------
    // INITIALIZATION
    // ------------------------------------------------------------------------

    init() {
      this.createDOMRegistry();
      this.initStateMap();
      this.bindKeyboardShortcuts();
      this.injectStyles();
      this.enableInspection();
      this.loadPersistedState();

      console.log('[AgentOS] Infrastructure initialized v' + this.version);
      this.printHelp();
    },

    printHelp() {
      console.log(`
%c+===============================================================+
|                     AgentOS Loaded                            |
+===============================================================+
|  %cCmd+Shift+I%c  ->  Spawn new agent                              |
|  %cCmd+Shift+K%c  ->  Toggle agent panel                           |
|  %cCmd+Shift+L%c  ->  List agents (console)                        |
+===============================================================+
|  Console Commands:                                             |
|    AgentOS.list()              - List all agents               |
|    AgentOS.inspect(id)         - Inspect agent                 |
|    AgentOS.spawnAgent({})      - Spawn with config             |
|    AgentOS.assignTask(id, t)   - Assign task                   |
|    AgentOS.destroyAgent(id)    - Kill agent                    |
|    AgentOS.exportState()       - Export state JSON             |
+===============================================================+`,
        'color: #4fc3f7; font-family: monospace;',
        'color: #81c784; font-weight: bold;', 'color: #4fc3f7;',
        'color: #81c784; font-weight: bold;', 'color: #4fc3f7;',
        'color: #81c784; font-weight: bold;', 'color: #4fc3f7;'
      );
    },

    // ------------------------------------------------------------------------
    // KEYBOARD SHORTCUTS
    // ------------------------------------------------------------------------

    bindKeyboardShortcuts() {
      document.addEventListener('keydown', (e) => {
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        const modifier = isMac ? e.metaKey : e.ctrlKey;

        if (modifier && e.shiftKey) {
          switch(e.key.toUpperCase()) {
            case 'I':
              e.preventDefault();
              e.stopPropagation();
              this.spawnAgent();
              break;
            case 'K':
              e.preventDefault();
              e.stopPropagation();
              this.toggleAgentPanel();
              break;
            case 'L':
              e.preventDefault();
              e.stopPropagation();
              this.list();
              break;
          }
        }
      }, true);
    },

    // ------------------------------------------------------------------------
    // DOM REGISTRY
    // ------------------------------------------------------------------------

    createDOMRegistry() {
      // Hidden container for agent nodes (inspectable via DevTools)
      const registry = document.createElement('div');
      registry.id = 'agent-os-registry';
      registry.setAttribute('data-agent-os-version', this.version);
      registry.style.cssText = `
        position: fixed;
        top: 0; left: 0;
        width: 0; height: 0;
        overflow: hidden;
        pointer-events: none;
        z-index: -1;
      `;
      document.body.appendChild(registry);
      this.domRegistry = registry;

      // Visible panel
      this.createAgentPanel();
    },

    createAgentPanel() {
      const panel = document.createElement('div');
      panel.id = 'agent-os-panel';
      panel.innerHTML = `
        <div class="aos-header">
          <span>AgentOS</span>
          <div>
            <span class="aos-agent-count">0 agents</span>
            <button class="aos-btn-close" onclick="AgentOS.toggleAgentPanel()">x</button>
          </div>
        </div>
        <div class="aos-body" id="aos-agent-list"></div>
        <div class="aos-footer">
          <button onclick="AgentOS.spawnAgent()">+ New Agent</button>
          <button onclick="AgentOS.syncAll()">Sync All</button>
        </div>
      `;
      panel.style.display = 'none';
      document.body.appendChild(panel);
      this.agentPanel = panel;
    },

    toggleAgentPanel() {
      const panel = this.agentPanel;
      const isHidden = panel.style.display === 'none';
      panel.style.display = isHidden ? 'flex' : 'none';
      if (isHidden) {
        this.renderAgentList();
      }
    },

    // ------------------------------------------------------------------------
    // AGENT NODE CLASS
    // ------------------------------------------------------------------------

    AgentNode: class {
      constructor(id, config) {
        this.id = id;
        this.config = config;
        this.status = 'initializing';
        this.cascadeInstance = null;
        this.taskQueue = [];
        this.context = config.context || {};
        this.results = [];
        this.createdAt = Date.now();
        this.lastActivity = Date.now();
        this.domNode = this._createDOMNode();
      }

      _createDOMNode() {
        const node = document.createElement('agent-node');
        node.id = `aos-agent-${this.id}`;
        node.setAttribute('data-agent-id', this.id);
        node.setAttribute('data-status', this.status);
        node.setAttribute('data-type', this.config.type || 'general');
        node.setAttribute('data-created', new Date(this.createdAt).toISOString());
        this._syncDOMState(node);
        AgentOS.domRegistry.appendChild(node);
        return node;
      }

      _syncDOMState(node = this.domNode) {
        node.setAttribute('data-state', JSON.stringify({
          id: this.id,
          config: this.config,
          status: this.status,
          taskQueue: this.taskQueue,
          context: this.context,
          results: this.results.length,
          lastActivity: this.lastActivity
        }));
      }

      updateStatus(newStatus) {
        this.status = newStatus;
        this.lastActivity = Date.now();
        this.domNode.setAttribute('data-status', newStatus);
        this._syncDOMState();
        AgentOS.renderAgentList();
      }

      addTask(task) {
        this.taskQueue.push({
          id: AgentOS.generateId('task'),
          ...task,
          addedAt: Date.now(),
          status: 'pending'
        });
        this._syncDOMState();
      }

      completeTask(output) {
        const task = this.taskQueue.shift();
        if (task) {
          this.results.push({
            task,
            output,
            completedAt: Date.now()
          });
        }
        this.lastActivity = Date.now();
        this._syncDOMState();
      }

      destroy() {
        if (this.outputObserver) {
          this.outputObserver.disconnect();
        }
        this.domNode.remove();
      }

      toJSON() {
        return {
          id: this.id,
          config: this.config,
          status: this.status,
          taskQueue: this.taskQueue,
          context: this.context,
          resultsCount: this.results.length,
          createdAt: this.createdAt,
          lastActivity: this.lastActivity
        };
      }
    },

    // ------------------------------------------------------------------------
    // AGENT LIFECYCLE
    // ------------------------------------------------------------------------

    spawnAgent(config = {}) {
      const id = this.generateId('agent');

      const fullConfig = {
        type: 'general',
        name: `Agent-${id.slice(0, 6)}`,
        autoStart: true,
        specialization: null,
        ...config
      };

      const agent = new this.AgentNode(id, fullConfig);
      this.agents.set(id, agent);

      this.stateMap.set(id, {
        agent,
        cascadeTab: null,
        boundAt: null
      });

      agent.updateStatus('ready');

      this.showNotification(`Agent ${fullConfig.name} spawned`, 'success');
      console.log(`[AgentOS] Spawned: ${id} (${fullConfig.type})`);

      // Try to bind to Cascade
      if (fullConfig.autoStart) {
        this.attemptCascadeBinding(agent);
      }

      this.persistState();
      return agent;
    },

    destroyAgent(agentId) {
      const agent = this.agents.get(agentId);
      if (!agent) {
        console.error(`[AgentOS] Agent ${agentId} not found`);
        return false;
      }

      agent.destroy();
      this.agents.delete(agentId);
      this.stateMap.delete(agentId);

      this.renderAgentList();
      this.persistState();

      this.showNotification(`Agent ${agent.config.name} terminated`, 'info');
      console.log(`[AgentOS] Destroyed: ${agentId}`);
      return true;
    },

    // ------------------------------------------------------------------------
    // CASCADE BINDING
    // ------------------------------------------------------------------------

    attemptCascadeBinding(agent) {
      // Look for Cascade panels - adjust selectors based on actual Windsurf DOM
      const cascadeSelectors = [
        '[data-testid="cascade-panel"]',
        '.cascade-container',
        '[class*="cascade"]',
        '.chat-panel'
      ];

      let cascadePanel = null;
      for (const selector of cascadeSelectors) {
        const panels = document.querySelectorAll(selector);
        cascadePanel = Array.from(panels).find(p =>
          !p.hasAttribute('data-aos-bound')
        );
        if (cascadePanel) break;
      }

      if (cascadePanel) {
        this.bindCascadeToAgent(cascadePanel, agent);
      } else {
        this.pendingBindings.push(agent);
        this.showNotification(
          `Open new Cascade to bind ${agent.config.name}`,
          'warning'
        );
      }
    },

    bindCascadeToAgent(panel, agent) {
      panel.setAttribute('data-aos-bound', agent.id);
      agent.cascadeInstance = panel;

      const state = this.stateMap.get(agent.id);
      if (state) {
        state.cascadeTab = panel;
        state.boundAt = Date.now();
      }

      this.watchCascadeOutput(agent);
      agent.updateStatus('bound');

      console.log(`[AgentOS] Bound Cascade to ${agent.id}`);
    },

    // ------------------------------------------------------------------------
    // CASCADE OUTPUT WATCHING
    // ------------------------------------------------------------------------

    watchCascadeOutput(agent) {
      const panel = agent.cascadeInstance;
      if (!panel) return;

      // Find message container - adjust based on actual Windsurf DOM
      const outputSelectors = [
        '[data-testid="cascade-messages"]',
        '.cascade-messages',
        '.chat-messages',
        '[class*="message-list"]'
      ];

      let outputContainer = null;
      for (const selector of outputSelectors) {
        outputContainer = panel.querySelector(selector);
        if (outputContainer) break;
      }

      if (outputContainer) {
        const observer = new MutationObserver((mutations) => {
          mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
              if (node.textContent) {
                this.parseAgentOutput(agent, node.textContent);
              }
            });
          });
        });

        observer.observe(outputContainer, { childList: true, subtree: true });
        agent.outputObserver = observer;
      }
    },

    parseAgentOutput(agent, output) {
      // Task completion
      if (output.includes('[TASK_COMPLETE]')) {
        agent.completeTask(output);
        agent.updateStatus(agent.taskQueue.length > 0 ? 'working' : 'idle');
        this.showNotification(`${agent.config.name} completed task`, 'success');
      }

      // Error
      const errorMatch = output.match(/\[TASK_ERROR:\s*(.+?)\]/);
      if (errorMatch) {
        agent.updateStatus('error');
        this.showNotification(`${agent.config.name} error: ${errorMatch[1]}`, 'error');
      }

      // Handoff
      const handoffMatch = output.match(/\[HANDOFF:\s*(\w+),\s*(.+?)\]/);
      if (handoffMatch) {
        this.handleHandoff(agent, handoffMatch[1], handoffMatch[2]);
      }

      // Context save
      const contextMatch = output.match(/\[CONTEXT_SAVE:\s*(\w+)=(.+?)\]/g);
      if (contextMatch) {
        contextMatch.forEach(match => {
          const [, key, value] = match.match(/\[CONTEXT_SAVE:\s*(\w+)=(.+?)\]/);
          agent.context[key] = value;
          agent._syncDOMState();
        });
      }
    },

    handleHandoff(fromAgent, targetType, context) {
      console.log(`[AgentOS] Handoff: ${fromAgent.id} -> ${targetType}`);

      // Find idle agent of target type or spawn new
      let targetAgent = Array.from(this.agents.values())
        .find(a => a.config.type === targetType && a.status === 'idle');

      if (!targetAgent) {
        targetAgent = this.spawnAgent({
          type: targetType,
          name: `${targetType}-${this.generateId('auto').slice(0,4)}`,
          context: { handoffFrom: fromAgent.id, handoffContext: context }
        });
      }

      targetAgent.addTask({
        type: 'handoff',
        from: fromAgent.id,
        context
      });

      targetAgent.updateStatus('working');
    },

    // ------------------------------------------------------------------------
    // TASK MANAGEMENT
    // ------------------------------------------------------------------------

    assignTask(agentId, task) {
      const agent = this.agents.get(agentId);
      if (!agent) {
        console.error(`[AgentOS] Agent ${agentId} not found`);
        return false;
      }

      agent.addTask(task);
      agent.updateStatus('working');

      // Inject task into Cascade if bound
      if (agent.cascadeInstance) {
        this.injectTaskPrompt(agent, task);
      }

      this.persistState();
      return true;
    },

    injectTaskPrompt(agent, task) {
      const inputSelectors = [
        '[data-testid="cascade-input"]',
        '.cascade-input textarea',
        'textarea[placeholder*="message"]',
        'textarea'
      ];

      let input = null;
      for (const selector of inputSelectors) {
        input = agent.cascadeInstance.querySelector(selector);
        if (input) break;
      }

      if (input) {
        const prompt = this.buildTaskPrompt(agent, task);

        // Set value and trigger input event
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value'
        ).set;
        nativeInputValueSetter.call(input, prompt);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    },

    buildTaskPrompt(agent, task) {
      return `
## Task Assignment [${task.id || 'manual'}]

**Agent**: ${agent.id} (${agent.config.name})
**Task Type**: ${task.type || 'general'}

### Instructions
${task.instructions || task.description || JSON.stringify(task)}

### Completion Protocol
When done, include: \`[TASK_COMPLETE]\`
On error, include: \`[TASK_ERROR: description]\`
To save context: \`[CONTEXT_SAVE: key=value]\`
To handoff: \`[HANDOFF: agent-type, context]\`

Begin task execution.
`.trim();
    },

    // ------------------------------------------------------------------------
    // STATE PERSISTENCE
    // ------------------------------------------------------------------------

    initStateMap() {
      this.syncInterval = setInterval(() => {
        this.persistState();
      }, 10000);
    },

    persistState() {
      const state = {
        version: this.version,
        timestamp: Date.now(),
        agents: {}
      };

      this.agents.forEach((agent, id) => {
        state.agents[id] = agent.toJSON();
      });

      try {
        localStorage.setItem('agentOS_state', JSON.stringify(state));
      } catch (e) {
        console.warn('[AgentOS] Could not persist state:', e);
      }
    },

    loadPersistedState() {
      try {
        const saved = localStorage.getItem('agentOS_state');
        if (saved) {
          const state = JSON.parse(saved);
          const count = Object.keys(state.agents || {}).length;
          if (count > 0) {
            console.log(`[AgentOS] Found ${count} persisted agents (not auto-restoring)`);
            console.log('[AgentOS] Run AgentOS.restoreState() to restore');
          }
        }
      } catch (e) {
        console.warn('[AgentOS] Could not load state:', e);
      }
    },

    restoreState() {
      try {
        const saved = localStorage.getItem('agentOS_state');
        if (!saved) return;

        const state = JSON.parse(saved);
        Object.values(state.agents || {}).forEach(agentData => {
          this.spawnAgent({
            ...agentData.config,
            context: agentData.context
          });
        });
      } catch (e) {
        console.error('[AgentOS] Restore failed:', e);
      }
    },

    exportState() {
      const state = {
        exported: new Date().toISOString(),
        agents: Array.from(this.agents.values()).map(a => a.toJSON())
      };
      console.log(JSON.stringify(state, null, 2));
      return state;
    },

    // ------------------------------------------------------------------------
    // UI RENDERING
    // ------------------------------------------------------------------------

    renderAgentList() {
      const container = document.getElementById('aos-agent-list');
      if (!container) return;

      const countEl = this.agentPanel.querySelector('.aos-agent-count');
      if (countEl) {
        countEl.textContent = `${this.agents.size} agent${this.agents.size !== 1 ? 's' : ''}`;
      }

      if (this.agents.size === 0) {
        container.innerHTML = `
          <div class="aos-empty">
            No agents running<br>
            <small>Press Cmd+Shift+I to spawn</small>
          </div>
        `;
        return;
      }

      container.innerHTML = Array.from(this.agents.values()).map(agent => `
        <div class="aos-card" data-status="${agent.status}">
          <div class="aos-card-header">
            <span>
              <span class="aos-status-dot ${agent.status}"></span>
              ${agent.config.name}
            </span>
            <span class="aos-card-id">${agent.id.slice(0,8)}</span>
          </div>
          <div class="aos-card-meta">
            ${agent.config.type} | ${agent.taskQueue.length} tasks | ${agent.results.length} done
          </div>
          <div class="aos-card-actions">
            <button onclick="AgentOS.inspect('${agent.id}')">Inspect</button>
            <button onclick="AgentOS.focusAgent('${agent.id}')">Focus</button>
            <button onclick="AgentOS.destroyAgent('${agent.id}')" class="aos-btn-danger">Kill</button>
          </div>
        </div>
      `).join('');
    },

    // ------------------------------------------------------------------------
    // CONSOLE API
    // ------------------------------------------------------------------------

    list() {
      if (this.agents.size === 0) {
        console.log('[AgentOS] No agents running');
        return;
      }

      console.table(
        Array.from(this.agents.values()).map(a => ({
          ID: a.id,
          Name: a.config.name,
          Type: a.config.type,
          Status: a.status,
          Tasks: a.taskQueue.length,
          Results: a.results.length
        }))
      );
    },

    inspect(agentId) {
      const agent = this.agents.get(agentId);
      if (!agent) {
        console.error(`[AgentOS] Agent ${agentId} not found`);
        return null;
      }

      console.group(`Agent: ${agent.config.name} (${agentId})`);
      console.log('Status:', agent.status);
      console.log('Type:', agent.config.type);
      console.log('Config:', agent.config);
      console.log('Context:', agent.context);
      console.log('Task Queue:', agent.taskQueue);
      console.log('Results:', agent.results.length);
      console.log('DOM Node:', agent.domNode);
      console.log('Cascade Bound:', !!agent.cascadeInstance);
      console.groupEnd();

      return agent;
    },

    focusAgent(agentId) {
      const agent = this.agents.get(agentId);
      if (!agent?.cascadeInstance) {
        console.warn(`[AgentOS] Agent ${agentId} not bound to Cascade`);
        return;
      }

      agent.cascadeInstance.scrollIntoView({ behavior: 'smooth' });
      agent.cascadeInstance.style.outline = '2px solid #4fc3f7';
      setTimeout(() => {
        agent.cascadeInstance.style.outline = '';
      }, 2000);
    },

    syncAll() {
      this.agents.forEach(agent => {
        agent._syncDOMState();
      });
      this.persistState();
      this.renderAgentList();
      this.showNotification('All agents synced', 'success');
    },

    // ------------------------------------------------------------------------
    // UTILITIES
    // ------------------------------------------------------------------------

    generateId(prefix = 'id') {
      return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 5)}`;
    },

    showNotification(message, type = 'info') {
      const colors = {
        success: '#81c784',
        error: '#e57373',
        warning: '#ffb74d',
        info: '#4fc3f7'
      };

      const notif = document.createElement('div');
      notif.className = 'aos-notification';
      notif.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 12px 20px;
        background: #2d2d2d;
        border-left: 4px solid ${colors[type]};
        border-radius: 4px;
        color: #fff;
        font-family: system-ui;
        font-size: 13px;
        z-index: 999999;
        animation: aos-slide-in 0.3s ease;
      `;
      notif.textContent = message;
      document.body.appendChild(notif);

      setTimeout(() => {
        notif.style.animation = 'aos-slide-out 0.3s ease';
        setTimeout(() => notif.remove(), 300);
      }, 3000);
    },

    enableInspection() {
      if (!customElements.get('agent-node')) {
        customElements.define('agent-node', class extends HTMLElement {
          get state() {
            try {
              return JSON.parse(this.getAttribute('data-state') || '{}');
            } catch {
              return {};
            }
          }
        });
      }
    },

    // ------------------------------------------------------------------------
    // STYLES
    // ------------------------------------------------------------------------

    injectStyles() {
      const style = document.createElement('style');
      style.id = 'agent-os-styles';
      style.textContent = `
        @keyframes aos-slide-in {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes aos-slide-out {
          from { transform: translateX(0); opacity: 1; }
          to { transform: translateX(100%); opacity: 0; }
        }
        @keyframes aos-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        #agent-os-panel {
          position: fixed;
          bottom: 20px;
          right: 20px;
          width: 340px;
          max-height: 450px;
          background: #1e1e1e;
          border: 1px solid #3c3c3c;
          border-radius: 8px;
          font-family: system-ui, -apple-system, sans-serif;
          font-size: 12px;
          color: #e0e0e0;
          display: flex;
          flex-direction: column;
          z-index: 99999;
          box-shadow: 0 8px 32px rgba(0,0,0,0.4);
        }

        #agent-os-panel .aos-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 14px;
          background: #252525;
          border-bottom: 1px solid #3c3c3c;
          border-radius: 8px 8px 0 0;
          font-weight: 600;
        }

        #agent-os-panel .aos-header > div {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        #agent-os-panel .aos-agent-count {
          font-size: 10px;
          color: #888;
          background: #333;
          padding: 2px 8px;
          border-radius: 10px;
        }

        #agent-os-panel .aos-btn-close {
          background: none;
          border: none;
          color: #888;
          font-size: 18px;
          cursor: pointer;
          padding: 0 4px;
        }
        #agent-os-panel .aos-btn-close:hover { color: #fff; }

        #agent-os-panel .aos-body {
          flex: 1;
          overflow-y: auto;
          padding: 10px;
          max-height: 300px;
        }

        #agent-os-panel .aos-empty {
          text-align: center;
          color: #666;
          padding: 30px;
          line-height: 1.6;
        }
        #agent-os-panel .aos-empty small { color: #555; }

        #agent-os-panel .aos-card {
          background: #252525;
          border: 1px solid #3c3c3c;
          border-radius: 6px;
          padding: 10px 12px;
          margin-bottom: 8px;
        }
        #agent-os-panel .aos-card[data-status="working"] { border-color: #4fc3f7; }
        #agent-os-panel .aos-card[data-status="ready"] { border-color: #81c784; }
        #agent-os-panel .aos-card[data-status="bound"] { border-color: #81c784; }
        #agent-os-panel .aos-card[data-status="idle"] { border-color: #666; }
        #agent-os-panel .aos-card[data-status="error"] { border-color: #e57373; }

        #agent-os-panel .aos-card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 4px;
        }

        #agent-os-panel .aos-card-id {
          font-family: monospace;
          font-size: 10px;
          color: #666;
        }

        #agent-os-panel .aos-card-meta {
          font-size: 11px;
          color: #888;
          margin-bottom: 8px;
        }

        #agent-os-panel .aos-card-actions {
          display: flex;
          gap: 6px;
        }

        #agent-os-panel .aos-card-actions button {
          flex: 1;
          padding: 5px;
          background: #333;
          border: 1px solid #444;
          border-radius: 4px;
          color: #ccc;
          cursor: pointer;
          font-size: 12px;
        }
        #agent-os-panel .aos-card-actions button:hover {
          background: #444;
        }
        #agent-os-panel .aos-card-actions .aos-btn-danger:hover {
          background: #5c2626;
          border-color: #e57373;
        }

        #agent-os-panel .aos-status-dot {
          display: inline-block;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          margin-right: 6px;
        }
        #agent-os-panel .aos-status-dot.ready,
        #agent-os-panel .aos-status-dot.bound { background: #81c784; }
        #agent-os-panel .aos-status-dot.working {
          background: #4fc3f7;
          animation: aos-pulse 1s infinite;
        }
        #agent-os-panel .aos-status-dot.idle { background: #666; }
        #agent-os-panel .aos-status-dot.error { background: #e57373; }
        #agent-os-panel .aos-status-dot.initializing { background: #ffb74d; }

        #agent-os-panel .aos-footer {
          display: flex;
          gap: 8px;
          padding: 10px 14px;
          border-top: 1px solid #3c3c3c;
        }

        #agent-os-panel .aos-footer button {
          flex: 1;
          padding: 8px 12px;
          background: #0e639c;
          border: none;
          border-radius: 4px;
          color: white;
          cursor: pointer;
          font-size: 12px;
          font-weight: 500;
        }
        #agent-os-panel .aos-footer button:hover {
          background: #1177bb;
        }
      `;
      document.head.appendChild(style);
    }
  };

  // ==========================================================================
  // EXPOSE GLOBALLY & INITIALIZE
  // ==========================================================================

  window.AgentOS = AgentOS;
  AgentOS.init();

})();

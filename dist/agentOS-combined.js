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
/**
 * Workflow Orchestration Engine
 * Inject AFTER agentOS-bundle.js
 *
 * Provides:
 * - Event-driven state machine
 * - Hook system for reactions
 * - Polling infrastructure for external systems
 * - Workflow persistence
 *
 * Commands:
 *   /implement-work-item ABC-123  - Start full SDLC workflow
 *   /workflow-status              - List active workflows
 *   /poll-status                  - List active polling tasks
 */

(function() {
  'use strict';

  // Ensure AgentOS is loaded
  if (!window.AgentOS) {
    console.error('[WorkflowEngine] AgentOS must be loaded first!');
    return;
  }

  // ==========================================================================
  // EVENT BUS
  // ==========================================================================

  const EventBus = {
    listeners: new Map(),
    queue: [],
    processing: false,

    on(event, callback, options = {}) {
      if (!this.listeners.has(event)) {
        this.listeners.set(event, []);
      }

      const listener = {
        callback,
        once: options.once || false,
        filter: options.filter || null,
        priority: options.priority || 0
      };

      const listeners = this.listeners.get(event);
      listeners.push(listener);
      listeners.sort((a, b) => b.priority - a.priority);

      return () => {
        const idx = listeners.indexOf(listener);
        if (idx > -1) listeners.splice(idx, 1);
      };
    },

    once(event, callback, options = {}) {
      return this.on(event, callback, { ...options, once: true });
    },

    emit(event, payload) {
      this.queue.push({ event, payload, timestamp: Date.now() });
      if (!this.processing) this.processQueue();
    },

    async processQueue() {
      if (this.processing) return;
      this.processing = true;

      while (this.queue.length > 0) {
        const { event, payload } = this.queue.shift();
        const listeners = this.listeners.get(event) || [];

        for (const listener of [...listeners]) {
          if (listener.filter && !listener.filter(payload)) continue;

          try {
            await listener.callback(payload);
          } catch (e) {
            console.error(`[EventBus] Error in ${event}:`, e);
          }

          if (listener.once) {
            const idx = listeners.indexOf(listener);
            if (idx > -1) listeners.splice(idx, 1);
          }
        }
      }

      this.processing = false;
    }
  };

  // ==========================================================================
  // POLL MANAGER
  // ==========================================================================

  const PollManager = {
    activePolls: new Map(),

    start(pollId, config) {
      const {
        source, endpoint, interval, workflowId,
        timeout, successCondition, params
      } = config;

      if (this.activePolls.has(pollId)) {
        console.warn(`[Poll] ${pollId} already active`);
        return pollId;
      }

      const poll = {
        id: pollId,
        source,
        endpoint,
        interval,
        workflowId,
        params: params || {},
        startTime: Date.now(),
        timeout,
        successCondition,
        lastResult: null,
        pollCount: 0,
        intervalId: null
      };

      poll.intervalId = setInterval(() => this.executePoll(poll), interval);
      this.executePoll(poll); // Immediate first poll

      this.activePolls.set(pollId, poll);
      console.log(`[Poll] Started ${pollId} (every ${interval}ms)`);

      return pollId;
    },

    async executePoll(poll) {
      poll.pollCount++;

      try {
        // Simulate external fetch - in real impl, call ExternalIntegrations
        const result = await this.simulateFetch(poll.source, poll.endpoint, poll.params);
        const changed = JSON.stringify(result) !== JSON.stringify(poll.lastResult);

        poll.lastResult = result;

        EventBus.emit('poll:result', {
          pollId: poll.id,
          source: poll.source,
          data: result,
          changed,
          workflowId: poll.workflowId,
          pollCount: poll.pollCount
        });

        if (poll.successCondition && poll.successCondition(result)) {
          console.log(`[Poll] ${poll.id} success condition met`);
          this.stop(poll.id);
        }

        if (poll.timeout && (Date.now() - poll.startTime) > poll.timeout) {
          console.warn(`[Poll] ${poll.id} timed out`);
          EventBus.emit('poll:timeout', {
            pollId: poll.id,
            duration: Date.now() - poll.startTime,
            workflowId: poll.workflowId
          });
          this.stop(poll.id);
        }

      } catch (error) {
        console.error(`[Poll] ${poll.id} error:`, error);
        EventBus.emit('poll:error', { pollId: poll.id, error, workflowId: poll.workflowId });
      }
    },

    // Simulated fetch - replace with real ExternalIntegrations calls
    async simulateFetch(source, endpoint, params) {
      // In production, this would call actual APIs
      // For now, return mock data that can be manually updated
      const mockData = JSON.parse(localStorage.getItem(`mock_${source}_${endpoint}`) || '{}');
      return mockData;
    },

    stop(pollId) {
      const poll = this.activePolls.get(pollId);
      if (poll) {
        clearInterval(poll.intervalId);
        this.activePolls.delete(pollId);
        console.log(`[Poll] Stopped ${pollId}`);
      }
    },

    stopAll(workflowId) {
      this.activePolls.forEach((poll, pollId) => {
        if (!workflowId || poll.workflowId === workflowId) {
          this.stop(pollId);
        }
      });
    },

    status() {
      return Array.from(this.activePolls.values()).map(p => ({
        id: p.id,
        source: p.source,
        endpoint: p.endpoint,
        workflowId: p.workflowId,
        pollCount: p.pollCount,
        runningMs: Date.now() - p.startTime
      }));
    },

    // Helper to set mock data for testing
    setMockData(source, endpoint, data) {
      localStorage.setItem(`mock_${source}_${endpoint}`, JSON.stringify(data));
      console.log(`[Poll] Set mock data for ${source}:${endpoint}`);
    }
  };

  // ==========================================================================
  // WORKFLOW STATES
  // ==========================================================================

  const WORKFLOW_STATES = {
    // Initialization
    INIT: {
      name: 'init',
      next: ['JIRA_FETCHED', 'ERROR'],
      timeout: 30000,
      agent: null,
      action: 'fetchJiraItem'
    },
    JIRA_FETCHED: {
      name: 'jira_fetched',
      next: ['GH_ISSUE_CREATED', 'ERROR'],
      timeout: 30000,
      agent: null,
      action: 'createGitHubIssue'
    },
    GH_ISSUE_CREATED: {
      name: 'gh_issue_created',
      next: ['LINKED', 'ERROR'],
      timeout: 15000,
      agent: null,
      action: 'linkJiraGitHub'
    },
    LINKED: {
      name: 'linked',
      next: ['TASKS_ASSIGNED', 'ERROR'],
      timeout: 300000,
      agent: 'team-lead',
      action: 'breakdownAndAssign'
    },
    TASKS_ASSIGNED: {
      name: 'tasks_assigned',
      next: ['IMPLEMENTING'],
      agent: null,
      action: 'notifyAgents'
    },

    // Implementation
    IMPLEMENTING: {
      name: 'implementing',
      next: ['TESTS_WRITTEN', 'IMPLEMENTATION_FAILED'],
      timeout: 1800000,
      agent: 'swe-pool',
      action: 'implementFeature',
      parallel: true
    },
    IMPLEMENTATION_FAILED: {
      name: 'implementation_failed',
      next: ['IMPLEMENTING', 'ERROR'],
      timeout: 300000,
      agent: 'debugger',
      action: 'diagnoseAndFix',
      maxRetries: 3
    },
    TESTS_WRITTEN: {
      name: 'tests_written',
      next: ['TESTS_RUNNING'],
      agent: null,
      action: 'runTests'
    },
    TESTS_RUNNING: {
      name: 'tests_running',
      next: ['TESTS_PASSED', 'TESTS_FAILED'],
      timeout: 600000,
      agent: null,
      action: 'awaitTestResults',
      poll: { interval: 10000, source: 'terminal', endpoint: 'test_status' }
    },
    TESTS_FAILED: {
      name: 'tests_failed',
      next: ['TESTS_RUNNING', 'ERROR'],
      timeout: 300000,
      agent: 'swe-pool',
      action: 'fixFailingTests',
      maxRetries: 3
    },
    TESTS_PASSED: {
      name: 'tests_passed',
      next: ['IN_REVIEW'],
      agent: 'team-lead',
      action: 'initiateReview'
    },

    // Review
    IN_REVIEW: {
      name: 'in_review',
      next: ['REVIEW_APPROVED', 'REVIEW_FEEDBACK'],
      timeout: 600000,
      agent: 'team-lead',
      action: 'reviewCode'
    },
    REVIEW_FEEDBACK: {
      name: 'review_feedback',
      next: ['IN_REVIEW'],
      timeout: 300000,
      agent: 'swe-pool',
      action: 'addressFeedback'
    },
    REVIEW_APPROVED: {
      name: 'review_approved',
      next: ['PR_CREATED'],
      agent: null,
      action: 'commitAndCreatePR'
    },

    // PR & CI
    PR_CREATED: {
      name: 'pr_created',
      next: ['PR_APPROVED', 'PR_FEEDBACK'],
      agent: null,
      action: 'awaitPRApproval',
      poll: { interval: 60000, source: 'github', endpoint: 'pr_status' }
    },
    PR_FEEDBACK: {
      name: 'pr_feedback',
      next: ['PR_CREATED'],
      timeout: 600000,
      agent: 'swe-pool',
      action: 'addressPRFeedback'
    },
    PR_APPROVED: {
      name: 'pr_approved',
      next: ['MERGED'],
      agent: null,
      action: 'mergePR'
    },
    MERGED: {
      name: 'merged',
      next: ['BUILD_SUCCESS', 'BUILD_FAILED'],
      agent: null,
      action: 'awaitCIBuild',
      poll: { interval: 30000, source: 'jenkins', endpoint: 'build_status' }
    },
    BUILD_FAILED: {
      name: 'build_failed',
      next: ['PR_CREATED', 'ERROR'],
      timeout: 600000,
      agent: 'debugger',
      action: 'debugBuildFailure',
      maxRetries: 2
    },
    BUILD_SUCCESS: {
      name: 'build_success',
      next: ['IN_QA'],
      agent: null,
      action: 'updateStatusToQA'
    },

    // QA
    IN_QA: {
      name: 'in_qa',
      next: ['QA_PASSED', 'QA_FAILED'],
      timeout: 1800000,
      agent: 'qa-engineer',
      action: 'runE2ETests'
    },
    QA_FAILED: {
      name: 'qa_failed',
      next: ['IMPLEMENTING'],
      agent: 'team-lead',
      action: 'triageQAFailure'
    },
    QA_PASSED: {
      name: 'qa_passed',
      next: ['READY_FOR_PM_REVIEW'],
      agent: 'qa-engineer',
      action: 'generateEvidence'
    },

    // Final
    READY_FOR_PM_REVIEW: {
      name: 'ready_for_pm_review',
      next: ['PM_APPROVED', 'PM_REJECTED'],
      agent: null,
      action: 'awaitPMApproval',
      poll: { interval: 120000, source: 'jira', endpoint: 'item_status' }
    },
    PM_REJECTED: {
      name: 'pm_rejected',
      next: ['IMPLEMENTING', 'IN_QA'],
      agent: 'team-lead',
      action: 'triagePMFeedback'
    },
    PM_APPROVED: {
      name: 'pm_approved',
      next: ['COMPLETED'],
      agent: null,
      action: 'closeAllItems'
    },

    // Terminal
    COMPLETED: {
      name: 'completed',
      next: [],
      terminal: true,
      action: 'logCompletion'
    },
    ERROR: {
      name: 'error',
      next: [],
      terminal: true,
      action: 'logError'
    }
  };

  // ==========================================================================
  // WORKFLOW INSTANCE
  // ==========================================================================

  class WorkflowInstance {
    constructor(id, type, data) {
      this.id = id;
      this.type = type;
      this.state = 'INIT';
      this.data = data;
      this.history = [];
      this.agents = new Map();
      this.retries = {};
      this.createdAt = Date.now();
      this.updatedAt = Date.now();
      this.error = null;
      this._stateTimeout = null;
      this._cleanup = null;
    }

    transition(newState, transitionData = {}) {
      const prev = this.state;

      this.history.push({
        from: prev,
        to: newState,
        timestamp: Date.now(),
        data: transitionData
      });

      this.state = newState;
      this.updatedAt = Date.now();

      EventBus.emit('workflow:transition', {
        workflowId: this.id,
        from: prev,
        to: newState,
        data: transitionData
      });

      console.log(`[Workflow ${this.id}] ${prev} -> ${newState}`);
      return this;
    }

    recordError(error) {
      this.error = {
        message: error.message || String(error),
        state: this.state,
        timestamp: Date.now()
      };
      this.transition('ERROR', { error: this.error });
    }

    toJSON() {
      return {
        id: this.id,
        type: this.type,
        state: this.state,
        data: this.data,
        history: this.history,
        agents: Array.from(this.agents.keys()),
        retries: this.retries,
        createdAt: this.createdAt,
        updatedAt: this.updatedAt,
        error: this.error
      };
    }
  }

  // ==========================================================================
  // SYSTEM ACTIONS
  // ==========================================================================

  const SystemActions = {
    // These simulate external API calls
    // In production, implement actual fetch calls

    async fetchJiraItem(wf) {
      console.log(`[Action] Fetching Jira item: ${wf.data.jiraKey}`);
      // Simulate API call
      wf.data.jiraItem = {
        key: wf.data.jiraKey,
        summary: `Task ${wf.data.jiraKey}`,
        description: 'Implementation task'
      };
      return { nextState: 'JIRA_FETCHED' };
    },

    async createGitHubIssue(wf) {
      console.log(`[Action] Creating GitHub issue for: ${wf.data.jiraKey}`);
      wf.data.ghIssue = {
        number: Math.floor(Math.random() * 1000),
        html_url: `https://github.com/org/repo/issues/${wf.data.jiraKey}`
      };
      return { nextState: 'GH_ISSUE_CREATED' };
    },

    async linkJiraGitHub(wf) {
      console.log(`[Action] Linking Jira ${wf.data.jiraKey} to GH #${wf.data.ghIssue.number}`);
      return { nextState: 'LINKED' };
    },

    async notifyAgents(wf) {
      console.log(`[Action] Notifying agents of task assignment`);
      return { nextState: 'IMPLEMENTING' };
    },

    async runTests(wf) {
      console.log(`[Action] Starting test suite`);
      wf.data.testRunId = Date.now();
      return { nextState: 'TESTS_RUNNING' };
    },

    async awaitTestResults(wf) {
      // Polling handles this
      return { nextState: null };
    },

    async commitAndCreatePR(wf) {
      console.log(`[Action] Creating PR`);
      wf.data.prNumber = Math.floor(Math.random() * 1000);
      wf.data.prUrl = `https://github.com/org/repo/pull/${wf.data.prNumber}`;
      return { nextState: 'PR_CREATED' };
    },

    async awaitPRApproval(wf) {
      return { nextState: null };
    },

    async mergePR(wf) {
      console.log(`[Action] Merging PR #${wf.data.prNumber}`);
      return { nextState: 'MERGED' };
    },

    async awaitCIBuild(wf) {
      return { nextState: null };
    },

    async updateStatusToQA(wf) {
      console.log(`[Action] Updating status to In QA`);
      return { nextState: 'IN_QA' };
    },

    async awaitPMApproval(wf) {
      return { nextState: null };
    },

    async closeAllItems(wf) {
      console.log(`[Action] Closing all items`);
      return { nextState: 'COMPLETED' };
    },

    async logCompletion(wf) {
      const duration = Math.round((Date.now() - wf.createdAt) / 1000);
      console.log(`[Workflow] ${wf.id} COMPLETED in ${duration}s`);
      return { nextState: null };
    },

    async logError(wf) {
      console.error(`[Workflow] ${wf.id} FAILED:`, wf.error);
      return { nextState: null };
    }
  };

  // ==========================================================================
  // WORKFLOW ENGINE
  // ==========================================================================

  const WorkflowEngine = {
    workflows: new Map(),

    async start(type, data) {
      const id = `wf-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
      const workflow = new WorkflowInstance(id, type, data);

      this.workflows.set(id, workflow);
      workflow._cleanup = this.setupHooks(workflow);

      this.persist();

      EventBus.emit('workflow:start', { workflowId: id, type, data });
      console.log(`[Engine] Started workflow ${id} (${type})`);

      await this.executeState(workflow);
      return workflow;
    },

    setupHooks(workflow) {
      const unsubs = [];

      // Agent completion
      unsubs.push(EventBus.on('agent:complete', async (payload) => {
        if (payload.workflowId !== workflow.id) return;

        const stateDef = WORKFLOW_STATES[workflow.state];
        if (stateDef?.parallel) {
          const working = Array.from(workflow.agents.values())
            .filter(a => AgentOS.agents.get(a)?.status === 'working');
          if (working.length === 0) {
            await this.evaluateTransition(workflow);
          }
        } else {
          await this.evaluateTransition(workflow);
        }
      }));

      // Agent error
      unsubs.push(EventBus.on('agent:error', async (payload) => {
        if (payload.workflowId !== workflow.id) return;

        const stateDef = WORKFLOW_STATES[workflow.state];
        const retryCount = workflow.retries[workflow.state] || 0;

        if (stateDef?.maxRetries && retryCount < stateDef.maxRetries) {
          workflow.retries[workflow.state] = retryCount + 1;
          console.log(`[Engine] Retry ${workflow.state} (${retryCount + 1}/${stateDef.maxRetries})`);
          await this.executeState(workflow);
        } else {
          const failState = stateDef?.next?.find(s => s.includes('FAILED')) || 'ERROR';
          workflow.transition(failState, { error: payload.error });
          await this.executeState(workflow);
        }
      }));

      // Poll results
      unsubs.push(EventBus.on('poll:result', async (payload) => {
        if (payload.workflowId !== workflow.id) return;
        if (!payload.changed) return;

        // Handle poll results based on current state
        const stateDef = WORKFLOW_STATES[workflow.state];

        if (workflow.state === 'TESTS_RUNNING') {
          if (payload.data.status === 'passed') {
            workflow.data._nextState = 'TESTS_PASSED';
            await this.evaluateTransition(workflow);
          } else if (payload.data.status === 'failed') {
            workflow.data._nextState = 'TESTS_FAILED';
            await this.evaluateTransition(workflow);
          }
        }

        if (workflow.state === 'PR_CREATED') {
          if (payload.data.state === 'approved') {
            workflow.data._nextState = 'PR_APPROVED';
            await this.evaluateTransition(workflow);
          } else if (payload.data.state === 'changes_requested') {
            workflow.data._nextState = 'PR_FEEDBACK';
            await this.evaluateTransition(workflow);
          }
        }

        if (workflow.state === 'MERGED') {
          if (payload.data.result === 'SUCCESS') {
            workflow.data._nextState = 'BUILD_SUCCESS';
            await this.evaluateTransition(workflow);
          } else if (payload.data.result === 'FAILURE') {
            workflow.data._nextState = 'BUILD_FAILED';
            await this.evaluateTransition(workflow);
          }
        }

        if (workflow.state === 'READY_FOR_PM_REVIEW') {
          if (payload.data.status === 'Accepted') {
            workflow.data._nextState = 'PM_APPROVED';
            await this.evaluateTransition(workflow);
          } else if (payload.data.status === 'Rejected') {
            workflow.data._nextState = 'PM_REJECTED';
            await this.evaluateTransition(workflow);
          }
        }
      }));

      return () => unsubs.forEach(u => u());
    },

    async executeState(workflow) {
      const stateDef = WORKFLOW_STATES[workflow.state];

      if (!stateDef) {
        console.error(`[Engine] Unknown state: ${workflow.state}`);
        return;
      }

      if (stateDef.terminal) {
        this.finalize(workflow);
        return;
      }

      console.log(`[Engine] Executing: ${workflow.state}`);

      // Setup timeout
      if (stateDef.timeout) {
        if (workflow._stateTimeout) clearTimeout(workflow._stateTimeout);
        workflow._stateTimeout = setTimeout(() => {
          console.warn(`[Engine] State ${workflow.state} timed out`);
          EventBus.emit('workflow:timeout', { workflowId: workflow.id, state: workflow.state });
        }, stateDef.timeout);
      }

      // Setup polling
      if (stateDef.poll) {
        PollManager.start(`${workflow.id}-${workflow.state}`, {
          ...stateDef.poll,
          workflowId: workflow.id,
          params: workflow.data
        });
      }

      // Execute action
      try {
        if (stateDef.agent) {
          await this.spawnAgentForState(workflow, stateDef);
        } else if (SystemActions[stateDef.action]) {
          const result = await SystemActions[stateDef.action](workflow);
          if (result?.nextState) {
            workflow.transition(result.nextState, result.data);
            await this.executeState(workflow);
          }
        }
      } catch (error) {
        console.error(`[Engine] Error:`, error);
        workflow.recordError(error);
      }

      this.persist();
    },

    async spawnAgentForState(workflow, stateDef) {
      const agentType = stateDef.agent;

      if (agentType === 'swe-pool') {
        const tasks = workflow.data.taskBreakdown || [{ id: '1', description: 'Implement feature' }];

        for (const task of tasks) {
          const agent = AgentOS.spawnAgent({
            type: 'swe',
            name: `SWE-${task.id}`,
            context: { workflowId: workflow.id, task, state: workflow.state }
          });
          workflow.agents.set(agent.id, agent.id);

          // Inject task prompt
          setTimeout(() => {
            AgentOS.assignTask(agent.id, {
              type: stateDef.action,
              ...task,
              instructions: `Implement: ${task.description}\n\nWhen complete: [TASK_COMPLETE]\nOn error: [TASK_ERROR: reason]`
            });
          }, 500);
        }
      } else {
        const agent = AgentOS.spawnAgent({
          type: agentType,
          name: `${agentType}-${workflow.id.slice(-4)}`,
          context: { workflowId: workflow.id, state: workflow.state }
        });
        workflow.agents.set(agent.id, agent.id);

        setTimeout(() => {
          AgentOS.assignTask(agent.id, {
            type: stateDef.action,
            workflowData: workflow.data,
            instructions: `Action: ${stateDef.action}\n\nWhen complete: [TASK_COMPLETE]\nTo suggest next state: [NEXT_STATE: STATE_NAME]`
          });
        }, 500);
      }
    },

    async evaluateTransition(workflow) {
      const stateDef = WORKFLOW_STATES[workflow.state];

      if (workflow._stateTimeout) {
        clearTimeout(workflow._stateTimeout);
        workflow._stateTimeout = null;
      }

      PollManager.stop(`${workflow.id}-${workflow.state}`);

      // Determine next state
      let nextState = workflow.data._nextState;
      delete workflow.data._nextState;

      if (!nextState && stateDef.next.length === 1) {
        nextState = stateDef.next[0];
      }

      if (!nextState) {
        nextState = stateDef.next[0]; // Default to success path
      }

      if (nextState) {
        workflow.transition(nextState);
        await this.executeState(workflow);
      }
    },

    finalize(workflow) {
      if (workflow._cleanup) workflow._cleanup();
      if (workflow._stateTimeout) clearTimeout(workflow._stateTimeout);

      PollManager.stopAll(workflow.id);

      workflow.agents.forEach(agentId => {
        AgentOS.destroyAgent(agentId);
      });

      const event = workflow.state === 'COMPLETED' ? 'workflow:complete' : 'workflow:error';
      EventBus.emit(event, {
        workflowId: workflow.id,
        duration: Date.now() - workflow.createdAt,
        finalState: workflow.state
      });

      this.persist();
    },

    persist() {
      const state = {};
      this.workflows.forEach((wf, id) => state[id] = wf.toJSON());
      localStorage.setItem('workflowEngine_state', JSON.stringify(state));
    },

    status() {
      return Array.from(this.workflows.values()).map(wf => ({
        id: wf.id,
        type: wf.type,
        state: wf.state,
        agents: wf.agents.size,
        age: Math.round((Date.now() - wf.createdAt) / 1000) + 's',
        history: wf.history.length + ' transitions'
      }));
    },

    get(workflowId) {
      return this.workflows.get(workflowId);
    },

    // Manual controls
    forceTransition(workflowId, newState) {
      const wf = this.workflows.get(workflowId);
      if (!wf) return console.error('Workflow not found');
      wf.transition(newState, { forced: true });
      this.executeState(wf);
    },

    abort(workflowId) {
      const wf = this.workflows.get(workflowId);
      if (!wf) return console.error('Workflow not found');
      wf.transition('ERROR', { reason: 'Manual abort' });
      this.finalize(wf);
    }
  };

  // ==========================================================================
  // COMMAND PARSER
  // ==========================================================================

  const CommandParser = {
    commands: {},

    register(name, handler, description) {
      this.commands[name] = { handler, description };
    },

    async parse(input) {
      const match = input.match(/^\/(\S+)\s*(.*)/);
      if (!match) return null;

      const [, command, args] = match;
      const cmd = this.commands[command];

      if (!cmd) {
        console.warn(`Unknown command: /${command}`);
        console.log('Available:', Object.keys(this.commands).map(c => '/' + c).join(', '));
        return null;
      }

      return cmd.handler(args.trim());
    },

    help() {
      console.log('\nAvailable Commands:\n');
      Object.entries(this.commands).forEach(([name, { description }]) => {
        console.log(`  /${name}`);
        console.log(`    ${description}\n`);
      });
    }
  };

  // Register commands
  CommandParser.register('implement-work-item', async (args) => {
    const jiraKey = args.split(/\s+/)[0];

    if (!jiraKey || !jiraKey.match(/^[A-Z]+-\d+$/i)) {
      console.error('Usage: /implement-work-item ABC-123');
      return null;
    }

    const workflow = await WorkflowEngine.start('implement-work-item', {
      jiraKey: jiraKey.toUpperCase(),
      startedAt: Date.now()
    });

    AgentOS.showNotification(`Workflow started: ${workflow.id}`, 'success');
    return workflow;
  }, 'Start full SDLC workflow for a Jira item');

  CommandParser.register('workflow-status', () => {
    const workflows = WorkflowEngine.status();
    if (workflows.length === 0) {
      console.log('No active workflows');
    } else {
      console.table(workflows);
    }
    return workflows;
  }, 'List all active workflows');

  CommandParser.register('poll-status', () => {
    const polls = PollManager.status();
    if (polls.length === 0) {
      console.log('No active polls');
    } else {
      console.table(polls);
    }
    return polls;
  }, 'List all active polling tasks');

  CommandParser.register('workflow-abort', (args) => {
    const wfId = args.trim();
    if (!wfId) {
      console.error('Usage: /workflow-abort wf-xxx');
      return;
    }
    WorkflowEngine.abort(wfId);
  }, 'Abort a running workflow');

  CommandParser.register('help', () => {
    CommandParser.help();
  }, 'Show available commands');

  // ==========================================================================
  // AGENT OUTPUT HOOK
  // ==========================================================================

  // Enhance AgentOS output parsing for workflow awareness
  const originalParseOutput = AgentOS.parseAgentOutput?.bind(AgentOS);

  AgentOS.parseAgentOutput = function(agent, output) {
    // Call original if exists
    if (originalParseOutput) {
      originalParseOutput(agent, output);
    }

    const workflowId = agent.context?.workflowId;
    if (!workflowId) return;

    // Emit to workflow engine
    if (output.includes('[TASK_COMPLETE]')) {
      EventBus.emit('agent:complete', {
        agentId: agent.id,
        output,
        workflowId
      });
    }

    const errorMatch = output.match(/\[TASK_ERROR:\s*(.+?)\]/);
    if (errorMatch) {
      EventBus.emit('agent:error', {
        agentId: agent.id,
        error: errorMatch[1],
        workflowId
      });
    }

    const nextStateMatch = output.match(/\[NEXT_STATE:\s*(\w+)\]/);
    if (nextStateMatch) {
      const workflow = WorkflowEngine.get(workflowId);
      if (workflow) {
        workflow.data._nextState = nextStateMatch[1];
      }
    }

    const contextMatches = output.matchAll(/\[CONTEXT_SAVE:\s*(\w+)=(.+?)\]/g);
    for (const match of contextMatches) {
      const workflow = WorkflowEngine.get(workflowId);
      if (workflow) {
        workflow.data[match[1]] = match[2];
      }
    }
  };

  // ==========================================================================
  // EXPOSE GLOBALS
  // ==========================================================================

  window.EventBus = EventBus;
  window.PollManager = PollManager;
  window.WorkflowEngine = WorkflowEngine;
  window.CommandParser = CommandParser;
  window.WORKFLOW_STATES = WORKFLOW_STATES;

  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================

  console.log(`
%c+===============================================================+
|              Workflow Engine Loaded                           |
+===============================================================+
|  /implement-work-item ABC-123  - Start SDLC workflow          |
|  /workflow-status              - List workflows               |
|  /poll-status                  - List active polls            |
|  /help                         - Show all commands            |
+===============================================================+
|  WorkflowEngine.status()       - Workflow overview            |
|  WorkflowEngine.get('wf-xx')   - Get workflow details         |
|  WorkflowEngine.forceTransition('wf-xx', 'STATE')             |
|  PollManager.setMockData(src, endpoint, data)                 |
+===============================================================+`,
    'color: #81c784; font-family: monospace;'
  );

})();

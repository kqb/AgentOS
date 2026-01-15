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
 *   /poll-status                  - List active polls
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
      
      console.log(`[Workflow ${this.id}] ${prev} → ${newState}`);
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
      console.log('\n📋 Available Commands:\n');
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
%c╔═══════════════════════════════════════════════════════════════╗
║              🔄 Workflow Engine Loaded                         ║
╠═══════════════════════════════════════════════════════════════╣
║  /implement-work-item ABC-123  - Start SDLC workflow          ║
║  /workflow-status              - List workflows               ║
║  /poll-status                  - List active polls            ║
║  /help                         - Show all commands            ║
╠═══════════════════════════════════════════════════════════════╣
║  WorkflowEngine.status()       - Workflow overview            ║
║  WorkflowEngine.get('wf-xx')   - Get workflow details         ║
║  WorkflowEngine.forceTransition('wf-xx', 'STATE')             ║
║  PollManager.setMockData(src, endpoint, data)                 ║
╚═══════════════════════════════════════════════════════════════╝`,
    'color: #81c784; font-family: monospace;'
  );

})();

# Event-Driven Workflow Orchestration System

## The Problem with Simple Signals

The basic `[TASK_COMPLETE]` signal protocol works for linear tasks, but breaks down for:
- **External dependencies** (waiting for PR approval, Jenkins build)
- **Conditional branching** (success/failure paths)
- **Long-running workflows** (hours/days, not minutes)
- **State persistence** (surviving browser refresh, machine restart)
- **Polling external systems** (Jira status, GitHub PR state)

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         WORKFLOW ORCHESTRATION ENGINE                            │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐           │
│  │   COMMAND       │     │   WORKFLOW      │     │   EXTERNAL      │           │
│  │   PARSER        │────▶│   STATE         │◀───▶│   INTEGRATIONS  │           │
│  │ /implement-*    │     │   MACHINE       │     │   (Jira/GH/CI)  │           │
│  └─────────────────┘     └────────┬────────┘     └─────────────────┘           │
│                                   │                                             │
│                    ┌──────────────┼──────────────┐                             │
│                    ▼              ▼              ▼                             │
│  ┌─────────────────────────────────────────────────────────────────┐          │
│  │                      EVENT BUS                                   │          │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐           │          │
│  │  │ HOOKS   │  │ POLLS   │  │ TIMERS  │  │ SIGNALS │           │          │
│  │  │ (sync)  │  │ (async) │  │ (cron)  │  │ (agent) │           │          │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘           │          │
│  └─────────────────────────────────────────────────────────────────┘          │
│                                   │                                             │
│                    ┌──────────────┼──────────────┐                             │
│                    ▼              ▼              ▼                             │
│  ┌─────────────────────────────────────────────────────────────────┐          │
│  │                    AGENT POOL                                    │          │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │          │
│  │  │Team Lead │ │ SWE      │ │ QA       │ │ DevOps   │          │          │
│  │  │ Agent    │ │ Agents   │ │ Agent    │ │ Agent    │          │          │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘          │          │
│  └─────────────────────────────────────────────────────────────────┘          │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Part 1: Workflow State Machine

### 1.1 State Definition

```javascript
// workflow-states.js
// Complete state machine for implement-work-item workflow

const WORKFLOW_STATES = {
  // ===== INITIALIZATION =====
  INIT: {
    name: 'init',
    description: 'Workflow initialized, fetching Jira item',
    next: ['JIRA_FETCHED', 'ERROR'],
    timeout: 30000,
    agent: null, // System action
    action: 'fetchJiraItem'
  },
  
  JIRA_FETCHED: {
    name: 'jira_fetched',
    description: 'Jira item retrieved, creating GitHub issue',
    next: ['GH_ISSUE_CREATED', 'ERROR'],
    timeout: 30000,
    agent: null,
    action: 'createGitHubIssue'
  },
  
  GH_ISSUE_CREATED: {
    name: 'gh_issue_created', 
    description: 'GitHub issue created, linking to Jira',
    next: ['LINKED', 'ERROR'],
    timeout: 15000,
    agent: null,
    action: 'linkJiraGitHub'
  },
  
  // ===== PLANNING =====
  LINKED: {
    name: 'linked',
    description: 'Items linked, team lead breaking down tasks',
    next: ['TASKS_ASSIGNED', 'ERROR'],
    timeout: 300000, // 5 min for planning
    agent: 'team-lead',
    action: 'breakdownAndAssign'
  },
  
  TASKS_ASSIGNED: {
    name: 'tasks_assigned',
    description: 'Tasks assigned to SWE agents',
    next: ['IMPLEMENTING'],
    timeout: null, // No timeout, event-driven
    agent: null,
    action: 'notifyAgents'
  },
  
  // ===== IMPLEMENTATION =====
  IMPLEMENTING: {
    name: 'implementing',
    description: 'SWE agents implementing (parallel)',
    next: ['TESTS_WRITTEN', 'IMPLEMENTATION_FAILED'],
    timeout: 1800000, // 30 min max
    agent: 'swe-pool',
    action: 'implementFeature',
    parallel: true,
    hooks: ['onAgentComplete', 'onAgentError']
  },
  
  IMPLEMENTATION_FAILED: {
    name: 'implementation_failed',
    description: 'Implementation failed, diagnosing',
    next: ['IMPLEMENTING', 'ERROR'],
    timeout: 300000,
    agent: 'debugger',
    action: 'diagnoseAndFix',
    maxRetries: 3
  },
  
  TESTS_WRITTEN: {
    name: 'tests_written',
    description: 'Unit/integration tests written',
    next: ['TESTS_RUNNING', 'ERROR'],
    timeout: 60000,
    agent: null,
    action: 'runTests'
  },
  
  TESTS_RUNNING: {
    name: 'tests_running',
    description: 'Running test suite',
    next: ['TESTS_PASSED', 'TESTS_FAILED'],
    timeout: 600000, // 10 min for tests
    agent: null,
    action: 'awaitTestResults',
    poll: { interval: 10000, source: 'terminal' }
  },
  
  TESTS_FAILED: {
    name: 'tests_failed',
    description: 'Tests failed, fixing',
    next: ['TESTS_RUNNING', 'ERROR'],
    timeout: 300000,
    agent: 'swe-pool',
    action: 'fixFailingTests',
    maxRetries: 3
  },
  
  TESTS_PASSED: {
    name: 'tests_passed',
    description: 'All tests passing, ready for review',
    next: ['IN_REVIEW'],
    timeout: null,
    agent: 'team-lead',
    action: 'initiateReview'
  },
  
  // ===== CODE REVIEW =====
  IN_REVIEW: {
    name: 'in_review',
    description: 'Team lead reviewing code',
    next: ['REVIEW_APPROVED', 'REVIEW_FEEDBACK'],
    timeout: 600000, // 10 min review
    agent: 'team-lead',
    action: 'reviewCode'
  },
  
  REVIEW_FEEDBACK: {
    name: 'review_feedback',
    description: 'Addressing review feedback',
    next: ['IN_REVIEW'],
    timeout: 300000,
    agent: 'swe-pool',
    action: 'addressFeedback'
  },
  
  REVIEW_APPROVED: {
    name: 'review_approved',
    description: 'Review approved, creating PR',
    next: ['PR_CREATED'],
    timeout: 60000,
    agent: null,
    action: 'commitAndCreatePR'
  },
  
  // ===== PR & CI =====
  PR_CREATED: {
    name: 'pr_created',
    description: 'PR created, awaiting approval',
    next: ['PR_APPROVED', 'PR_FEEDBACK'],
    timeout: null, // Indefinite wait
    agent: null,
    action: 'awaitPRApproval',
    poll: { 
      interval: 60000, // Check every minute
      source: 'github',
      endpoint: 'pr_status'
    }
  },
  
  PR_FEEDBACK: {
    name: 'pr_feedback',
    description: 'Addressing PR feedback from humans',
    next: ['PR_CREATED'],
    timeout: 600000,
    agent: 'swe-pool',
    action: 'addressPRFeedback'
  },
  
  PR_APPROVED: {
    name: 'pr_approved',
    description: 'PR approved, merging',
    next: ['MERGED'],
    timeout: 30000,
    agent: null,
    action: 'mergePR'
  },
  
  MERGED: {
    name: 'merged',
    description: 'PR merged, awaiting CI build',
    next: ['BUILD_SUCCESS', 'BUILD_FAILED'],
    timeout: null,
    agent: null,
    action: 'awaitCIBuild',
    poll: {
      interval: 30000,
      source: 'jenkins',
      endpoint: 'build_status'
    }
  },
  
  BUILD_FAILED: {
    name: 'build_failed',
    description: 'CI build failed, debugging',
    next: ['PR_CREATED', 'ERROR'], // Creates new PR with fix
    timeout: 600000,
    agent: 'debugger',
    action: 'debugBuildFailure',
    maxRetries: 2
  },
  
  BUILD_SUCCESS: {
    name: 'build_success',
    description: 'Build passed, updating status to QA',
    next: ['IN_QA'],
    timeout: 30000,
    agent: null,
    action: 'updateStatusToQA'
  },
  
  // ===== QA =====
  IN_QA: {
    name: 'in_qa',
    description: 'QA engineer running E2E tests',
    next: ['QA_PASSED', 'QA_FAILED'],
    timeout: 1800000, // 30 min for E2E
    agent: 'qa-engineer',
    action: 'runE2ETests'
  },
  
  QA_FAILED: {
    name: 'qa_failed',
    description: 'E2E tests failed',
    next: ['IMPLEMENTING'], // Back to implementation
    timeout: null,
    agent: 'team-lead',
    action: 'triageQAFailure'
  },
  
  QA_PASSED: {
    name: 'qa_passed',
    description: 'E2E passed, providing evidence',
    next: ['READY_FOR_PM_REVIEW'],
    timeout: 60000,
    agent: 'qa-engineer',
    action: 'generateEvidence'
  },
  
  // ===== FINAL APPROVAL =====
  READY_FOR_PM_REVIEW: {
    name: 'ready_for_pm_review',
    description: 'Awaiting PM acceptance',
    next: ['PM_APPROVED', 'PM_REJECTED'],
    timeout: null, // Indefinite
    agent: null,
    action: 'awaitPMApproval',
    poll: {
      interval: 120000, // Check every 2 min
      source: 'jira',
      endpoint: 'item_status',
      successValue: 'Accepted'
    }
  },
  
  PM_REJECTED: {
    name: 'pm_rejected',
    description: 'PM rejected, reviewing feedback',
    next: ['IMPLEMENTING', 'IN_QA'], // Depending on feedback
    timeout: null,
    agent: 'team-lead',
    action: 'triagePMFeedback'
  },
  
  PM_APPROVED: {
    name: 'pm_approved',
    description: 'PM approved, closing items',
    next: ['COMPLETED'],
    timeout: 60000,
    agent: null,
    action: 'closeAllItems'
  },
  
  // ===== TERMINAL STATES =====
  COMPLETED: {
    name: 'completed',
    description: 'Workflow completed successfully',
    next: [],
    terminal: true,
    agent: null,
    action: 'logCompletion'
  },
  
  ERROR: {
    name: 'error',
    description: 'Workflow failed, requires intervention',
    next: [],
    terminal: true,
    agent: null,
    action: 'logError'
  }
};
```

### 1.2 Workflow Instance

```javascript
// workflow-instance.js
// Runtime representation of a workflow execution

class WorkflowInstance {
  constructor(workflowId, type, initialData) {
    this.id = workflowId;
    this.type = type; // 'implement-work-item', etc.
    this.state = 'INIT';
    this.data = initialData; // { jiraKey: 'ABC-123', ... }
    this.history = [];
    this.agents = new Map(); // Assigned agents
    this.polls = new Map();  // Active polling tasks
    this.hooks = new Map();  // Registered hooks
    this.retries = {};       // Retry counts per state
    this.createdAt = Date.now();
    this.updatedAt = Date.now();
    this.error = null;
  }

  transition(newState, data = {}) {
    const prevState = this.state;
    
    this.history.push({
      from: prevState,
      to: newState,
      timestamp: Date.now(),
      data
    });
    
    this.state = newState;
    this.updatedAt = Date.now();
    
    // Emit transition event
    WorkflowEngine.emit('transition', {
      workflowId: this.id,
      from: prevState,
      to: newState,
      data
    });
    
    return this;
  }

  recordError(error) {
    this.error = {
      message: error.message || error,
      state: this.state,
      timestamp: Date.now(),
      stack: error.stack
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
      agents: Array.from(this.agents.entries()),
      retries: this.retries,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      error: this.error
    };
  }
}
```

---

## Part 2: Event Bus & Hook System

### 2.1 Event Bus

```javascript
// event-bus.js
// Central event dispatcher for workflow coordination

const EventBus = {
  listeners: new Map(),
  queue: [],
  processing: false,

  // Register event listener
  on(event, callback, options = {}) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    
    const listener = {
      callback,
      once: options.once || false,
      filter: options.filter || null, // Filter function
      priority: options.priority || 0
    };
    
    const listeners = this.listeners.get(event);
    listeners.push(listener);
    listeners.sort((a, b) => b.priority - a.priority);
    
    // Return unsubscribe function
    return () => {
      const idx = listeners.indexOf(listener);
      if (idx > -1) listeners.splice(idx, 1);
    };
  },

  // One-time listener
  once(event, callback, options = {}) {
    return this.on(event, callback, { ...options, once: true });
  },

  // Emit event
  emit(event, payload) {
    this.queue.push({ event, payload, timestamp: Date.now() });
    this.processQueue();
  },

  async processQueue() {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const { event, payload } = this.queue.shift();
      const listeners = this.listeners.get(event) || [];
      
      for (const listener of [...listeners]) {
        // Apply filter if present
        if (listener.filter && !listener.filter(payload)) continue;
        
        try {
          await listener.callback(payload);
        } catch (e) {
          console.error(`[EventBus] Error in ${event} listener:`, e);
        }
        
        // Remove one-time listeners
        if (listener.once) {
          const idx = listeners.indexOf(listener);
          if (idx > -1) listeners.splice(idx, 1);
        }
      }
    }

    this.processing = false;
  }
};
```

### 2.2 Hook System

```javascript
// hooks.js
// Hook definitions for workflow events

const Hooks = {
  // ===== AGENT LIFECYCLE HOOKS =====
  
  onAgentSpawned: {
    event: 'agent:spawned',
    description: 'Fired when a new agent is created',
    payload: '{ agentId, type, workflowId }'
  },
  
  onAgentComplete: {
    event: 'agent:complete',
    description: 'Fired when agent signals task completion',
    payload: '{ agentId, output, workflowId }'
  },
  
  onAgentError: {
    event: 'agent:error',
    description: 'Fired when agent encounters error',
    payload: '{ agentId, error, workflowId }'
  },
  
  onAgentHandoff: {
    event: 'agent:handoff',
    description: 'Fired when agent requests handoff',
    payload: '{ fromAgent, toType, context, workflowId }'
  },

  // ===== WORKFLOW HOOKS =====
  
  onWorkflowStart: {
    event: 'workflow:start',
    description: 'Fired when workflow begins',
    payload: '{ workflowId, type, data }'
  },
  
  onStateTransition: {
    event: 'workflow:transition',
    description: 'Fired on every state change',
    payload: '{ workflowId, from, to, data }'
  },
  
  onWorkflowComplete: {
    event: 'workflow:complete',
    description: 'Fired when workflow reaches terminal success',
    payload: '{ workflowId, duration, summary }'
  },
  
  onWorkflowError: {
    event: 'workflow:error',
    description: 'Fired when workflow fails',
    payload: '{ workflowId, error, state }'
  },

  // ===== EXTERNAL SYSTEM HOOKS =====
  
  onJiraUpdate: {
    event: 'external:jira:update',
    description: 'Fired when Jira item status changes',
    payload: '{ key, oldStatus, newStatus, workflowId }'
  },
  
  onGitHubPRUpdate: {
    event: 'external:github:pr',
    description: 'Fired when PR state changes',
    payload: '{ prNumber, state, reviews, workflowId }'
  },
  
  onJenkinsBuild: {
    event: 'external:jenkins:build',
    description: 'Fired when build completes',
    payload: '{ buildNumber, result, workflowId }'
  },

  // ===== POLLING HOOKS =====
  
  onPollResult: {
    event: 'poll:result',
    description: 'Fired when poll returns new data',
    payload: '{ source, data, changed, workflowId }'
  },
  
  onPollTimeout: {
    event: 'poll:timeout',
    description: 'Fired when poll exceeds max duration',
    payload: '{ source, duration, workflowId }'
  }
};

// Hook registration helper
function registerHook(hookName, callback, options = {}) {
  const hook = Hooks[hookName];
  if (!hook) {
    throw new Error(`Unknown hook: ${hookName}`);
  }
  return EventBus.on(hook.event, callback, options);
}
```

### 2.3 Hook-Based Workflow Transitions

```javascript
// workflow-hooks.js
// Connect hooks to workflow state machine

function setupWorkflowHooks(workflow) {
  const unsubscribers = [];

  // Agent completion triggers state evaluation
  unsubscribers.push(
    registerHook('onAgentComplete', async (payload) => {
      if (payload.workflowId !== workflow.id) return;
      
      const currentState = WORKFLOW_STATES[workflow.state];
      
      // Check if all parallel agents are done
      if (currentState.parallel) {
        const activeAgents = Array.from(workflow.agents.values())
          .filter(a => a.status === 'working');
        
        if (activeAgents.length === 0) {
          // All done, transition to next state
          await WorkflowEngine.evaluateTransition(workflow);
        }
      } else {
        // Single agent, transition immediately
        await WorkflowEngine.evaluateTransition(workflow);
      }
    }, { filter: p => p.workflowId === workflow.id })
  );

  // Agent error triggers retry or failure
  unsubscribers.push(
    registerHook('onAgentError', async (payload) => {
      if (payload.workflowId !== workflow.id) return;
      
      const currentState = WORKFLOW_STATES[workflow.state];
      const retryCount = workflow.retries[workflow.state] || 0;
      
      if (currentState.maxRetries && retryCount < currentState.maxRetries) {
        workflow.retries[workflow.state] = retryCount + 1;
        console.log(`[Workflow] Retrying ${workflow.state} (${retryCount + 1}/${currentState.maxRetries})`);
        await WorkflowEngine.executeState(workflow);
      } else {
        // Max retries exceeded or no retry allowed
        workflow.transition(currentState.next.includes('ERROR') ? 'ERROR' : currentState.next[1], {
          error: payload.error
        });
      }
    }, { filter: p => p.workflowId === workflow.id })
  );

  // External system updates
  unsubscribers.push(
    registerHook('onGitHubPRUpdate', async (payload) => {
      if (payload.workflowId !== workflow.id) return;
      
      if (workflow.state === 'PR_CREATED') {
        if (payload.state === 'approved') {
          workflow.transition('PR_APPROVED', { pr: payload });
          await WorkflowEngine.executeState(workflow);
        } else if (payload.state === 'changes_requested') {
          workflow.transition('PR_FEEDBACK', { feedback: payload.reviews });
          await WorkflowEngine.executeState(workflow);
        }
      }
    })
  );

  unsubscribers.push(
    registerHook('onJenkinsBuild', async (payload) => {
      if (payload.workflowId !== workflow.id) return;
      
      if (workflow.state === 'MERGED') {
        if (payload.result === 'SUCCESS') {
          workflow.transition('BUILD_SUCCESS', { build: payload });
        } else {
          workflow.transition('BUILD_FAILED', { build: payload });
        }
        await WorkflowEngine.executeState(workflow);
      }
    })
  );

  unsubscribers.push(
    registerHook('onJiraUpdate', async (payload) => {
      if (payload.workflowId !== workflow.id) return;
      
      if (workflow.state === 'READY_FOR_PM_REVIEW') {
        if (payload.newStatus === 'Accepted') {
          workflow.transition('PM_APPROVED');
        } else if (payload.newStatus === 'Rejected') {
          workflow.transition('PM_REJECTED', { reason: payload.comment });
        }
        await WorkflowEngine.executeState(workflow);
      }
    })
  );

  // Return cleanup function
  return () => unsubscribers.forEach(unsub => unsub());
}
```

---

## Part 3: Polling Infrastructure

### 3.1 Poll Manager

```javascript
// poll-manager.js
// Manages polling tasks for external systems

const PollManager = {
  activePolls: new Map(),
  
  // Start a polling task
  start(pollId, config) {
    const { 
      source,      // 'github', 'jira', 'jenkins'
      endpoint,    // API endpoint identifier
      interval,    // ms between polls
      workflowId,
      timeout,     // Max poll duration (optional)
      successCondition, // Function to check if done
      params       // Additional params for the poll
    } = config;

    if (this.activePolls.has(pollId)) {
      console.warn(`[Poll] ${pollId} already active`);
      return;
    }

    const poll = {
      id: pollId,
      source,
      endpoint,
      interval,
      workflowId,
      params,
      startTime: Date.now(),
      timeout,
      successCondition,
      lastResult: null,
      pollCount: 0,
      intervalId: null
    };

    poll.intervalId = setInterval(async () => {
      await this.executePoll(poll);
    }, interval);

    // Execute immediately too
    this.executePoll(poll);

    this.activePolls.set(pollId, poll);
    console.log(`[Poll] Started ${pollId} (every ${interval}ms)`);
    
    return pollId;
  },

  async executePoll(poll) {
    poll.pollCount++;
    
    try {
      const result = await ExternalIntegrations.fetch(poll.source, poll.endpoint, poll.params);
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

      // Check success condition
      if (poll.successCondition && poll.successCondition(result)) {
        console.log(`[Poll] ${poll.id} success condition met`);
        this.stop(poll.id);
      }

      // Check timeout
      if (poll.timeout && (Date.now() - poll.startTime) > poll.timeout) {
        console.warn(`[Poll] ${poll.id} timed out`);
        EventBus.emit('poll:timeout', {
          pollId: poll.id,
          source: poll.source,
          duration: Date.now() - poll.startTime,
          workflowId: poll.workflowId
        });
        this.stop(poll.id);
      }

    } catch (error) {
      console.error(`[Poll] ${poll.id} error:`, error);
      EventBus.emit('poll:error', {
        pollId: poll.id,
        error,
        workflowId: poll.workflowId
      });
    }
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
      workflowId: p.workflowId,
      pollCount: p.pollCount,
      running: Date.now() - p.startTime
    }));
  }
};
```

### 3.2 External Integrations (Without MCP)

Since MCP is disabled, we use injected fetch wrappers or SSO-walled browser automation:

```javascript
// external-integrations.js
// Fetches data from external systems without MCP

const ExternalIntegrations = {
  // Configuration for each source
  config: {
    jira: {
      baseUrl: null,  // Set dynamically
      authMethod: 'browser-session' // Uses existing SSO session
    },
    github: {
      baseUrl: 'https://api.github.com',
      authMethod: 'token' // Uses env token
    },
    jenkins: {
      baseUrl: null,
      authMethod: 'browser-session'
    }
  },

  // Initialize with workspace config
  init(config) {
    Object.assign(this.config.jira, config.jira || {});
    Object.assign(this.config.github, config.github || {});
    Object.assign(this.config.jenkins, config.jenkins || {});
  },

  // Main fetch dispatcher
  async fetch(source, endpoint, params = {}) {
    switch (source) {
      case 'jira':
        return this.fetchJira(endpoint, params);
      case 'github':
        return this.fetchGitHub(endpoint, params);
      case 'jenkins':
        return this.fetchJenkins(endpoint, params);
      default:
        throw new Error(`Unknown source: ${source}`);
    }
  },

  // ===== JIRA INTEGRATION =====
  
  async fetchJira(endpoint, params) {
    const { baseUrl } = this.config.jira;
    
    switch (endpoint) {
      case 'get_item':
        return this.jiraGetItem(params.key);
      case 'item_status':
        return this.jiraGetStatus(params.key);
      case 'update_status':
        return this.jiraUpdateStatus(params.key, params.status);
      case 'add_comment':
        return this.jiraAddComment(params.key, params.comment);
      default:
        throw new Error(`Unknown Jira endpoint: ${endpoint}`);
    }
  },

  async jiraGetItem(key) {
    // Option 1: Use existing browser session via injected fetch
    // This works if user is logged into Jira in the same browser
    const url = `${this.config.jira.baseUrl}/rest/api/2/issue/${key}`;
    
    const response = await fetch(url, {
      credentials: 'include', // Include cookies from browser session
      headers: {
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Jira fetch failed: ${response.status}`);
    }
    
    return response.json();
  },

  async jiraGetStatus(key) {
    const item = await this.jiraGetItem(key);
    return {
      key: item.key,
      status: item.fields.status.name,
      assignee: item.fields.assignee?.displayName,
      summary: item.fields.summary
    };
  },

  async jiraUpdateStatus(key, targetStatus) {
    // Get available transitions
    const transitionsUrl = `${this.config.jira.baseUrl}/rest/api/2/issue/${key}/transitions`;
    const transResponse = await fetch(transitionsUrl, { credentials: 'include' });
    const { transitions } = await transResponse.json();
    
    const transition = transitions.find(t => 
      t.name.toLowerCase() === targetStatus.toLowerCase()
    );
    
    if (!transition) {
      throw new Error(`Cannot transition to ${targetStatus}. Available: ${transitions.map(t => t.name).join(', ')}`);
    }
    
    // Execute transition
    const response = await fetch(transitionsUrl, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transition: { id: transition.id } })
    });
    
    return response.ok;
  },

  // ===== GITHUB INTEGRATION =====
  
  async fetchGitHub(endpoint, params) {
    switch (endpoint) {
      case 'create_issue':
        return this.ghCreateIssue(params);
      case 'pr_status':
        return this.ghGetPRStatus(params.prNumber);
      case 'create_pr':
        return this.ghCreatePR(params);
      case 'merge_pr':
        return this.ghMergePR(params.prNumber);
      default:
        throw new Error(`Unknown GitHub endpoint: ${endpoint}`);
    }
  },

  async ghGetPRStatus(prNumber) {
    const { owner, repo, token } = this.config.github;
    
    const response = await fetch(
      `${this.config.github.baseUrl}/repos/${owner}/${repo}/pulls/${prNumber}`,
      {
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      }
    );
    
    const pr = await response.json();
    
    // Get reviews
    const reviewsResponse = await fetch(
      `${this.config.github.baseUrl}/repos/${owner}/${repo}/pulls/${prNumber}/reviews`,
      {
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      }
    );
    const reviews = await reviewsResponse.json();
    
    // Determine state
    const approvals = reviews.filter(r => r.state === 'APPROVED');
    const changesRequested = reviews.filter(r => r.state === 'CHANGES_REQUESTED');
    
    let state = 'pending';
    if (changesRequested.length > 0) state = 'changes_requested';
    else if (approvals.length > 0) state = 'approved';
    
    return {
      number: pr.number,
      state,
      mergeable: pr.mergeable,
      reviews: reviews.map(r => ({ user: r.user.login, state: r.state, body: r.body })),
      url: pr.html_url
    };
  },

  // ===== JENKINS INTEGRATION =====
  
  async fetchJenkins(endpoint, params) {
    switch (endpoint) {
      case 'build_status':
        return this.jenkinsGetBuildStatus(params.jobName, params.buildNumber);
      case 'trigger_build':
        return this.jenkinsTriggerBuild(params.jobName, params.params);
      default:
        throw new Error(`Unknown Jenkins endpoint: ${endpoint}`);
    }
  },

  async jenkinsGetBuildStatus(jobName, buildNumber) {
    const url = `${this.config.jenkins.baseUrl}/job/${jobName}/${buildNumber || 'lastBuild'}/api/json`;
    
    const response = await fetch(url, {
      credentials: 'include' // Use browser SSO session
    });
    
    const build = await response.json();
    
    return {
      number: build.number,
      result: build.result, // SUCCESS, FAILURE, UNSTABLE, null (running)
      building: build.building,
      duration: build.duration,
      url: build.url
    };
  }
};
```

---

## Part 4: Workflow Engine

### 4.1 Core Engine

```javascript
// workflow-engine.js
// Central orchestrator for workflow execution

const WorkflowEngine = {
  workflows: new Map(),
  
  // Create and start a new workflow
  async start(type, data) {
    const workflowId = `wf-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    
    const workflow = new WorkflowInstance(workflowId, type, data);
    this.workflows.set(workflowId, workflow);
    
    // Setup hooks for this workflow
    workflow._cleanup = setupWorkflowHooks(workflow);
    
    // Persist
    this.persist();
    
    // Emit start event
    EventBus.emit('workflow:start', {
      workflowId,
      type,
      data
    });
    
    // Begin execution
    await this.executeState(workflow);
    
    return workflow;
  },

  // Execute current state's action
  async executeState(workflow) {
    const stateDef = WORKFLOW_STATES[workflow.state];
    
    if (!stateDef) {
      console.error(`[Engine] Unknown state: ${workflow.state}`);
      return;
    }
    
    if (stateDef.terminal) {
      console.log(`[Engine] Workflow ${workflow.id} reached terminal state: ${workflow.state}`);
      this.finalize(workflow);
      return;
    }

    console.log(`[Engine] Executing state: ${workflow.state} for ${workflow.id}`);

    // Setup timeout if defined
    if (stateDef.timeout) {
      workflow._stateTimeout = setTimeout(() => {
        console.warn(`[Engine] State ${workflow.state} timed out`);
        EventBus.emit('workflow:state_timeout', {
          workflowId: workflow.id,
          state: workflow.state
        });
      }, stateDef.timeout);
    }

    // Setup polling if defined
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
        // Spawn agent(s) for this state
        await this.spawnAgentForState(workflow, stateDef);
      } else {
        // System action
        await this.executeSystemAction(workflow, stateDef);
      }
    } catch (error) {
      console.error(`[Engine] Error in state ${workflow.state}:`, error);
      workflow.recordError(error);
    }

    this.persist();
  },

  // Spawn appropriate agent(s) for a state
  async spawnAgentForState(workflow, stateDef) {
    const agentType = stateDef.agent;
    
    if (agentType === 'swe-pool') {
      // Spawn multiple SWE agents based on task breakdown
      const tasks = workflow.data.taskBreakdown || [{ description: 'Implement feature' }];
      
      for (const task of tasks) {
        const agent = AgentOS.spawnAgent({
          type: 'swe',
          name: `SWE-${task.id || Math.random().toString(36).substr(2, 4)}`,
          context: {
            workflowId: workflow.id,
            task,
            state: workflow.state
          }
        });
        
        workflow.agents.set(agent.id, agent);
        
        // Inject task
        AgentOS.assignTask(agent.id, {
          type: stateDef.action,
          ...task,
          workflowContext: workflow.data
        });
      }
    } else {
      // Single specialist agent
      const agent = AgentOS.spawnAgent({
        type: agentType,
        name: `${agentType}-${workflow.id.slice(-4)}`,
        context: {
          workflowId: workflow.id,
          state: workflow.state
        }
      });
      
      workflow.agents.set(agent.id, agent);
      
      AgentOS.assignTask(agent.id, {
        type: stateDef.action,
        workflowData: workflow.data
      });
    }
  },

  // Execute non-agent actions
  async executeSystemAction(workflow, stateDef) {
    const action = stateDef.action;
    const actions = SystemActions[action];
    
    if (!actions) {
      console.warn(`[Engine] Unknown system action: ${action}`);
      return;
    }
    
    const result = await actions(workflow);
    
    if (result.nextState) {
      workflow.transition(result.nextState, result.data);
      await this.executeState(workflow);
    }
  },

  // Evaluate if workflow should transition
  async evaluateTransition(workflow) {
    const stateDef = WORKFLOW_STATES[workflow.state];
    
    // Clear timeout
    if (workflow._stateTimeout) {
      clearTimeout(workflow._stateTimeout);
      workflow._stateTimeout = null;
    }
    
    // Stop any polls for this state
    PollManager.stop(`${workflow.id}-${workflow.state}`);
    
    // Determine next state based on results
    const nextState = this.determineNextState(workflow, stateDef);
    
    if (nextState) {
      workflow.transition(nextState);
      await this.executeState(workflow);
    }
  },

  determineNextState(workflow, stateDef) {
    // If only one next state, use it
    if (stateDef.next.length === 1) {
      return stateDef.next[0];
    }
    
    // Check workflow data for routing hints
    if (workflow.data._nextState) {
      const next = workflow.data._nextState;
      delete workflow.data._nextState;
      return next;
    }
    
    // Default to first option (success path)
    return stateDef.next[0];
  },

  finalize(workflow) {
    // Cleanup
    if (workflow._cleanup) workflow._cleanup();
    PollManager.stopAll(workflow.id);
    
    // Kill all agents
    workflow.agents.forEach((agent, id) => {
      AgentOS.destroyAgent(id);
    });
    
    // Emit completion
    if (workflow.state === 'COMPLETED') {
      EventBus.emit('workflow:complete', {
        workflowId: workflow.id,
        duration: Date.now() - workflow.createdAt,
        summary: workflow.history
      });
    } else {
      EventBus.emit('workflow:error', {
        workflowId: workflow.id,
        error: workflow.error,
        state: workflow.state
      });
    }
    
    this.persist();
  },

  // Persistence
  persist() {
    const state = {};
    this.workflows.forEach((wf, id) => {
      state[id] = wf.toJSON();
    });
    localStorage.setItem('workflowEngine_state', JSON.stringify(state));
  },

  restore() {
    try {
      const saved = localStorage.getItem('workflowEngine_state');
      if (saved) {
        const state = JSON.parse(saved);
        console.log(`[Engine] Found ${Object.keys(state).length} persisted workflows`);
        // Optionally restore active workflows
      }
    } catch (e) {
      console.warn('[Engine] Could not restore state:', e);
    }
  },

  // Event emission
  emit(event, data) {
    EventBus.emit(event, data);
  },

  // Status
  status() {
    return Array.from(this.workflows.values()).map(wf => ({
      id: wf.id,
      type: wf.type,
      state: wf.state,
      agents: wf.agents.size,
      age: Math.round((Date.now() - wf.createdAt) / 1000) + 's'
    }));
  }
};
```

### 4.2 System Actions

```javascript
// system-actions.js
// Non-agent actions executed by the engine

const SystemActions = {
  
  // ===== INITIALIZATION =====
  
  async fetchJiraItem(workflow) {
    const item = await ExternalIntegrations.fetch('jira', 'get_item', {
      key: workflow.data.jiraKey
    });
    
    workflow.data.jiraItem = item;
    workflow.data.summary = item.fields.summary;
    workflow.data.description = item.fields.description;
    
    return { nextState: 'JIRA_FETCHED', data: { item } };
  },

  async createGitHubIssue(workflow) {
    const issue = await ExternalIntegrations.fetch('github', 'create_issue', {
      title: `[${workflow.data.jiraKey}] ${workflow.data.summary}`,
      body: workflow.data.description,
      labels: ['from-jira', workflow.data.jiraItem.fields.issuetype.name.toLowerCase()]
    });
    
    workflow.data.ghIssue = issue;
    
    return { nextState: 'GH_ISSUE_CREATED', data: { issue } };
  },

  async linkJiraGitHub(workflow) {
    // Add GitHub link to Jira
    await ExternalIntegrations.fetch('jira', 'add_comment', {
      key: workflow.data.jiraKey,
      comment: `GitHub Issue: ${workflow.data.ghIssue.html_url}`
    });
    
    return { nextState: 'LINKED' };
  },

  // ===== BUILD & DEPLOY =====

  async runTests(workflow) {
    // This starts the test run, actual waiting is done via polling
    console.log('[Action] Starting test suite...');
    workflow.data.testRunId = Date.now();
    return { nextState: 'TESTS_RUNNING' };
  },

  async awaitTestResults(workflow) {
    // Polling handles this - no immediate transition
    // The poll will emit events that trigger transition
    return { nextState: null };
  },

  async commitAndCreatePR(workflow) {
    // In reality, this would execute git commands
    // For now, we simulate
    const pr = await ExternalIntegrations.fetch('github', 'create_pr', {
      title: `[${workflow.data.jiraKey}] ${workflow.data.summary}`,
      body: `Implements ${workflow.data.jiraKey}\n\nChanges:\n${workflow.data.changesSummary || 'See commits'}`,
      head: workflow.data.branchName || `feature/${workflow.data.jiraKey.toLowerCase()}`,
      base: 'main'
    });
    
    workflow.data.prNumber = pr.number;
    workflow.data.prUrl = pr.html_url;
    
    return { nextState: 'PR_CREATED', data: { pr } };
  },

  async awaitPRApproval(workflow) {
    // Polling handles this
    return { nextState: null };
  },

  async mergePR(workflow) {
    await ExternalIntegrations.fetch('github', 'merge_pr', {
      prNumber: workflow.data.prNumber
    });
    
    return { nextState: 'MERGED' };
  },

  async awaitCIBuild(workflow) {
    // Polling handles this
    return { nextState: null };
  },

  async updateStatusToQA(workflow) {
    // Update Jira status
    await ExternalIntegrations.fetch('jira', 'update_status', {
      key: workflow.data.jiraKey,
      status: 'In QA'
    });
    
    // Close GitHub issue (or add label)
    // await ExternalIntegrations.fetch('github', 'add_label', { ... });
    
    return { nextState: 'IN_QA' };
  },

  async awaitPMApproval(workflow) {
    // Polling handles this
    return { nextState: null };
  },

  async closeAllItems(workflow) {
    // Close Jira
    await ExternalIntegrations.fetch('jira', 'update_status', {
      key: workflow.data.jiraKey,
      status: 'Done'
    });
    
    // Close GitHub issue
    await ExternalIntegrations.fetch('github', 'close_issue', {
      issueNumber: workflow.data.ghIssue.number
    });
    
    return { nextState: 'COMPLETED' };
  },

  async logCompletion(workflow) {
    console.log(`[Workflow] ${workflow.id} completed successfully!`);
    console.log(`Duration: ${Math.round((Date.now() - workflow.createdAt) / 60000)} minutes`);
    return { nextState: null };
  },

  async logError(workflow) {
    console.error(`[Workflow] ${workflow.id} failed:`, workflow.error);
    return { nextState: null };
  }
};
```

---

## Part 5: Command Interface

### 5.1 Slash Command Parser

```javascript
// command-parser.js
// Parses /implement-work-item and similar commands

const CommandParser = {
  commands: {},

  register(name, handler, options = {}) {
    this.commands[name] = { handler, options };
  },

  async parse(input) {
    const match = input.match(/^\/(\S+)\s*(.*)/);
    if (!match) return null;

    const [, command, args] = match;
    const cmd = this.commands[command];
    
    if (!cmd) {
      console.warn(`Unknown command: /${command}`);
      return null;
    }

    return cmd.handler(args.trim());
  }
};

// Register the implement-work-item command
CommandParser.register('implement-work-item', async (args) => {
  const jiraKey = args.split(/\s+/)[0];
  
  if (!jiraKey || !jiraKey.match(/^[A-Z]+-\d+$/)) {
    throw new Error('Invalid Jira key format. Expected: ABC-123');
  }

  console.log(`[Command] Starting implementation workflow for ${jiraKey}`);
  
  const workflow = await WorkflowEngine.start('implement-work-item', {
    jiraKey,
    startedAt: Date.now(),
    startedBy: 'user'
  });

  return {
    message: `Workflow ${workflow.id} started for ${jiraKey}`,
    workflow
  };
}, {
  description: 'Start full implementation workflow for a Jira item',
  usage: '/implement-work-item ABC-123'
});

// Additional commands
CommandParser.register('workflow-status', async (args) => {
  const workflows = WorkflowEngine.status();
  console.table(workflows);
  return { workflows };
});

CommandParser.register('poll-status', async (args) => {
  const polls = PollManager.status();
  console.table(polls);
  return { polls };
});
```

---

## Part 6: Integration with AgentOS

### 6.1 Updated Agent Signal Handling

```javascript
// Update the parseAgentOutput in AgentOS to handle workflow context

AgentOS.parseAgentOutput = function(agent, output) {
  const workflowId = agent.context?.workflowId;

  // Task completion
  if (output.includes('[TASK_COMPLETE]')) {
    agent.completeTask(output);
    agent.updateStatus('idle');
    
    // Emit to workflow engine
    EventBus.emit('agent:complete', {
      agentId: agent.id,
      output,
      workflowId
    });
  }

  // Error
  const errorMatch = output.match(/\[TASK_ERROR:\s*(.+?)\]/);
  if (errorMatch) {
    agent.updateStatus('error');
    
    EventBus.emit('agent:error', {
      agentId: agent.id,
      error: errorMatch[1],
      workflowId
    });
  }

  // Handoff (within workflow)
  const handoffMatch = output.match(/\[HANDOFF:\s*(\w+),\s*(.+?)\]/);
  if (handoffMatch) {
    EventBus.emit('agent:handoff', {
      fromAgent: agent.id,
      toType: handoffMatch[1],
      context: handoffMatch[2],
      workflowId
    });
  }

  // Set next state
  const nextStateMatch = output.match(/\[NEXT_STATE:\s*(\w+)\]/);
  if (nextStateMatch && workflowId) {
    const workflow = WorkflowEngine.workflows.get(workflowId);
    if (workflow) {
      workflow.data._nextState = nextStateMatch[1];
    }
  }

  // Context saves
  const contextMatch = output.match(/\[CONTEXT_SAVE:\s*(\w+)=(.+?)\]/g);
  if (contextMatch && workflowId) {
    const workflow = WorkflowEngine.workflows.get(workflowId);
    contextMatch.forEach(match => {
      const [, key, value] = match.match(/\[CONTEXT_SAVE:\s*(\w+)=(.+?)\]/);
      workflow.data[key] = value;
    });
  }
};
```

### 6.2 Workflow-Aware Rules

Update `.windsurf/rules/01-agent-signals.md`:

```markdown
# Agent Signal Protocol (Workflow-Aware)

When operating within a workflow (you'll see workflowId in your context):

## Completion Signals
- `[TASK_COMPLETE]` - Task finished successfully
- `[TASK_COMPLETE: summary]` - With summary for logging

## Error Signals
- `[TASK_ERROR: description]` - Task failed, triggers retry or escalation

## Workflow Control
- `[NEXT_STATE: STATE_NAME]` - Suggest next workflow state
  - Example: `[NEXT_STATE: TESTS_PASSED]` after verifying tests work
- `[NEEDS_HUMAN: question]` - Pause workflow for human input

## Context Persistence
- `[CONTEXT_SAVE: key=value]` - Save to workflow data
  - Example: `[CONTEXT_SAVE: branchName=feature/abc-123]`
  - Example: `[CONTEXT_SAVE: changesSummary=Added validation logic]`

## Agent Coordination
- `[HANDOFF: agent-type, context]` - Request specialist
  - Example: `[HANDOFF: debugger, test failure in auth.py:45]`
- `[SUBTASK: description]` - Spawn parallel subtask

## Workflow State Hints
When you complete a task that has multiple possible outcomes, indicate which:
- After tests: `[NEXT_STATE: TESTS_PASSED]` or `[NEXT_STATE: TESTS_FAILED]`
- After review: `[NEXT_STATE: REVIEW_APPROVED]` or `[NEXT_STATE: REVIEW_FEEDBACK]`
```

---

## Part 7: Complete Flow Diagram

```
/implement-work-item ABC-123
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           INIT                                          │
│  Action: fetchJiraItem (system)                                         │
│  • GET /rest/api/2/issue/ABC-123                                        │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        JIRA_FETCHED                                      │
│  Action: createGitHubIssue (system)                                     │
│  • POST /repos/:owner/:repo/issues                                      │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       GH_ISSUE_CREATED                                   │
│  Action: linkJiraGitHub (system)                                        │
│  • Add comment to Jira with GH link                                     │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           LINKED                                         │
│  Agent: team-lead                                                        │
│  Action: breakdownAndAssign                                             │
│  • Analyze requirements                                                  │
│  • Create task breakdown                                                 │
│  • Assign to SWE agents                                                  │
│  Output: [CONTEXT_SAVE: taskBreakdown=[...]]                            │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       TASKS_ASSIGNED                                     │
│  Action: notifyAgents (system)                                          │
│  • Spawns SWE agents per task                                           │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        IMPLEMENTING                                      │
│  Agents: swe-pool (parallel)                                            │
│  Action: implementFeature                                               │
│  Hooks: onAgentComplete, onAgentError                                   │
│  • Write code                                                            │
│  • Write unit tests                                                      │
│  • Write integration tests                                               │
│  Output: [TASK_COMPLETE] per agent                                      │
│                                                                          │
│  On Error: → IMPLEMENTATION_FAILED (retry up to 3x)                     │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │ (all agents complete)
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        TESTS_WRITTEN                                     │
│  Action: runTests (system)                                              │
│  • Execute: pytest / npm test                                           │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        TESTS_RUNNING                                     │
│  Action: awaitTestResults (polling)                                     │
│  Poll: terminal output every 10s                                        │
│  Hook: onPollResult                                                      │
│                                                                          │
│  On Success: → TESTS_PASSED                                             │
│  On Failure: → TESTS_FAILED (retry up to 3x)                            │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         TESTS_PASSED                                     │
│  Agent: team-lead                                                        │
│  Action: initiateReview                                                 │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          IN_REVIEW                                       │
│  Agent: team-lead                                                        │
│  Action: reviewCode                                                      │
│  • Check code quality                                                    │
│  • Verify tests coverage                                                 │
│  • Review architecture                                                   │
│                                                                          │
│  Output: [NEXT_STATE: REVIEW_APPROVED] or [NEXT_STATE: REVIEW_FEEDBACK] │
└─────────────┬──────────────────────────────────────────┬────────────────┘
              │                                          │
              ▼                                          ▼
┌─────────────────────────┐               ┌─────────────────────────────┐
│    REVIEW_FEEDBACK      │               │      REVIEW_APPROVED        │
│  Agent: swe-pool        │               │  Action: commitAndCreatePR  │
│  Action: addressFeedback│               │  • git commit               │
│  • Fix issues           │               │  • git push                 │
│  → back to IN_REVIEW    │               │  • Create PR via API        │
└─────────────────────────┘               └──────────────┬──────────────┘
                                                         │
                                                         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          PR_CREATED                                      │
│  Action: awaitPRApproval (polling)                                      │
│  Poll: GitHub PR status every 60s                                       │
│  Hook: onGitHubPRUpdate                                                  │
│                                                                          │
│  On Approved: → PR_APPROVED                                             │
│  On Changes Requested: → PR_FEEDBACK (→ back to PR_CREATED)             │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          PR_APPROVED                                     │
│  Action: mergePR (system)                                               │
│  • POST /repos/:owner/:repo/pulls/:pr/merge                             │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                            MERGED                                        │
│  Action: awaitCIBuild (polling)                                         │
│  Poll: Jenkins build status every 30s                                   │
│  Hook: onJenkinsBuild                                                    │
│                                                                          │
│  On Success: → BUILD_SUCCESS                                            │
│  On Failure: → BUILD_FAILED (→ debug → new PR, retry up to 2x)          │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         BUILD_SUCCESS                                    │
│  Action: updateStatusToQA (system)                                      │
│  • Jira: transition to "In QA"                                          │
│  • GitHub: add "in-qa" label                                            │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                            IN_QA                                         │
│  Agent: qa-engineer                                                      │
│  Action: runE2ETests                                                    │
│  • Execute E2E test suite                                               │
│  • Validate user flows                                                   │
│                                                                          │
│  On Pass: → QA_PASSED                                                   │
│  On Fail: → QA_FAILED (→ triage → back to IMPLEMENTING)                 │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           QA_PASSED                                      │
│  Agent: qa-engineer                                                      │
│  Action: generateEvidence                                               │
│  • Screenshots                                                           │
│  • Test reports                                                          │
│  • Coverage metrics                                                      │
│  • Attach to Jira                                                        │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      READY_FOR_PM_REVIEW                                 │
│  Action: awaitPMApproval (polling)                                      │
│  Poll: Jira status every 120s                                           │
│  Hook: onJiraUpdate                                                      │
│  • Jira: transition to "Ready for Review"                               │
│                                                                          │
│  On Accepted: → PM_APPROVED                                             │
│  On Rejected: → PM_REJECTED (→ triage → back to IMPLEMENTING or IN_QA)  │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          PM_APPROVED                                     │
│  Action: closeAllItems (system)                                         │
│  • Jira: transition to "Done"                                           │
│  • GitHub: close issue                                                   │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          COMPLETED ✓                                     │
│  Terminal state                                                          │
│  • Log completion metrics                                                │
│  • Clean up agents                                                       │
│  • Archive workflow                                                      │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Part 8: Usage Summary

### Starting a Workflow

```javascript
// In DevTools console after injecting AgentOS + WorkflowEngine

// Option 1: Via command
await CommandParser.parse('/implement-work-item ABC-123');

// Option 2: Direct API
await WorkflowEngine.start('implement-work-item', { jiraKey: 'ABC-123' });
```

### Monitoring

```javascript
// Check workflow status
WorkflowEngine.status();

// Check active polls
PollManager.status();

// Check agents
AgentOS.list();

// Inspect specific workflow
WorkflowEngine.workflows.get('wf-xxx');
```

### Manual Intervention

```javascript
// Force state transition
const wf = WorkflowEngine.workflows.get('wf-xxx');
wf.transition('TESTS_PASSED');
WorkflowEngine.executeState(wf);

// Stop a poll
PollManager.stop('wf-xxx-MERGED');

// Kill workflow
wf.transition('ERROR', { reason: 'Manual abort' });
```

---

## Summary

| Component | Purpose | Trigger |
|-----------|---------|---------|
| State Machine | Define workflow steps | State definitions |
| Event Bus | Decouple components | `EventBus.emit/on` |
| Hooks | React to events | `registerHook()` |
| Poll Manager | Watch external systems | State `poll` config |
| System Actions | Non-agent operations | State `action` |
| Agent Pool | Specialist execution | State `agent` |
| Command Parser | User interface | `/implement-work-item` |

This architecture gives you:
- **Hooks** for synchronous event reactions
- **Polling** for async external system monitoring  
- **State machine** for complex workflow orchestration
- **Persistence** surviving browser refresh
- **Retries** with configurable limits
- **Parallel execution** for independent tasks
- **Human-in-the-loop** via polling and `NEEDS_HUMAN` signals

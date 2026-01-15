# Agent Self-Improvement System

## The Problem

Currently, agents are static - their capabilities are defined once in rules files and never evolve. A truly autonomous system needs agents that:

1. **Learn from successes** - Reinforce patterns that work
2. **Learn from failures** - Avoid patterns that fail
3. **Accumulate domain knowledge** - Build expertise over time
4. **Refine their own prompts** - Improve their instructions
5. **Share learnings** - Cross-pollinate improvements across agent types

---

## Part 1: Self-Improvement Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        AGENT SELF-IMPROVEMENT LOOP                               │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                         EXECUTION LAYER                                  │   │
│  │                                                                          │   │
│  │   Task ──▶ Agent ──▶ Actions ──▶ Outcome ──▶ Feedback Signal           │   │
│  │              │                       │              │                    │   │
│  │              ▼                       ▼              ▼                    │   │
│  │         [Decisions]            [Results]      [Success/Fail]            │   │
│  └──────────────┬───────────────────────┬──────────────┬───────────────────┘   │
│                 │                       │              │                        │
│                 ▼                       ▼              ▼                        │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                         LEARNING LAYER                                   │   │
│  │                                                                          │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                  │   │
│  │  │  Decision    │  │   Outcome    │  │  Feedback    │                  │   │
│  │  │  Logger      │  │   Analyzer   │  │  Integrator  │                  │   │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘                  │   │
│  │         │                 │                 │                           │   │
│  │         └─────────────────┼─────────────────┘                           │   │
│  │                           ▼                                             │   │
│  │                  ┌──────────────────┐                                   │   │
│  │                  │  Pattern Miner   │                                   │   │
│  │                  └────────┬─────────┘                                   │   │
│  └───────────────────────────┼─────────────────────────────────────────────┘   │
│                              │                                                  │
│                              ▼                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                         IMPROVEMENT LAYER                                │   │
│  │                                                                          │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                  │   │
│  │  │   Prompt     │  │  Knowledge   │  │    Skill     │                  │   │
│  │  │   Refiner    │  │  Extractor   │  │  Generator   │                  │   │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘                  │   │
│  │         │                 │                 │                           │   │
│  │         ▼                 ▼                 ▼                           │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                  │   │
│  │  │ Agent Rules  │  │  Domain KB   │  │ Skill Store  │                  │   │
│  │  │ (updated)    │  │  (enriched)  │  │ (expanded)   │                  │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘                  │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Part 2: Feedback Signal Collection

### 2.1 Automatic Signals

```javascript
// feedback-collector.js
// Automatically collects success/failure signals from agent actions

const FeedbackCollector = {
  signals: [],
  
  // Hook into workflow transitions
  init() {
    // Success signals
    EventBus.on('workflow:transition', (event) => {
      this.recordTransition(event);
    });
    
    // Failure signals
    EventBus.on('agent:error', (event) => {
      this.recordFailure(event);
    });
    
    // Retry signals (partial failure)
    EventBus.on('workflow:retry', (event) => {
      this.recordRetry(event);
    });
    
    // Completion signals
    EventBus.on('workflow:complete', (event) => {
      this.recordSuccess(event);
    });
    
    // Test results
    EventBus.on('tests:result', (event) => {
      this.recordTestOutcome(event);
    });
    
    // PR feedback
    EventBus.on('pr:feedback', (event) => {
      this.recordPRFeedback(event);
    });
    
    // Build results
    EventBus.on('build:result', (event) => {
      this.recordBuildOutcome(event);
    });
  },

  recordTransition(event) {
    const { workflowId, from, to, data } = event;
    const workflow = WorkflowEngine.get(workflowId);
    
    // Get the agent that caused this transition
    const agentId = workflow?.data?._lastAgent;
    if (!agentId) return;
    
    this.signals.push({
      type: 'transition',
      agentId,
      agentType: AgentOS.agents.get(agentId)?.type,
      from,
      to,
      success: !to.includes('FAILED') && !to.includes('ERROR'),
      timestamp: Date.now(),
      context: {
        workflowType: workflow.type,
        taskDescription: workflow.data.summary
      }
    });
  },

  recordFailure(event) {
    const { agentId, error, workflowId } = event;
    const agent = AgentOS.agents.get(agentId);
    
    this.signals.push({
      type: 'failure',
      agentId,
      agentType: agent?.type,
      error: error,
      timestamp: Date.now(),
      context: {
        workflowId,
        state: WorkflowEngine.get(workflowId)?.state,
        lastTask: agent?.taskHistory?.slice(-1)[0]
      }
    });
  },

  recordSuccess(event) {
    const { workflowId, duration } = event;
    const workflow = WorkflowEngine.get(workflowId);
    
    // Credit all agents that participated
    workflow.agents.forEach((_, agentId) => {
      this.signals.push({
        type: 'workflow_success',
        agentId,
        agentType: AgentOS.agents.get(agentId)?.type,
        duration,
        timestamp: Date.now(),
        context: {
          workflowType: workflow.type,
          stateCount: workflow.history.length,
          retryCount: Object.values(workflow.retries).reduce((a, b) => a + b, 0)
        }
      });
    });
  },

  recordTestOutcome(event) {
    const { passed, failed, agentId, testType } = event;
    
    this.signals.push({
      type: 'test_result',
      agentId,
      agentType: 'swe',
      success: failed === 0,
      metrics: { passed, failed },
      testType, // 'unit', 'integration', 'e2e'
      timestamp: Date.now()
    });
  },

  recordPRFeedback(event) {
    const { agentId, approved, comments, requestedChanges } = event;
    
    this.signals.push({
      type: 'pr_review',
      agentId,
      agentType: 'swe',
      success: approved,
      feedback: {
        approved,
        commentCount: comments?.length || 0,
        changeRequests: requestedChanges || []
      },
      timestamp: Date.now()
    });
  },

  recordBuildOutcome(event) {
    const { agentId, result, failureReason } = event;
    
    this.signals.push({
      type: 'build_result',
      agentId,
      agentType: 'swe',
      success: result === 'SUCCESS',
      failureReason,
      timestamp: Date.now()
    });
  },

  // Get signals for a specific agent type
  getSignalsForType(agentType, limit = 100) {
    return this.signals
      .filter(s => s.agentType === agentType)
      .slice(-limit);
  },

  // Calculate success rate
  getSuccessRate(agentType, timeWindowMs = 86400000) { // Default 24h
    const cutoff = Date.now() - timeWindowMs;
    const relevant = this.signals.filter(s => 
      s.agentType === agentType && 
      s.timestamp > cutoff &&
      s.type !== 'transition' // Only count terminal events
    );
    
    if (relevant.length === 0) return null;
    
    const successes = relevant.filter(s => s.success).length;
    return {
      rate: successes / relevant.length,
      total: relevant.length,
      successes
    };
  },

  // Persist signals
  persist() {
    localStorage.setItem('agentOS_feedback_signals', JSON.stringify(this.signals.slice(-1000)));
  },

  restore() {
    const saved = localStorage.getItem('agentOS_feedback_signals');
    if (saved) {
      this.signals = JSON.parse(saved);
    }
  }
};
```

### 2.2 Human Feedback Integration

```javascript
// human-feedback.js
// Captures explicit human feedback on agent outputs

const HumanFeedback = {
  pendingFeedback: new Map(),
  collectedFeedback: [],

  // Request feedback on agent output
  requestFeedback(agentId, outputId, output) {
    const feedbackId = `fb-${Date.now()}`;
    
    this.pendingFeedback.set(feedbackId, {
      agentId,
      outputId,
      output: output.slice(0, 1000), // Truncate for storage
      requestedAt: Date.now()
    });
    
    // Show feedback UI
    this.showFeedbackPrompt(feedbackId, output);
    
    return feedbackId;
  },

  showFeedbackPrompt(feedbackId, output) {
    console.log(`
%c╔════════════════════════════════════════════════════════════════╗
║  📝 FEEDBACK REQUESTED                                          ║
╠════════════════════════════════════════════════════════════════╣
║  Rate this agent output:                                        ║
║                                                                 ║
║  HumanFeedback.rate('${feedbackId}', {                    ║
║    quality: 1-5,        // Overall quality                      ║
║    correctness: 1-5,    // Was it correct?                      ║
║    helpfulness: 1-5,    // Was it helpful?                      ║
║    comment: "..."       // Optional feedback                    ║
║  });                                                            ║
╚════════════════════════════════════════════════════════════════╝`,
      'color: #4caf50; font-family: monospace;'
    );
  },

  // Submit rating
  rate(feedbackId, rating) {
    const pending = this.pendingFeedback.get(feedbackId);
    if (!pending) {
      console.error('Feedback request not found:', feedbackId);
      return;
    }
    
    const feedback = {
      ...pending,
      rating,
      ratedAt: Date.now()
    };
    
    this.collectedFeedback.push(feedback);
    this.pendingFeedback.delete(feedbackId);
    
    // Trigger learning
    EventBus.emit('feedback:received', feedback);
    
    console.log('✓ Feedback recorded. Thank you!');
    this.persist();
  },

  // Quick thumbs up/down
  thumbsUp(agentId) {
    this.collectedFeedback.push({
      agentId,
      rating: { quality: 5, correctness: 5, helpfulness: 5 },
      quick: true,
      ratedAt: Date.now()
    });
    EventBus.emit('feedback:received', { agentId, positive: true });
  },

  thumbsDown(agentId, reason = '') {
    this.collectedFeedback.push({
      agentId,
      rating: { quality: 1, correctness: 1, helpfulness: 1 },
      reason,
      quick: true,
      ratedAt: Date.now()
    });
    EventBus.emit('feedback:received', { agentId, positive: false, reason });
  },

  persist() {
    localStorage.setItem('agentOS_human_feedback', JSON.stringify(this.collectedFeedback.slice(-500)));
  },

  restore() {
    const saved = localStorage.getItem('agentOS_human_feedback');
    if (saved) {
      this.collectedFeedback = JSON.parse(saved);
    }
  }
};
```

---

## Part 3: Decision Logging & Pattern Mining

### 3.1 Decision Logger

Each agent logs key decisions for later analysis:

```javascript
// decision-logger.js
// Logs agent decisions with context for pattern analysis

const DecisionLogger = {
  decisions: [],

  // Log a decision point
  log(agentId, decision) {
    const agent = AgentOS.agents.get(agentId);
    
    const entry = {
      id: `dec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      agentId,
      agentType: agent?.type,
      timestamp: Date.now(),
      
      // What was decided
      decision: {
        type: decision.type,        // 'action', 'approach', 'tool', 'delegation'
        choice: decision.choice,    // What was chosen
        alternatives: decision.alternatives || [], // What else was considered
        reasoning: decision.reasoning || ''  // Why this choice
      },
      
      // Context at decision time
      context: {
        task: decision.task,
        state: decision.state,
        previousDecisions: this.getRecentForAgent(agentId, 5),
        workflowState: decision.workflowState
      },
      
      // Outcome (filled in later)
      outcome: null
    };
    
    this.decisions.push(entry);
    return entry.id;
  },

  // Update decision with outcome
  recordOutcome(decisionId, outcome) {
    const decision = this.decisions.find(d => d.id === decisionId);
    if (decision) {
      decision.outcome = {
        success: outcome.success,
        metrics: outcome.metrics || {},
        feedback: outcome.feedback || null,
        recordedAt: Date.now()
      };
    }
  },

  // Get recent decisions for an agent
  getRecentForAgent(agentId, limit = 10) {
    return this.decisions
      .filter(d => d.agentId === agentId)
      .slice(-limit);
  },

  // Get decisions by type
  getByType(agentType, decisionType, limit = 50) {
    return this.decisions
      .filter(d => d.agentType === agentType && d.decision.type === decisionType)
      .slice(-limit);
  },

  // Export for analysis
  exportForAnalysis(agentType) {
    return this.decisions
      .filter(d => d.agentType === agentType && d.outcome !== null)
      .map(d => ({
        choice: d.decision.choice,
        context: d.context.task,
        success: d.outcome.success,
        reasoning: d.decision.reasoning
      }));
  },

  persist() {
    localStorage.setItem('agentOS_decisions', JSON.stringify(this.decisions.slice(-2000)));
  },

  restore() {
    const saved = localStorage.getItem('agentOS_decisions');
    if (saved) {
      this.decisions = JSON.parse(saved);
    }
  }
};
```

### 3.2 Pattern Miner

```javascript
// pattern-miner.js
// Discovers successful and failing patterns from decision history

const PatternMiner = {
  
  // Find patterns that correlate with success
  mineSuccessPatterns(agentType) {
    const decisions = DecisionLogger.exportForAnalysis(agentType);
    
    // Group by decision type
    const byChoice = new Map();
    
    for (const d of decisions) {
      const key = `${d.choice}`;
      if (!byChoice.has(key)) {
        byChoice.set(key, { successes: 0, failures: 0, contexts: [] });
      }
      const stats = byChoice.get(key);
      if (d.success) {
        stats.successes++;
      } else {
        stats.failures++;
      }
      stats.contexts.push(d.context);
    }
    
    // Calculate success rates
    const patterns = [];
    byChoice.forEach((stats, choice) => {
      const total = stats.successes + stats.failures;
      if (total >= 3) { // Minimum sample size
        patterns.push({
          choice,
          successRate: stats.successes / total,
          sampleSize: total,
          commonContexts: this.findCommonTerms(stats.contexts)
        });
      }
    });
    
    // Sort by success rate
    return patterns.sort((a, b) => b.successRate - a.successRate);
  },

  // Find patterns that correlate with failure
  mineFailurePatterns(agentType) {
    const successPatterns = this.mineSuccessPatterns(agentType);
    return successPatterns
      .filter(p => p.successRate < 0.5)
      .sort((a, b) => a.successRate - b.successRate);
  },

  // Find common terms in contexts
  findCommonTerms(contexts) {
    const termCounts = new Map();
    
    for (const ctx of contexts) {
      const terms = ctx.toLowerCase().split(/\s+/);
      const seen = new Set();
      
      for (const term of terms) {
        if (term.length > 3 && !seen.has(term)) {
          seen.add(term);
          termCounts.set(term, (termCounts.get(term) || 0) + 1);
        }
      }
    }
    
    // Return terms that appear in >50% of contexts
    const threshold = contexts.length * 0.5;
    return Array.from(termCounts.entries())
      .filter(([_, count]) => count >= threshold)
      .map(([term, _]) => term);
  },

  // Find sequences of decisions that lead to success/failure
  mineDecisionSequences(agentType, sequenceLength = 3) {
    const decisions = DecisionLogger.decisions.filter(d => 
      d.agentType === agentType && d.outcome !== null
    );
    
    const sequences = new Map();
    
    // Group by agent session
    const byAgent = new Map();
    for (const d of decisions) {
      if (!byAgent.has(d.agentId)) {
        byAgent.set(d.agentId, []);
      }
      byAgent.get(d.agentId).push(d);
    }
    
    // Extract sequences
    byAgent.forEach(agentDecisions => {
      agentDecisions.sort((a, b) => a.timestamp - b.timestamp);
      
      for (let i = 0; i <= agentDecisions.length - sequenceLength; i++) {
        const seq = agentDecisions.slice(i, i + sequenceLength);
        const key = seq.map(d => d.decision.choice).join(' -> ');
        const lastOutcome = seq[seq.length - 1].outcome;
        
        if (!sequences.has(key)) {
          sequences.set(key, { successes: 0, failures: 0 });
        }
        
        if (lastOutcome.success) {
          sequences.get(key).successes++;
        } else {
          sequences.get(key).failures++;
        }
      }
    });
    
    // Convert to patterns
    const patterns = [];
    sequences.forEach((stats, sequence) => {
      const total = stats.successes + stats.failures;
      if (total >= 2) {
        patterns.push({
          sequence,
          successRate: stats.successes / total,
          sampleSize: total
        });
      }
    });
    
    return patterns.sort((a, b) => b.successRate - a.successRate);
  },

  // Generate improvement recommendations
  generateRecommendations(agentType) {
    const successPatterns = this.mineSuccessPatterns(agentType);
    const failurePatterns = this.mineFailurePatterns(agentType);
    const sequences = this.mineDecisionSequences(agentType);
    
    return {
      // Things to do more of
      reinforce: successPatterns
        .filter(p => p.successRate > 0.8 && p.sampleSize >= 5)
        .map(p => ({
          pattern: p.choice,
          confidence: p.successRate,
          recommendation: `Continue using "${p.choice}" - ${Math.round(p.successRate * 100)}% success rate`
        })),
      
      // Things to avoid
      avoid: failurePatterns
        .filter(p => p.successRate < 0.3 && p.sampleSize >= 3)
        .map(p => ({
          pattern: p.choice,
          failureRate: 1 - p.successRate,
          recommendation: `Avoid "${p.choice}" - ${Math.round((1 - p.successRate) * 100)}% failure rate`
        })),
      
      // Successful sequences to replicate
      sequences: sequences
        .filter(s => s.successRate > 0.7 && s.sampleSize >= 3)
        .slice(0, 5)
        .map(s => ({
          sequence: s.sequence,
          confidence: s.successRate,
          recommendation: `This decision sequence works well`
        }))
    };
  }
};
```

---

## Part 4: Prompt Refiner (Agent Rules Evolution)

### 4.1 Rule Update Engine

```javascript
// prompt-refiner.js
// Automatically updates agent rules based on learned patterns

const PromptRefiner = {
  
  // Generate rule updates from patterns
  async generateRuleUpdates(agentType) {
    const recommendations = PatternMiner.generateRecommendations(agentType);
    const currentRules = await this.loadCurrentRules(agentType);
    
    const updates = {
      additions: [],
      modifications: [],
      removals: []
    };
    
    // Add reinforcement rules
    for (const r of recommendations.reinforce) {
      if (!this.ruleExists(currentRules, r.pattern)) {
        updates.additions.push({
          section: 'best_practices',
          content: `- **Preferred**: ${r.pattern} (${Math.round(r.confidence * 100)}% success rate from ${r.sampleSize || 'multiple'} instances)`,
          reasoning: r.recommendation
        });
      }
    }
    
    // Add avoidance rules
    for (const a of recommendations.avoid) {
      if (!this.ruleExists(currentRules, `avoid.*${a.pattern}`)) {
        updates.additions.push({
          section: 'anti_patterns',
          content: `- **Avoid**: ${a.pattern} (${Math.round(a.failureRate * 100)}% failure rate)`,
          reasoning: a.recommendation
        });
      }
    }
    
    // Add sequence recommendations
    for (const s of recommendations.sequences) {
      updates.additions.push({
        section: 'workflows',
        content: `- **Effective sequence**: ${s.sequence}`,
        reasoning: s.recommendation
      });
    }
    
    return updates;
  },

  // Load current rules for an agent type
  async loadCurrentRules(agentType) {
    // In practice, read from .windsurf/rules/agents/{agentType}.md
    const rulesPath = `/memory-bank/agent-rules/${agentType}.md`;
    
    try {
      // Simulated - would use actual file read
      return localStorage.getItem(`rules_${agentType}`) || '';
    } catch (e) {
      return '';
    }
  },

  // Check if rule already exists
  ruleExists(rules, pattern) {
    const regex = new RegExp(pattern, 'i');
    return regex.test(rules);
  },

  // Apply updates to rules
  async applyUpdates(agentType, updates) {
    let currentRules = await this.loadCurrentRules(agentType);
    
    // Add new sections if needed
    if (updates.additions.length > 0) {
      const bySection = {};
      for (const add of updates.additions) {
        if (!bySection[add.section]) {
          bySection[add.section] = [];
        }
        bySection[add.section].push(add.content);
      }
      
      for (const [section, items] of Object.entries(bySection)) {
        const sectionHeader = `\n\n## ${this.formatSectionName(section)} (Auto-Generated)\n\n`;
        const sectionContent = items.join('\n');
        
        // Check if section exists
        const sectionRegex = new RegExp(`## ${this.formatSectionName(section)}`, 'i');
        if (sectionRegex.test(currentRules)) {
          // Append to existing section
          currentRules = currentRules.replace(
            sectionRegex,
            `## ${this.formatSectionName(section)}\n\n${sectionContent}\n`
          );
        } else {
          // Add new section
          currentRules += sectionHeader + sectionContent;
        }
      }
    }
    
    // Save updated rules
    localStorage.setItem(`rules_${agentType}`, currentRules);
    
    // Log the update
    console.log(`[PromptRefiner] Updated rules for ${agentType}:`);
    console.log(`  - ${updates.additions.length} additions`);
    console.log(`  - ${updates.modifications.length} modifications`);
    console.log(`  - ${updates.removals.length} removals`);
    
    return currentRules;
  },

  formatSectionName(section) {
    return section
      .split('_')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  },

  // Generate the actual rule markdown
  generateRuleMarkdown(agentType, updates) {
    const timestamp = new Date().toISOString();
    
    let markdown = `\n\n---\n\n## Learned Patterns (Updated: ${timestamp})\n\n`;
    markdown += `*These rules were automatically generated from ${PatternMiner.mineSuccessPatterns(agentType).reduce((a, p) => a + (p.sampleSize || 0), 0)} observed decisions.*\n\n`;
    
    if (updates.additions.filter(a => a.section === 'best_practices').length > 0) {
      markdown += `### Best Practices\n\n`;
      for (const add of updates.additions.filter(a => a.section === 'best_practices')) {
        markdown += `${add.content}\n`;
      }
      markdown += '\n';
    }
    
    if (updates.additions.filter(a => a.section === 'anti_patterns').length > 0) {
      markdown += `### Anti-Patterns to Avoid\n\n`;
      for (const add of updates.additions.filter(a => a.section === 'anti_patterns')) {
        markdown += `${add.content}\n`;
      }
      markdown += '\n';
    }
    
    if (updates.additions.filter(a => a.section === 'workflows').length > 0) {
      markdown += `### Effective Workflows\n\n`;
      for (const add of updates.additions.filter(a => a.section === 'workflows')) {
        markdown += `${add.content}\n`;
      }
    }
    
    return markdown;
  }
};
```

---

## Part 5: Domain Knowledge Extraction

### 5.1 Knowledge Extractor

```javascript
// knowledge-extractor.js
// Extracts domain-specific knowledge from successful agent interactions

const KnowledgeExtractor = {
  
  // Extract knowledge from a successful task completion
  async extractFromSuccess(agentId, taskContext, output) {
    const agent = AgentOS.agents.get(agentId);
    const agentType = agent?.type;
    
    const knowledge = {
      id: `know-${Date.now()}`,
      agentType,
      source: 'task_success',
      extractedAt: Date.now(),
      
      // What was the task
      task: {
        type: taskContext.type,
        description: taskContext.description,
        domain: this.inferDomain(taskContext)
      },
      
      // What was learned
      insights: await this.extractInsights(taskContext, output),
      
      // Code patterns (for SWE agents)
      codePatterns: agentType === 'swe' ? this.extractCodePatterns(output) : [],
      
      // Test patterns (for QA agents)
      testPatterns: agentType === 'qa' ? this.extractTestPatterns(output) : [],
      
      // Workflow patterns (for team-lead agents)
      workflowPatterns: agentType === 'team-lead' ? this.extractWorkflowPatterns(output) : []
    };
    
    // Store in knowledge base
    await KnowledgeBase.put('domain_knowledge', knowledge);
    
    return knowledge;
  },

  inferDomain(taskContext) {
    const text = `${taskContext.type} ${taskContext.description}`.toLowerCase();
    
    const domains = {
      'authentication': ['auth', 'login', 'sso', 'oauth', 'jwt', 'session'],
      'database': ['sql', 'query', 'migration', 'schema', 'orm', 'database'],
      'api': ['endpoint', 'rest', 'graphql', 'api', 'request', 'response'],
      'frontend': ['component', 'react', 'css', 'ui', 'button', 'form'],
      'testing': ['test', 'spec', 'mock', 'assert', 'coverage'],
      'devops': ['deploy', 'ci', 'cd', 'docker', 'kubernetes', 'pipeline'],
      'performance': ['optimize', 'cache', 'latency', 'throughput', 'memory']
    };
    
    for (const [domain, keywords] of Object.entries(domains)) {
      if (keywords.some(k => text.includes(k))) {
        return domain;
      }
    }
    
    return 'general';
  },

  async extractInsights(taskContext, output) {
    // Parse output for learnable insights
    const insights = [];
    
    // Look for explicit learnings
    const learningPatterns = [
      /learned:?\s*(.+)/gi,
      /note:?\s*(.+)/gi,
      /important:?\s*(.+)/gi,
      /remember:?\s*(.+)/gi,
      /tip:?\s*(.+)/gi
    ];
    
    for (const pattern of learningPatterns) {
      let match;
      while ((match = pattern.exec(output)) !== null) {
        insights.push({
          type: 'explicit',
          content: match[1].trim()
        });
      }
    }
    
    // Look for problem-solution pairs
    const problemMatch = output.match(/problem:?\s*(.+?)(?:solution|fix|resolve)/is);
    const solutionMatch = output.match(/(?:solution|fix|resolve):?\s*(.+?)(?:\n\n|$)/is);
    
    if (problemMatch && solutionMatch) {
      insights.push({
        type: 'problem_solution',
        problem: problemMatch[1].trim(),
        solution: solutionMatch[1].trim()
      });
    }
    
    return insights;
  },

  extractCodePatterns(output) {
    const patterns = [];
    
    // Extract code blocks
    const codeBlocks = output.match(/```[\s\S]*?```/g) || [];
    
    for (const block of codeBlocks) {
      const langMatch = block.match(/```(\w+)/);
      const code = block.replace(/```\w*\n?/, '').replace(/```$/, '');
      
      patterns.push({
        language: langMatch?.[1] || 'unknown',
        code: code.slice(0, 500), // Truncate
        type: this.inferCodePatternType(code)
      });
    }
    
    return patterns;
  },

  inferCodePatternType(code) {
    if (code.includes('async') || code.includes('await') || code.includes('Promise')) {
      return 'async_pattern';
    }
    if (code.includes('try') && code.includes('catch')) {
      return 'error_handling';
    }
    if (code.includes('interface') || code.includes('type ')) {
      return 'type_definition';
    }
    if (code.includes('test(') || code.includes('it(') || code.includes('describe(')) {
      return 'test_pattern';
    }
    if (code.includes('useState') || code.includes('useEffect')) {
      return 'react_hook';
    }
    return 'general';
  },

  extractTestPatterns(output) {
    const patterns = [];
    
    // Look for test structure patterns
    if (output.includes('describe(') && output.includes('it(')) {
      patterns.push({ type: 'bdd_structure', framework: 'jest/mocha' });
    }
    if (output.includes('pytest') || output.includes('def test_')) {
      patterns.push({ type: 'pytest_structure', framework: 'pytest' });
    }
    
    // Look for assertion patterns
    const assertions = output.match(/expect\(.+\)\..+/g) || [];
    patterns.push(...assertions.slice(0, 5).map(a => ({
      type: 'assertion',
      pattern: a
    })));
    
    return patterns;
  },

  extractWorkflowPatterns(output) {
    const patterns = [];
    
    // Look for task breakdown patterns
    const taskList = output.match(/(?:task|step)\s*\d+[.:]\s*.+/gi) || [];
    if (taskList.length > 0) {
      patterns.push({
        type: 'task_breakdown',
        steps: taskList.length,
        example: taskList.slice(0, 3)
      });
    }
    
    // Look for delegation patterns
    const delegations = output.match(/(?:assign|delegate)\s+to\s+(\w+)/gi) || [];
    if (delegations.length > 0) {
      patterns.push({
        type: 'delegation',
        targets: [...new Set(delegations)]
      });
    }
    
    return patterns;
  },

  // Query knowledge for a specific domain
  async queryKnowledge(agentType, domain, limit = 10) {
    const allKnowledge = await KnowledgeBase.getAll('domain_knowledge');
    
    return allKnowledge
      .filter(k => k.agentType === agentType && k.task.domain === domain)
      .sort((a, b) => b.extractedAt - a.extractedAt)
      .slice(0, limit);
  },

  // Generate knowledge summary for agent context
  async generateKnowledgeSummary(agentType) {
    const knowledge = await KnowledgeBase.getAll('domain_knowledge');
    const agentKnowledge = knowledge.filter(k => k.agentType === agentType);
    
    // Group by domain
    const byDomain = {};
    for (const k of agentKnowledge) {
      const domain = k.task.domain;
      if (!byDomain[domain]) {
        byDomain[domain] = [];
      }
      byDomain[domain].push(k);
    }
    
    // Generate summary
    let summary = `## Domain Knowledge for ${agentType} Agent\n\n`;
    
    for (const [domain, items] of Object.entries(byDomain)) {
      summary += `### ${domain}\n\n`;
      
      // Top insights
      const insights = items.flatMap(i => i.insights).slice(0, 5);
      if (insights.length > 0) {
        summary += `**Key Insights:**\n`;
        for (const insight of insights) {
          if (insight.type === 'explicit') {
            summary += `- ${insight.content}\n`;
          } else if (insight.type === 'problem_solution') {
            summary += `- Problem: ${insight.problem.slice(0, 100)}...\n`;
            summary += `  Solution: ${insight.solution.slice(0, 100)}...\n`;
          }
        }
        summary += '\n';
      }
    }
    
    return summary;
  }
};
```

---

## Part 6: Continuous Improvement Loop

### 6.1 Improvement Scheduler

```javascript
// improvement-scheduler.js
// Orchestrates the continuous improvement process

const ImprovementScheduler = {
  config: {
    minDecisionsForAnalysis: 20,
    analysisIntervalMs: 3600000, // 1 hour
    autoApplyThreshold: 0.9, // Confidence threshold for auto-applying
    requireApprovalFor: ['modifications', 'removals']
  },

  lastAnalysis: {},
  pendingImprovements: [],

  // Start the improvement loop
  start() {
    console.log('[ImprovementScheduler] Starting continuous improvement loop');
    
    // Run initial analysis
    this.runAnalysis();
    
    // Schedule periodic analysis
    setInterval(() => this.runAnalysis(), this.config.analysisIntervalMs);
    
    // Listen for workflow completions to trigger immediate learning
    EventBus.on('workflow:complete', (event) => {
      this.learnFromWorkflow(event.workflowId);
    });
  },

  async runAnalysis() {
    console.log('[ImprovementScheduler] Running improvement analysis...');
    
    const agentTypes = ['swe', 'qa', 'team-lead', 'debugger', 'researcher'];
    
    for (const agentType of agentTypes) {
      // Check if we have enough data
      const signals = FeedbackCollector.getSignalsForType(agentType);
      if (signals.length < this.config.minDecisionsForAnalysis) {
        console.log(`[ImprovementScheduler] Skipping ${agentType} - insufficient data (${signals.length}/${this.config.minDecisionsForAnalysis})`);
        continue;
      }
      
      // Generate recommendations
      const recommendations = PatternMiner.generateRecommendations(agentType);
      
      // Generate rule updates
      const updates = await PromptRefiner.generateRuleUpdates(agentType);
      
      // Check for high-confidence improvements
      const highConfidence = updates.additions.filter(u => 
        !this.config.requireApprovalFor.includes(u.section)
      );
      
      if (highConfidence.length > 0) {
        console.log(`[ImprovementScheduler] Auto-applying ${highConfidence.length} improvements for ${agentType}`);
        await PromptRefiner.applyUpdates(agentType, { additions: highConfidence, modifications: [], removals: [] });
      }
      
      // Queue others for approval
      const needsApproval = updates.additions.filter(u =>
        this.config.requireApprovalFor.includes(u.section)
      );
      
      if (needsApproval.length > 0) {
        this.pendingImprovements.push({
          agentType,
          updates: needsApproval,
          generatedAt: Date.now()
        });
        
        console.log(`[ImprovementScheduler] ${needsApproval.length} improvements pending approval for ${agentType}`);
      }
      
      // Generate domain knowledge summary
      const knowledgeSummary = await KnowledgeExtractor.generateKnowledgeSummary(agentType);
      localStorage.setItem(`knowledge_summary_${agentType}`, knowledgeSummary);
      
      this.lastAnalysis[agentType] = Date.now();
    }
    
    this.reportStatus();
  },

  async learnFromWorkflow(workflowId) {
    const workflow = WorkflowEngine.get(workflowId);
    if (!workflow) return;
    
    // Extract learnings from each agent that participated
    for (const [agentId, _] of workflow.agents) {
      const agent = AgentOS.agents.get(agentId);
      if (!agent) continue;
      
      // Get agent's output history
      const outputs = agent.outputHistory || [];
      const lastOutput = outputs[outputs.length - 1];
      
      if (lastOutput && workflow.state === 'COMPLETED') {
        await KnowledgeExtractor.extractFromSuccess(
          agentId,
          { type: workflow.type, description: workflow.data.summary },
          lastOutput
        );
      }
    }
  },

  // Review and approve pending improvements
  reviewPending() {
    if (this.pendingImprovements.length === 0) {
      console.log('[ImprovementScheduler] No pending improvements');
      return;
    }
    
    console.log('\n📋 PENDING IMPROVEMENTS:\n');
    
    this.pendingImprovements.forEach((item, idx) => {
      console.log(`[${idx}] ${item.agentType} (${item.updates.length} changes):`);
      item.updates.forEach(u => {
        console.log(`    - ${u.section}: ${u.content.slice(0, 60)}...`);
      });
      console.log();
    });
    
    console.log('To approve: ImprovementScheduler.approve(index)');
    console.log('To reject:  ImprovementScheduler.reject(index)');
    console.log('To approve all: ImprovementScheduler.approveAll()');
  },

  async approve(index) {
    const item = this.pendingImprovements[index];
    if (!item) {
      console.error('Invalid index');
      return;
    }
    
    await PromptRefiner.applyUpdates(item.agentType, {
      additions: item.updates,
      modifications: [],
      removals: []
    });
    
    this.pendingImprovements.splice(index, 1);
    console.log('✓ Approved and applied');
  },

  reject(index) {
    const item = this.pendingImprovements[index];
    if (!item) {
      console.error('Invalid index');
      return;
    }
    
    this.pendingImprovements.splice(index, 1);
    console.log('✓ Rejected');
  },

  async approveAll() {
    for (let i = this.pendingImprovements.length - 1; i >= 0; i--) {
      await this.approve(i);
    }
  },

  reportStatus() {
    const stats = {};
    
    for (const [agentType, timestamp] of Object.entries(this.lastAnalysis)) {
      const successRate = FeedbackCollector.getSuccessRate(agentType);
      stats[agentType] = {
        lastAnalysis: new Date(timestamp).toISOString(),
        successRate: successRate ? `${Math.round(successRate.rate * 100)}%` : 'N/A',
        sampleSize: successRate?.total || 0
      };
    }
    
    console.log('\n📊 IMPROVEMENT STATUS:\n');
    console.table(stats);
    console.log(`Pending improvements: ${this.pendingImprovements.length}`);
  }
};
```

---

## Part 7: Putting It All Together

### 7.1 Self-Improvement Bundle

```javascript
// self-improvement-bundle.js
// Inject after other AgentOS bundles

(function() {
  'use strict';

  // Initialize all components
  FeedbackCollector.init();
  FeedbackCollector.restore();
  DecisionLogger.restore();
  HumanFeedback.restore();

  // Hook agent outputs for automatic learning
  const originalParseOutput = AgentOS.parseAgentOutput;
  AgentOS.parseAgentOutput = function(agent, output) {
    // Call original
    if (originalParseOutput) {
      originalParseOutput.call(this, agent, output);
    }
    
    // Log any decisions
    const decisionMatch = output.match(/\[DECISION:\s*(\w+)\s*=\s*(.+?)\]/g);
    if (decisionMatch) {
      for (const match of decisionMatch) {
        const [, type, choice] = match.match(/\[DECISION:\s*(\w+)\s*=\s*(.+?)\]/);
        DecisionLogger.log(agent.id, {
          type,
          choice,
          task: agent.currentTask?.description
        });
      }
    }
    
    // Store output for knowledge extraction
    if (!agent.outputHistory) agent.outputHistory = [];
    agent.outputHistory.push(output);
    if (agent.outputHistory.length > 10) {
      agent.outputHistory.shift();
    }
  };

  // Start improvement scheduler
  ImprovementScheduler.start();

  // Register commands
  if (window.CommandParser) {
    CommandParser.register('improve-status', () => {
      ImprovementScheduler.reportStatus();
    }, 'Show self-improvement status');

    CommandParser.register('review-improvements', () => {
      ImprovementScheduler.reviewPending();
    }, 'Review pending improvements');

    CommandParser.register('success-rates', () => {
      const types = ['swe', 'qa', 'team-lead', 'debugger'];
      const rates = {};
      for (const t of types) {
        rates[t] = FeedbackCollector.getSuccessRate(t);
      }
      console.table(rates);
    }, 'Show success rates by agent type');

    CommandParser.register('patterns', (args) => {
      const agentType = args.trim() || 'swe';
      const patterns = PatternMiner.mineSuccessPatterns(agentType);
      console.log(`\nSuccess patterns for ${agentType}:\n`);
      console.table(patterns.slice(0, 10));
    }, 'Show learned patterns for agent type');

    CommandParser.register('knowledge', async (args) => {
      const agentType = args.trim() || 'swe';
      const summary = await KnowledgeExtractor.generateKnowledgeSummary(agentType);
      console.log(summary);
    }, 'Show domain knowledge for agent type');
  }

  // Periodic persistence
  setInterval(() => {
    FeedbackCollector.persist();
    DecisionLogger.persist();
    HumanFeedback.persist();
  }, 60000);

  console.log(`
%c╔═══════════════════════════════════════════════════════════════════════════╗
║              🧠 Self-Improvement System Loaded                             ║
╠═══════════════════════════════════════════════════════════════════════════╣
║  /improve-status      - Show improvement status                           ║
║  /review-improvements - Review pending rule updates                       ║
║  /success-rates       - Show agent success rates                          ║
║  /patterns [type]     - Show learned patterns                             ║
║  /knowledge [type]    - Show domain knowledge                             ║
╠═══════════════════════════════════════════════════════════════════════════╣
║  HumanFeedback.thumbsUp(agentId)   - Quick positive feedback              ║
║  HumanFeedback.thumbsDown(agentId) - Quick negative feedback              ║
╚═══════════════════════════════════════════════════════════════════════════╝`,
    'color: #9c27b0; font-family: monospace;'
  );

})();
```

### 7.2 Agent Signal Extensions for Decisions

Update `.windsurf/rules/01-agent-signals.md`:

```markdown
# Decision Logging Signals

When making key decisions, log them for learning:

## Decision Signal Format
- `[DECISION: approach=value]` - Log approach choice
- `[DECISION: tool=value]` - Log tool selection
- `[DECISION: pattern=value]` - Log code pattern choice
- `[DECISION: delegation=value]` - Log delegation choice

## Examples
- `[DECISION: approach=test-first]` - Chose TDD approach
- `[DECISION: tool=jest]` - Chose Jest for testing
- `[DECISION: pattern=factory]` - Using factory pattern
- `[DECISION: delegation=qa-agent]` - Delegating to QA

## Outcome Signals
After decisions play out:
- `[OUTCOME: success]` - Decision worked
- `[OUTCOME: failure=reason]` - Decision failed
- `[OUTCOME: partial=notes]` - Mixed results

This data feeds the self-improvement system.
```

---

## Summary: How Agents Self-Improve

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           SELF-IMPROVEMENT CYCLE                                 │
│                                                                                  │
│   ┌───────────┐                                                                 │
│   │   AGENT   │                                                                 │
│   │  EXECUTES │                                                                 │
│   │   TASK    │                                                                 │
│   └─────┬─────┘                                                                 │
│         │                                                                        │
│         ▼                                                                        │
│   ┌───────────┐    ┌───────────┐    ┌───────────┐    ┌───────────┐            │
│   │  Decision │───▶│  Outcome  │───▶│  Feedback │───▶│  Pattern  │            │
│   │  Logger   │    │  Tracker  │    │ Collector │    │   Miner   │            │
│   └───────────┘    └───────────┘    └───────────┘    └─────┬─────┘            │
│                                                            │                    │
│                                                            ▼                    │
│   ┌───────────┐    ┌───────────┐    ┌───────────┐    ┌───────────┐            │
│   │  Updated  │◀───│   Prompt  │◀───│ Knowledge │◀───│   Reco-   │            │
│   │   Rules   │    │  Refiner  │    │ Extractor │    │mmendations│            │
│   └─────┬─────┘    └───────────┘    └───────────┘    └───────────┘            │
│         │                                                                        │
│         ▼                                                                        │
│   ┌───────────┐                                                                 │
│   │   AGENT   │ ◀──── Now with improved rules + knowledge                       │
│   │  EXECUTES │                                                                 │
│   │ NEXT TASK │                                                                 │
│   └───────────┘                                                                 │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Improvement Mechanisms by Agent Type

| Agent Type | Learns From | Improves |
|------------|-------------|----------|
| **SWE** | Test results, PR feedback, build outcomes | Code patterns, error handling, testing approaches |
| **QA** | Test coverage, bug discovery rate, false positives | Test strategies, assertion patterns, coverage focus |
| **Team Lead** | Task completion rates, delegation outcomes | Breakdown strategies, agent assignment, estimation |
| **Debugger** | Fix success rate, retry counts | Diagnostic approaches, common root causes |
| **Researcher** | Query relevance, source usefulness | Search strategies, source prioritization |

### Key Data Flows

1. **Automatic signals**: Every workflow transition, test result, PR review
2. **Decision logging**: Agents emit `[DECISION: x=y]` signals
3. **Pattern mining**: Find correlations between decisions and outcomes
4. **Rule generation**: High-confidence patterns become agent rules
5. **Knowledge extraction**: Domain insights from successful tasks
6. **Continuous loop**: Scheduler runs hourly, applies safe improvements

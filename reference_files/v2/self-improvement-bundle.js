/**
 * Agent Self-Improvement System
 * Inject AFTER all other AgentOS bundles
 * 
 * Provides:
 * - Automatic feedback signal collection
 * - Decision logging and pattern mining
 * - Prompt/rule refinement based on outcomes
 * - Domain knowledge extraction
 * - Continuous improvement scheduling
 */

(function() {
  'use strict';

  // Ensure dependencies
  if (!window.AgentOS || !window.EventBus) {
    console.error('[SelfImprovement] AgentOS and EventBus must be loaded first!');
    return;
  }

  // ==========================================================================
  // FEEDBACK COLLECTOR
  // ==========================================================================

  const FeedbackCollector = {
    signals: [],

    init() {
      // Workflow transitions
      EventBus.on('workflow:transition', (event) => this.recordTransition(event));
      
      // Agent errors
      EventBus.on('agent:error', (event) => this.recordFailure(event));
      
      // Workflow completion
      EventBus.on('workflow:complete', (event) => this.recordSuccess(event));
      
      // Agent completion
      EventBus.on('agent:complete', (event) => this.recordAgentSuccess(event));
    },

    recordTransition(event) {
      const { workflowId, from, to } = event;
      const workflow = WorkflowEngine?.get(workflowId);
      
      this.signals.push({
        type: 'transition',
        agentType: workflow?.data?._lastAgentType,
        from,
        to,
        success: !to.includes('FAILED') && !to.includes('ERROR'),
        timestamp: Date.now()
      });
      
      this.trimSignals();
    },

    recordFailure(event) {
      const { agentId, error } = event;
      const agent = AgentOS.agents.get(agentId);
      
      this.signals.push({
        type: 'failure',
        agentId,
        agentType: agent?.type,
        error: String(error).slice(0, 200),
        timestamp: Date.now()
      });
    },

    recordSuccess(event) {
      const { workflowId, duration } = event;
      const workflow = WorkflowEngine?.get(workflowId);
      
      workflow?.agents?.forEach((_, agentId) => {
        const agent = AgentOS.agents.get(agentId);
        this.signals.push({
          type: 'workflow_success',
          agentId,
          agentType: agent?.type,
          duration,
          timestamp: Date.now()
        });
      });
    },

    recordAgentSuccess(event) {
      const { agentId, output } = event;
      const agent = AgentOS.agents.get(agentId);
      
      this.signals.push({
        type: 'agent_success',
        agentId,
        agentType: agent?.type,
        outputLength: output?.length || 0,
        timestamp: Date.now()
      });
    },

    getSignalsForType(agentType, limit = 100) {
      return this.signals
        .filter(s => s.agentType === agentType)
        .slice(-limit);
    },

    getSuccessRate(agentType, timeWindowMs = 86400000) {
      const cutoff = Date.now() - timeWindowMs;
      const relevant = this.signals.filter(s =>
        s.agentType === agentType &&
        s.timestamp > cutoff &&
        ['failure', 'workflow_success', 'agent_success'].includes(s.type)
      );
      
      if (relevant.length === 0) return null;
      
      const successes = relevant.filter(s => s.type !== 'failure').length;
      return {
        rate: successes / relevant.length,
        total: relevant.length,
        successes
      };
    },

    trimSignals() {
      if (this.signals.length > 2000) {
        this.signals = this.signals.slice(-1500);
      }
    },

    persist() {
      localStorage.setItem('agentOS_feedback', JSON.stringify(this.signals.slice(-1000)));
    },

    restore() {
      try {
        const saved = localStorage.getItem('agentOS_feedback');
        if (saved) this.signals = JSON.parse(saved);
      } catch (e) {
        console.warn('[FeedbackCollector] Failed to restore:', e);
      }
    }
  };

  // ==========================================================================
  // DECISION LOGGER
  // ==========================================================================

  const DecisionLogger = {
    decisions: [],

    log(agentId, decision) {
      const agent = AgentOS.agents.get(agentId);
      
      this.decisions.push({
        id: `dec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        agentId,
        agentType: agent?.type,
        timestamp: Date.now(),
        decision: {
          type: decision.type,
          choice: decision.choice,
          reasoning: decision.reasoning || ''
        },
        context: {
          task: decision.task || '',
          state: decision.state || ''
        },
        outcome: null
      });
      
      this.trimDecisions();
      return this.decisions[this.decisions.length - 1].id;
    },

    recordOutcome(decisionId, outcome) {
      const decision = this.decisions.find(d => d.id === decisionId);
      if (decision) {
        decision.outcome = {
          success: outcome.success,
          recordedAt: Date.now()
        };
      }
    },

    getByType(agentType, limit = 50) {
      return this.decisions
        .filter(d => d.agentType === agentType)
        .slice(-limit);
    },

    exportForAnalysis(agentType) {
      return this.decisions
        .filter(d => d.agentType === agentType && d.outcome !== null)
        .map(d => ({
          choice: d.decision.choice,
          type: d.decision.type,
          context: d.context.task,
          success: d.outcome.success
        }));
    },

    trimDecisions() {
      if (this.decisions.length > 3000) {
        this.decisions = this.decisions.slice(-2000);
      }
    },

    persist() {
      localStorage.setItem('agentOS_decisions', JSON.stringify(this.decisions.slice(-2000)));
    },

    restore() {
      try {
        const saved = localStorage.getItem('agentOS_decisions');
        if (saved) this.decisions = JSON.parse(saved);
      } catch (e) {
        console.warn('[DecisionLogger] Failed to restore:', e);
      }
    }
  };

  // ==========================================================================
  // HUMAN FEEDBACK
  // ==========================================================================

  const HumanFeedback = {
    feedback: [],

    thumbsUp(agentId, comment = '') {
      const agent = AgentOS.agents.get(agentId);
      this.feedback.push({
        agentId,
        agentType: agent?.type,
        positive: true,
        comment,
        timestamp: Date.now()
      });
      
      EventBus.emit('feedback:received', { agentId, positive: true });
      console.log('👍 Positive feedback recorded');
      this.persist();
    },

    thumbsDown(agentId, reason = '') {
      const agent = AgentOS.agents.get(agentId);
      this.feedback.push({
        agentId,
        agentType: agent?.type,
        positive: false,
        reason,
        timestamp: Date.now()
      });
      
      EventBus.emit('feedback:received', { agentId, positive: false, reason });
      console.log('👎 Negative feedback recorded');
      this.persist();
    },

    rate(agentId, rating) {
      const agent = AgentOS.agents.get(agentId);
      this.feedback.push({
        agentId,
        agentType: agent?.type,
        rating, // { quality: 1-5, correctness: 1-5, helpfulness: 1-5 }
        timestamp: Date.now()
      });
      
      console.log('⭐ Rating recorded');
      this.persist();
    },

    getFeedbackForType(agentType) {
      return this.feedback.filter(f => f.agentType === agentType);
    },

    persist() {
      localStorage.setItem('agentOS_humanFeedback', JSON.stringify(this.feedback.slice(-500)));
    },

    restore() {
      try {
        const saved = localStorage.getItem('agentOS_humanFeedback');
        if (saved) this.feedback = JSON.parse(saved);
      } catch (e) {
        console.warn('[HumanFeedback] Failed to restore:', e);
      }
    }
  };

  // ==========================================================================
  // PATTERN MINER
  // ==========================================================================

  const PatternMiner = {
    
    mineSuccessPatterns(agentType) {
      const decisions = DecisionLogger.exportForAnalysis(agentType);
      const byChoice = new Map();
      
      for (const d of decisions) {
        const key = `${d.type}:${d.choice}`;
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
      
      const patterns = [];
      byChoice.forEach((stats, key) => {
        const total = stats.successes + stats.failures;
        if (total >= 3) {
          const [type, choice] = key.split(':');
          patterns.push({
            type,
            choice,
            successRate: stats.successes / total,
            sampleSize: total
          });
        }
      });
      
      return patterns.sort((a, b) => b.successRate - a.successRate);
    },

    mineFailurePatterns(agentType) {
      return this.mineSuccessPatterns(agentType)
        .filter(p => p.successRate < 0.5)
        .sort((a, b) => a.successRate - b.successRate);
    },

    mineDecisionSequences(agentType, sequenceLength = 3) {
      const decisions = DecisionLogger.decisions.filter(d =>
        d.agentType === agentType && d.outcome !== null
      );
      
      const sequences = new Map();
      const byAgent = new Map();
      
      for (const d of decisions) {
        if (!byAgent.has(d.agentId)) {
          byAgent.set(d.agentId, []);
        }
        byAgent.get(d.agentId).push(d);
      }
      
      byAgent.forEach(agentDecisions => {
        agentDecisions.sort((a, b) => a.timestamp - b.timestamp);
        
        for (let i = 0; i <= agentDecisions.length - sequenceLength; i++) {
          const seq = agentDecisions.slice(i, i + sequenceLength);
          const key = seq.map(d => d.decision.choice).join(' → ');
          const lastOutcome = seq[seq.length - 1].outcome;
          
          if (!sequences.has(key)) {
            sequences.set(key, { successes: 0, failures: 0 });
          }
          
          if (lastOutcome?.success) {
            sequences.get(key).successes++;
          } else {
            sequences.get(key).failures++;
          }
        }
      });
      
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

    generateRecommendations(agentType) {
      const successPatterns = this.mineSuccessPatterns(agentType);
      const failurePatterns = this.mineFailurePatterns(agentType);
      const sequences = this.mineDecisionSequences(agentType);
      
      return {
        reinforce: successPatterns
          .filter(p => p.successRate > 0.8 && p.sampleSize >= 5)
          .map(p => ({
            pattern: `${p.type}: ${p.choice}`,
            confidence: p.successRate,
            sampleSize: p.sampleSize
          })),
        
        avoid: failurePatterns
          .filter(p => p.successRate < 0.3 && p.sampleSize >= 3)
          .map(p => ({
            pattern: `${p.type}: ${p.choice}`,
            failureRate: 1 - p.successRate,
            sampleSize: p.sampleSize
          })),
        
        sequences: sequences
          .filter(s => s.successRate > 0.7 && s.sampleSize >= 3)
          .slice(0, 5)
      };
    }
  };

  // ==========================================================================
  // PROMPT REFINER
  // ==========================================================================

  const PromptRefiner = {
    learnedRules: {},

    async generateRuleUpdates(agentType) {
      const recommendations = PatternMiner.generateRecommendations(agentType);
      
      const updates = {
        bestPractices: [],
        antiPatterns: [],
        workflows: []
      };
      
      // Best practices from high-success patterns
      for (const r of recommendations.reinforce) {
        updates.bestPractices.push({
          content: `**Preferred**: ${r.pattern} (${Math.round(r.confidence * 100)}% success, n=${r.sampleSize})`,
          confidence: r.confidence
        });
      }
      
      // Anti-patterns from high-failure patterns
      for (const a of recommendations.avoid) {
        updates.antiPatterns.push({
          content: `**Avoid**: ${a.pattern} (${Math.round(a.failureRate * 100)}% failure rate)`,
          failureRate: a.failureRate
        });
      }
      
      // Effective sequences
      for (const s of recommendations.sequences) {
        updates.workflows.push({
          content: `**Effective sequence**: ${s.sequence}`,
          confidence: s.successRate
        });
      }
      
      return updates;
    },

    applyUpdates(agentType, updates) {
      if (!this.learnedRules[agentType]) {
        this.learnedRules[agentType] = {
          bestPractices: [],
          antiPatterns: [],
          workflows: [],
          lastUpdated: null
        };
      }
      
      const rules = this.learnedRules[agentType];
      
      // Add new practices (deduplicated)
      for (const bp of updates.bestPractices) {
        if (!rules.bestPractices.some(r => r.content === bp.content)) {
          rules.bestPractices.push(bp);
        }
      }
      
      // Add new anti-patterns
      for (const ap of updates.antiPatterns) {
        if (!rules.antiPatterns.some(r => r.content === ap.content)) {
          rules.antiPatterns.push(ap);
        }
      }
      
      // Add workflows
      for (const wf of updates.workflows) {
        if (!rules.workflows.some(r => r.content === wf.content)) {
          rules.workflows.push(wf);
        }
      }
      
      rules.lastUpdated = Date.now();
      this.persist();
      
      return rules;
    },

    generateRuleMarkdown(agentType) {
      const rules = this.learnedRules[agentType];
      if (!rules) return '';
      
      let md = `\n## Learned Patterns (Auto-Generated)\n\n`;
      md += `*Last updated: ${new Date(rules.lastUpdated).toISOString()}*\n\n`;
      
      if (rules.bestPractices.length > 0) {
        md += `### Best Practices\n\n`;
        rules.bestPractices.slice(0, 10).forEach(bp => {
          md += `- ${bp.content}\n`;
        });
        md += '\n';
      }
      
      if (rules.antiPatterns.length > 0) {
        md += `### Anti-Patterns\n\n`;
        rules.antiPatterns.slice(0, 10).forEach(ap => {
          md += `- ${ap.content}\n`;
        });
        md += '\n';
      }
      
      if (rules.workflows.length > 0) {
        md += `### Effective Workflows\n\n`;
        rules.workflows.slice(0, 5).forEach(wf => {
          md += `- ${wf.content}\n`;
        });
      }
      
      return md;
    },

    persist() {
      localStorage.setItem('agentOS_learnedRules', JSON.stringify(this.learnedRules));
    },

    restore() {
      try {
        const saved = localStorage.getItem('agentOS_learnedRules');
        if (saved) this.learnedRules = JSON.parse(saved);
      } catch (e) {
        console.warn('[PromptRefiner] Failed to restore:', e);
      }
    }
  };

  // ==========================================================================
  // KNOWLEDGE EXTRACTOR
  // ==========================================================================

  const KnowledgeExtractor = {
    knowledge: [],

    extractFromSuccess(agentId, task, output) {
      const agent = AgentOS.agents.get(agentId);
      
      const entry = {
        id: `know-${Date.now()}`,
        agentType: agent?.type,
        timestamp: Date.now(),
        task: task?.slice(0, 200),
        domain: this.inferDomain(task),
        insights: this.extractInsights(output),
        codePatterns: agent?.type === 'swe' ? this.extractCodePatterns(output) : []
      };
      
      this.knowledge.push(entry);
      this.trimKnowledge();
      this.persist();
      
      return entry;
    },

    inferDomain(task) {
      if (!task) return 'general';
      const text = task.toLowerCase();
      
      const domains = {
        'auth': ['auth', 'login', 'sso', 'oauth'],
        'database': ['sql', 'query', 'database', 'migration'],
        'api': ['api', 'endpoint', 'rest', 'graphql'],
        'frontend': ['component', 'react', 'css', 'ui'],
        'testing': ['test', 'spec', 'mock', 'coverage'],
        'devops': ['deploy', 'ci', 'docker', 'pipeline']
      };
      
      for (const [domain, keywords] of Object.entries(domains)) {
        if (keywords.some(k => text.includes(k))) {
          return domain;
        }
      }
      
      return 'general';
    },

    extractInsights(output) {
      if (!output) return [];
      
      const insights = [];
      const patterns = [
        /learned:?\s*(.{10,100})/gi,
        /note:?\s*(.{10,100})/gi,
        /important:?\s*(.{10,100})/gi
      ];
      
      for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(output)) !== null) {
          insights.push(match[1].trim());
        }
      }
      
      return insights.slice(0, 5);
    },

    extractCodePatterns(output) {
      if (!output) return [];
      
      const codeBlocks = output.match(/```[\s\S]*?```/g) || [];
      return codeBlocks.slice(0, 3).map(block => {
        const langMatch = block.match(/```(\w+)/);
        return {
          language: langMatch?.[1] || 'unknown',
          snippet: block.slice(0, 200)
        };
      });
    },

    getKnowledgeByDomain(agentType, domain) {
      return this.knowledge.filter(k =>
        k.agentType === agentType && k.domain === domain
      );
    },

    generateSummary(agentType) {
      const agentKnowledge = this.knowledge.filter(k => k.agentType === agentType);
      
      const byDomain = {};
      for (const k of agentKnowledge) {
        if (!byDomain[k.domain]) byDomain[k.domain] = [];
        byDomain[k.domain].push(k);
      }
      
      let summary = `## Domain Knowledge (${agentType})\n\n`;
      
      for (const [domain, items] of Object.entries(byDomain)) {
        summary += `### ${domain}\n`;
        const insights = items.flatMap(i => i.insights).slice(0, 5);
        insights.forEach(i => {
          summary += `- ${i}\n`;
        });
        summary += '\n';
      }
      
      return summary;
    },

    trimKnowledge() {
      if (this.knowledge.length > 500) {
        this.knowledge = this.knowledge.slice(-400);
      }
    },

    persist() {
      localStorage.setItem('agentOS_knowledge', JSON.stringify(this.knowledge.slice(-500)));
    },

    restore() {
      try {
        const saved = localStorage.getItem('agentOS_knowledge');
        if (saved) this.knowledge = JSON.parse(saved);
      } catch (e) {
        console.warn('[KnowledgeExtractor] Failed to restore:', e);
      }
    }
  };

  // ==========================================================================
  // IMPROVEMENT SCHEDULER
  // ==========================================================================

  const ImprovementScheduler = {
    config: {
      minDataPoints: 20,
      analysisIntervalMs: 3600000, // 1 hour
      autoApplyThreshold: 0.85
    },
    
    lastAnalysis: {},
    pendingImprovements: [],

    start() {
      console.log('[ImprovementScheduler] Starting continuous improvement loop');
      
      // Initial analysis after 5 minutes
      setTimeout(() => this.runAnalysis(), 300000);
      
      // Periodic analysis
      setInterval(() => this.runAnalysis(), this.config.analysisIntervalMs);
      
      // Learn from workflow completions
      EventBus.on('workflow:complete', (event) => {
        setTimeout(() => this.learnFromWorkflow(event.workflowId), 1000);
      });
    },

    async runAnalysis() {
      console.log('[ImprovementScheduler] Running analysis...');
      
      const agentTypes = ['swe', 'qa', 'team-lead', 'debugger', 'researcher'];
      
      for (const agentType of agentTypes) {
        const signals = FeedbackCollector.getSignalsForType(agentType);
        
        if (signals.length < this.config.minDataPoints) {
          continue;
        }
        
        // Generate and apply updates
        const updates = await PromptRefiner.generateRuleUpdates(agentType);
        
        // Auto-apply high-confidence improvements
        const highConfidence = {
          bestPractices: updates.bestPractices.filter(u => u.confidence >= this.config.autoApplyThreshold),
          antiPatterns: updates.antiPatterns.filter(u => u.failureRate >= 0.7),
          workflows: updates.workflows.filter(u => u.confidence >= this.config.autoApplyThreshold)
        };
        
        if (highConfidence.bestPractices.length > 0 || 
            highConfidence.antiPatterns.length > 0 || 
            highConfidence.workflows.length > 0) {
          PromptRefiner.applyUpdates(agentType, highConfidence);
          console.log(`[ImprovementScheduler] Applied improvements for ${agentType}`);
        }
        
        this.lastAnalysis[agentType] = Date.now();
      }
    },

    async learnFromWorkflow(workflowId) {
      const workflow = WorkflowEngine?.get(workflowId);
      if (!workflow || workflow.state !== 'COMPLETED') return;
      
      workflow.agents?.forEach((_, agentId) => {
        const agent = AgentOS.agents.get(agentId);
        if (!agent) return;
        
        const lastOutput = agent.outputHistory?.[agent.outputHistory.length - 1];
        if (lastOutput) {
          KnowledgeExtractor.extractFromSuccess(
            agentId,
            workflow.data?.summary || workflow.type,
            lastOutput
          );
        }
      });
    },

    getStatus() {
      const status = {};
      
      for (const [agentType, timestamp] of Object.entries(this.lastAnalysis)) {
        const successRate = FeedbackCollector.getSuccessRate(agentType);
        const rules = PromptRefiner.learnedRules[agentType];
        
        status[agentType] = {
          lastAnalysis: new Date(timestamp).toISOString(),
          successRate: successRate ? `${Math.round(successRate.rate * 100)}%` : 'N/A',
          sampleSize: successRate?.total || 0,
          learnedRules: rules ? (rules.bestPractices.length + rules.antiPatterns.length) : 0
        };
      }
      
      return status;
    }
  };

  // ==========================================================================
  // AGENT OUTPUT HOOK
  // ==========================================================================

  const originalParseOutput = AgentOS.parseAgentOutput;
  AgentOS.parseAgentOutput = function(agent, output) {
    // Call original
    if (originalParseOutput) {
      originalParseOutput.call(this, agent, output);
    }
    
    // Parse decision signals
    const decisionMatches = output.matchAll(/\[DECISION:\s*(\w+)\s*=\s*(.+?)\]/g);
    for (const match of decisionMatches) {
      DecisionLogger.log(agent.id, {
        type: match[1],
        choice: match[2],
        task: agent.currentTask?.description
      });
    }
    
    // Parse outcome signals
    const outcomeMatch = output.match(/\[OUTCOME:\s*(success|failure)(?:=(.+?))?\]/i);
    if (outcomeMatch) {
      const recentDecision = DecisionLogger.decisions
        .filter(d => d.agentId === agent.id && !d.outcome)
        .pop();
      
      if (recentDecision) {
        DecisionLogger.recordOutcome(recentDecision.id, {
          success: outcomeMatch[1].toLowerCase() === 'success',
          reason: outcomeMatch[2]
        });
      }
    }
    
    // Store output for knowledge extraction
    if (!agent.outputHistory) agent.outputHistory = [];
    agent.outputHistory.push(output);
    if (agent.outputHistory.length > 10) {
      agent.outputHistory.shift();
    }
    
    // Track last agent type for workflow
    const workflowId = agent.context?.workflowId;
    if (workflowId && WorkflowEngine) {
      const workflow = WorkflowEngine.get(workflowId);
      if (workflow) {
        workflow.data._lastAgentType = agent.type;
      }
    }
  };

  // ==========================================================================
  // COMMAND REGISTRATION
  // ==========================================================================

  if (window.CommandParser) {
    CommandParser.register('improve-status', () => {
      const status = ImprovementScheduler.getStatus();
      console.log('\n📊 IMPROVEMENT STATUS:\n');
      console.table(status);
    }, 'Show self-improvement status');

    CommandParser.register('success-rates', () => {
      const types = ['swe', 'qa', 'team-lead', 'debugger', 'researcher'];
      const rates = {};
      for (const t of types) {
        const rate = FeedbackCollector.getSuccessRate(t);
        rates[t] = rate ? {
          rate: `${Math.round(rate.rate * 100)}%`,
          samples: rate.total
        } : { rate: 'N/A', samples: 0 };
      }
      console.table(rates);
    }, 'Show agent success rates');

    CommandParser.register('patterns', (args) => {
      const agentType = args.trim() || 'swe';
      const patterns = PatternMiner.mineSuccessPatterns(agentType);
      console.log(`\n✅ Success patterns for ${agentType}:\n`);
      console.table(patterns.slice(0, 10));
      
      const failures = PatternMiner.mineFailurePatterns(agentType);
      console.log(`\n❌ Failure patterns for ${agentType}:\n`);
      console.table(failures.slice(0, 5));
    }, 'Show learned patterns [agent-type]');

    CommandParser.register('learned-rules', (args) => {
      const agentType = args.trim() || 'swe';
      const md = PromptRefiner.generateRuleMarkdown(agentType);
      console.log(md || 'No learned rules yet');
    }, 'Show learned rules [agent-type]');

    CommandParser.register('knowledge', (args) => {
      const agentType = args.trim() || 'swe';
      const summary = KnowledgeExtractor.generateSummary(agentType);
      console.log(summary);
    }, 'Show domain knowledge [agent-type]');

    CommandParser.register('recommendations', (args) => {
      const agentType = args.trim() || 'swe';
      const recs = PatternMiner.generateRecommendations(agentType);
      
      console.log(`\n📋 RECOMMENDATIONS for ${agentType}:\n`);
      
      if (recs.reinforce.length > 0) {
        console.log('✅ REINFORCE (keep doing):');
        recs.reinforce.forEach(r => console.log(`  - ${r.pattern} (${Math.round(r.confidence * 100)}%)`));
      }
      
      if (recs.avoid.length > 0) {
        console.log('\n❌ AVOID (stop doing):');
        recs.avoid.forEach(a => console.log(`  - ${a.pattern} (${Math.round(a.failureRate * 100)}% fail)`));
      }
      
      if (recs.sequences.length > 0) {
        console.log('\n🔄 EFFECTIVE SEQUENCES:');
        recs.sequences.forEach(s => console.log(`  - ${s.sequence}`));
      }
    }, 'Show improvement recommendations [agent-type]');
  }

  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================

  // Restore persisted state
  FeedbackCollector.restore();
  DecisionLogger.restore();
  HumanFeedback.restore();
  PromptRefiner.restore();
  KnowledgeExtractor.restore();

  // Initialize collectors
  FeedbackCollector.init();

  // Start improvement loop
  ImprovementScheduler.start();

  // Periodic persistence
  setInterval(() => {
    FeedbackCollector.persist();
    DecisionLogger.persist();
    KnowledgeExtractor.persist();
  }, 60000);

  // ==========================================================================
  // EXPORTS
  // ==========================================================================

  window.FeedbackCollector = FeedbackCollector;
  window.DecisionLogger = DecisionLogger;
  window.HumanFeedback = HumanFeedback;
  window.PatternMiner = PatternMiner;
  window.PromptRefiner = PromptRefiner;
  window.KnowledgeExtractor = KnowledgeExtractor;
  window.ImprovementScheduler = ImprovementScheduler;

  console.log(`
%c╔════════════════════════════════════════════════════════════════════════════╗
║               🧠 Self-Improvement System Loaded                             ║
╠════════════════════════════════════════════════════════════════════════════╣
║  /improve-status     - Show improvement status                             ║
║  /success-rates      - Show agent success rates                            ║
║  /patterns [type]    - Show learned patterns                               ║
║  /learned-rules [t]  - Show auto-generated rules                           ║
║  /knowledge [type]   - Show domain knowledge                               ║
║  /recommendations [t]- Show improvement recommendations                    ║
╠════════════════════════════════════════════════════════════════════════════╣
║  HumanFeedback.thumbsUp(agentId)   - Quick positive feedback               ║
║  HumanFeedback.thumbsDown(agentId) - Quick negative feedback               ║
╠════════════════════════════════════════════════════════════════════════════╣
║  Agent Decision Signals (use in agent output):                             ║
║    [DECISION: approach=tdd]        - Log approach choice                   ║
║    [DECISION: tool=jest]           - Log tool selection                    ║
║    [OUTCOME: success]              - Log decision outcome                  ║
╚════════════════════════════════════════════════════════════════════════════╝`,
    'color: #9c27b0; font-family: monospace;'
  );

})();

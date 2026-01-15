/**
 * PromptRefiner - Auto-update agent rules based on patterns
 *
 * Generates rule updates:
 * - Best practices from high-confidence patterns
 * - Anti-patterns to avoid
 * - Effective workflow sequences
 * - Auto-applies safe improvements (>85% confidence)
 */

import { EventBus } from '../core/event-bus.js';
import { PatternMiner, MinedPattern } from './pattern-miner.js';

/** Rule type */
export type RuleType = 'best_practice' | 'anti_pattern' | 'workflow' | 'context' | 'custom';

/** Refined rule */
export interface RefinedRule {
  id: string;
  type: RuleType;
  agentType: string;
  rule: string;
  rationale: string;
  sourcePatterns: string[];
  confidence: number;
  status: 'pending' | 'approved' | 'rejected' | 'applied';
  createdAt: number;
  appliedAt?: number;
  approvedBy?: string;
}

/** Rule update */
export interface RuleUpdate {
  agentType: string;
  originalRules: string[];
  newRules: string[];
  addedRules: RefinedRule[];
  removedRules: string[];
  updatedAt: number;
}

/** Prompt refiner singleton */
class PromptRefinerClass {
  private rules: RefinedRule[] = [];
  private ruleUpdates: RuleUpdate[] = [];
  private autoApplyThreshold = 0.85;

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Refine rules from patterns
   */
  refineFromPatterns(agentType?: string): RefinedRule[] {
    const newRules: RefinedRule[] = [];

    // Get success patterns
    const successPatterns = agentType
      ? PatternMiner.getPatternsForAgent(agentType).filter(p => p.type === 'success')
      : PatternMiner.getSuccessPatterns();

    for (const pattern of successPatterns) {
      if (pattern.confidence < 0.6) continue;

      const rule = this.generateBestPracticeRule(pattern);
      if (rule && !this.ruleExists(rule.rule)) {
        this.rules.push(rule);
        newRules.push(rule);
      }
    }

    // Get anti-patterns
    const antiPatterns = agentType
      ? PatternMiner.getPatternsForAgent(agentType).filter(p => p.type === 'failure')
      : PatternMiner.getAntiPatterns();

    for (const pattern of antiPatterns) {
      if (pattern.confidence < 0.6) continue;

      const rule = this.generateAntiPatternRule(pattern);
      if (rule && !this.ruleExists(rule.rule)) {
        this.rules.push(rule);
        newRules.push(rule);
      }
    }

    // Get sequence patterns
    const sequencePatterns = PatternMiner.getPatternsByType('sequence')
      .filter(p => p.confidence >= 0.6);

    for (const pattern of sequencePatterns) {
      const rule = this.generateWorkflowRule(pattern);
      if (rule && !this.ruleExists(rule.rule)) {
        this.rules.push(rule);
        newRules.push(rule);
      }
    }

    // Auto-apply high-confidence rules
    const autoApplied = newRules.filter(r => r.confidence >= this.autoApplyThreshold);
    for (const rule of autoApplied) {
      this.autoApply(rule);
    }

    if (newRules.length > 0) {
      EventBus.emit('rules:refined', {
        count: newRules.length,
        autoApplied: autoApplied.length
      });
    }

    console.log(`[PromptRefiner] Generated ${newRules.length} rules, auto-applied ${autoApplied.length}`);

    return newRules;
  }

  /**
   * Check if rule already exists
   */
  private ruleExists(ruleText: string): boolean {
    const normalized = ruleText.toLowerCase().trim();
    return this.rules.some(r => r.rule.toLowerCase().trim() === normalized);
  }

  /**
   * Generate best practice rule from success pattern
   */
  private generateBestPracticeRule(pattern: MinedPattern): RefinedRule | null {
    if (!pattern.pattern.decisionType || !pattern.pattern.choice) return null;

    const successRate = (pattern.evidence.successRate * 100).toFixed(0);

    return {
      id: this.generateId(),
      type: 'best_practice',
      agentType: pattern.agentType || 'all',
      rule: `PREFER using "${pattern.pattern.choice}" for ${pattern.pattern.decisionType} decisions.`,
      rationale: `This approach has a ${successRate}% success rate across ${pattern.evidence.occurrences} occurrences.`,
      sourcePatterns: [pattern.id],
      confidence: pattern.confidence,
      status: 'pending',
      createdAt: Date.now()
    };
  }

  /**
   * Generate anti-pattern rule from failure pattern
   */
  private generateAntiPatternRule(pattern: MinedPattern): RefinedRule | null {
    if (!pattern.pattern.decisionType || !pattern.pattern.choice) return null;

    const successRate = (pattern.evidence.successRate * 100).toFixed(0);

    return {
      id: this.generateId(),
      type: 'anti_pattern',
      agentType: pattern.agentType || 'all',
      rule: `AVOID using "${pattern.pattern.choice}" for ${pattern.pattern.decisionType} decisions.`,
      rationale: `This approach has only a ${successRate}% success rate across ${pattern.evidence.occurrences} occurrences.`,
      sourcePatterns: [pattern.id],
      confidence: pattern.confidence,
      status: 'pending',
      createdAt: Date.now()
    };
  }

  /**
   * Generate workflow rule from sequence pattern
   */
  private generateWorkflowRule(pattern: MinedPattern): RefinedRule | null {
    if (!pattern.pattern.sequence || pattern.pattern.sequence.length < 2) return null;

    const steps = pattern.pattern.sequence
      .slice(0, 5)
      .map(s => {
        const [type, choice] = s.split(':');
        return `${type}="${choice}"`;
      })
      .join(' → ');

    const successRate = (pattern.evidence.successRate * 100).toFixed(0);

    return {
      id: this.generateId(),
      type: 'workflow',
      agentType: pattern.agentType || 'all',
      rule: `FOLLOW the workflow sequence: ${steps}`,
      rationale: `This sequence has a ${successRate}% success rate across ${pattern.evidence.occurrences} workflows.`,
      sourcePatterns: [pattern.id],
      confidence: pattern.confidence,
      status: 'pending',
      createdAt: Date.now()
    };
  }

  /**
   * Auto-apply high-confidence rule
   */
  private autoApply(rule: RefinedRule): void {
    rule.status = 'applied';
    rule.appliedAt = Date.now();
    rule.approvedBy = 'auto';

    EventBus.emit('rule:auto-applied', rule);

    console.log(`[PromptRefiner] Auto-applied rule: ${rule.rule}`);
  }

  /**
   * Add custom rule
   */
  addCustomRule(
    agentType: string,
    rule: string,
    rationale: string
  ): RefinedRule {
    const newRule: RefinedRule = {
      id: this.generateId(),
      type: 'custom',
      agentType,
      rule,
      rationale,
      sourcePatterns: [],
      confidence: 1.0,  // Human-provided = full confidence
      status: 'pending',
      createdAt: Date.now()
    };

    this.rules.push(newRule);

    return newRule;
  }

  /**
   * Approve rule
   */
  approveRule(ruleId: string, approvedBy = 'user'): boolean {
    const rule = this.rules.find(r => r.id === ruleId);
    if (!rule || rule.status !== 'pending') return false;

    rule.status = 'approved';
    rule.approvedBy = approvedBy;

    EventBus.emit('rule:approved', rule);

    return true;
  }

  /**
   * Apply approved rule
   */
  applyRule(ruleId: string): boolean {
    const rule = this.rules.find(r => r.id === ruleId);
    if (!rule || (rule.status !== 'approved' && rule.status !== 'pending')) return false;

    rule.status = 'applied';
    rule.appliedAt = Date.now();

    EventBus.emit('rule:applied', rule);

    return true;
  }

  /**
   * Reject rule
   */
  rejectRule(ruleId: string): boolean {
    const rule = this.rules.find(r => r.id === ruleId);
    if (!rule || rule.status !== 'pending') return false;

    rule.status = 'rejected';

    EventBus.emit('rule:rejected', rule);

    return true;
  }

  /**
   * Get all rules
   */
  getRules(): RefinedRule[] {
    return [...this.rules];
  }

  /**
   * Get rules by status
   */
  getRulesByStatus(status: RefinedRule['status']): RefinedRule[] {
    return this.rules.filter(r => r.status === status);
  }

  /**
   * Get pending rules
   */
  getPendingRules(): RefinedRule[] {
    return this.getRulesByStatus('pending');
  }

  /**
   * Get applied rules
   */
  getAppliedRules(): RefinedRule[] {
    return this.getRulesByStatus('applied');
  }

  /**
   * Get rules for agent type
   */
  getRulesForAgent(agentType: string): RefinedRule[] {
    return this.rules.filter(r =>
      r.agentType === agentType || r.agentType === 'all'
    );
  }

  /**
   * Get applied rules for agent type
   */
  getAppliedRulesForAgent(agentType: string): RefinedRule[] {
    return this.rules.filter(r =>
      (r.agentType === agentType || r.agentType === 'all') &&
      r.status === 'applied'
    );
  }

  /**
   * Generate rules summary for agent prompt
   */
  generatePromptAdditions(agentType: string): string {
    const appliedRules = this.getAppliedRulesForAgent(agentType);

    if (appliedRules.length === 0) return '';

    const sections: string[] = ['## Learned Best Practices\n'];

    // Best practices
    const bestPractices = appliedRules.filter(r => r.type === 'best_practice');
    if (bestPractices.length > 0) {
      sections.push('### DO:');
      for (const rule of bestPractices) {
        sections.push(`- ${rule.rule}`);
      }
    }

    // Anti-patterns
    const antiPatterns = appliedRules.filter(r => r.type === 'anti_pattern');
    if (antiPatterns.length > 0) {
      sections.push('\n### AVOID:');
      for (const rule of antiPatterns) {
        sections.push(`- ${rule.rule}`);
      }
    }

    // Workflows
    const workflows = appliedRules.filter(r => r.type === 'workflow');
    if (workflows.length > 0) {
      sections.push('\n### Recommended Workflows:');
      for (const rule of workflows) {
        sections.push(`- ${rule.rule}`);
      }
    }

    return sections.join('\n');
  }

  /**
   * Set auto-apply threshold
   */
  setAutoApplyThreshold(threshold: number): void {
    this.autoApplyThreshold = Math.max(0, Math.min(1, threshold));
  }

  /**
   * Get auto-apply threshold
   */
  getAutoApplyThreshold(): number {
    return this.autoApplyThreshold;
  }

  /**
   * Export rules
   */
  exportData(): RefinedRule[] {
    return [...this.rules];
  }

  /**
   * Import rules
   */
  importData(rules: RefinedRule[]): void {
    for (const rule of rules) {
      if (!this.ruleExists(rule.rule)) {
        this.rules.push(rule);
      }
    }
  }

  /**
   * Clear all rules
   */
  clear(): void {
    this.rules = [];
    this.ruleUpdates = [];
    console.log('[PromptRefiner] Cleared all rules');
  }

  /**
   * Get statistics
   */
  getStats(): {
    total: number;
    pending: number;
    approved: number;
    applied: number;
    rejected: number;
    byType: Record<string, number>;
    byAgent: Record<string, number>;
    avgConfidence: number;
  } {
    const byType: Record<string, number> = {};
    const byAgent: Record<string, number> = {};

    for (const rule of this.rules) {
      byType[rule.type] = (byType[rule.type] || 0) + 1;
      byAgent[rule.agentType] = (byAgent[rule.agentType] || 0) + 1;
    }

    const avgConfidence = this.rules.length > 0
      ? this.rules.reduce((sum, r) => sum + r.confidence, 0) / this.rules.length
      : 0;

    return {
      total: this.rules.length,
      pending: this.rules.filter(r => r.status === 'pending').length,
      approved: this.rules.filter(r => r.status === 'approved').length,
      applied: this.rules.filter(r => r.status === 'applied').length,
      rejected: this.rules.filter(r => r.status === 'rejected').length,
      byType,
      byAgent,
      avgConfidence
    };
  }
}

// Export singleton
export const PromptRefiner = new PromptRefinerClass();

// Export class for testing
export { PromptRefinerClass };

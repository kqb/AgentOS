/**
 * SkillGenerator - Pattern-based skill generation
 *
 * Learns from successful workflows to automatically generate
 * new skills that can be applied to future tasks.
 */

import { EventBus } from '../core/event-bus.js';
import { KnowledgeBase, STORES, KBSkill } from '../knowledge/kb.js';
import { PatternMatcher, WorkflowPattern, ActionSequence } from './pattern-matcher.js';

/** Generated skill definition */
export interface GeneratedSkill {
  id: string;
  name: string;
  type: 'workflow-pattern' | 'action-sequence' | 'decision-template';
  pattern: string;
  steps: string[];
  triggers: string[];
  generatedFrom: string[];
  occurrences: number;
  successRate: number;
  averageDuration: number;
  confidence: number;
  createdAt: number;
  updatedAt: number;
  autoApply: boolean;
}

/** Skill generation options */
export interface GenerationOptions {
  minOccurrences?: number;
  minSuccessRate?: number;
  minConfidence?: number;
  patternTypes?: Array<'workflow' | 'action' | 'decision'>;
}

/** Generation result */
export interface GenerationResult {
  generated: GeneratedSkill[];
  updated: GeneratedSkill[];
  rejected: Array<{ pattern: string; reason: string }>;
  totalPatterns: number;
}

/** Skill generator singleton */
class SkillGeneratorClass {
  private generatedSkills: Map<string, GeneratedSkill> = new Map();
  private initialized = false;

  /**
   * Initialize generator
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    // Load existing generated skills from IndexedDB
    try {
      const stored = await KnowledgeBase.getAll<KBSkill>(STORES.SKILLS);
      for (const skill of stored) {
        this.generatedSkills.set(skill.id, {
          id: skill.id,
          name: skill.name,
          type: 'workflow-pattern',
          pattern: skill.pattern,
          steps: [],
          triggers: [],
          generatedFrom: skill.generatedFrom,
          occurrences: skill.occurrences,
          successRate: skill.successRate,
          averageDuration: skill.averageDuration,
          confidence: skill.successRate * Math.min(skill.occurrences / 10, 1),
          createdAt: skill.createdAt,
          updatedAt: skill.updatedAt,
          autoApply: skill.successRate >= 0.85
        });
      }
    } catch (error) {
      console.log('[SkillGenerator] Starting fresh - no existing skills');
    }

    // Listen for workflow completions
    EventBus.on('workflow:complete', this.handleWorkflowComplete.bind(this));

    this.initialized = true;
    console.log('[SkillGenerator] Initialized with', this.generatedSkills.size, 'skills');
  }

  /**
   * Handle workflow completion for learning
   */
  private async handleWorkflowComplete(event: unknown): Promise<void> {
    const { workflowId, success, duration, stateHistory } = event as {
      workflowId: string;
      success: boolean;
      duration: number;
      stateHistory: string[];
    };

    if (!success) return;

    // Record the successful pattern
    await PatternMatcher.recordPattern({
      id: `pattern-${workflowId}`,
      states: stateHistory || [],
      success: true,
      duration,
      timestamp: Date.now()
    });

    // Trigger pattern analysis
    const patterns = await PatternMatcher.analyzePatterns();

    // Generate skills from patterns
    await this.generateFromPatterns(patterns);
  }

  /**
   * Generate skills from discovered patterns
   */
  async generateFromPatterns(patterns: WorkflowPattern[]): Promise<GenerationResult> {
    const generated: GeneratedSkill[] = [];
    const updated: GeneratedSkill[] = [];
    const rejected: Array<{ pattern: string; reason: string }> = [];

    for (const pattern of patterns) {
      // Check if pattern meets criteria
      if (pattern.occurrences < 3) {
        rejected.push({ pattern: pattern.id, reason: 'Insufficient occurrences' });
        continue;
      }

      if (pattern.successRate < 0.7) {
        rejected.push({ pattern: pattern.id, reason: 'Low success rate' });
        continue;
      }

      // Check if skill already exists
      const existingId = this.findExistingSkill(pattern);

      if (existingId) {
        // Update existing skill
        const existing = this.generatedSkills.get(existingId)!;
        existing.occurrences = pattern.occurrences;
        existing.successRate = pattern.successRate;
        existing.averageDuration = pattern.averageDuration;
        existing.confidence = this.calculateConfidence(pattern);
        existing.updatedAt = Date.now();
        existing.autoApply = existing.successRate >= 0.85 && existing.confidence >= 0.8;

        await this.persistSkill(existing);
        updated.push(existing);
      } else {
        // Create new skill
        const skill = this.createSkillFromPattern(pattern);
        this.generatedSkills.set(skill.id, skill);
        await this.persistSkill(skill);
        generated.push(skill);

        EventBus.emit('skill:generated', { skill });
        console.log(`[SkillGenerator] Generated skill: ${skill.name}`);
      }
    }

    return {
      generated,
      updated,
      rejected,
      totalPatterns: patterns.length
    };
  }

  /**
   * Find existing skill matching pattern
   */
  private findExistingSkill(pattern: WorkflowPattern): string | null {
    for (const [id, skill] of this.generatedSkills) {
      if (skill.pattern === pattern.sequence) {
        return id;
      }
    }
    return null;
  }

  /**
   * Create skill from pattern
   */
  private createSkillFromPattern(pattern: WorkflowPattern): GeneratedSkill {
    const id = `skill-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const name = this.generateSkillName(pattern);

    return {
      id,
      name,
      type: 'workflow-pattern',
      pattern: pattern.sequence,
      steps: pattern.states,
      triggers: this.identifyTriggers(pattern),
      generatedFrom: pattern.sources,
      occurrences: pattern.occurrences,
      successRate: pattern.successRate,
      averageDuration: pattern.averageDuration,
      confidence: this.calculateConfidence(pattern),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      autoApply: pattern.successRate >= 0.85
    };
  }

  /**
   * Generate skill name from pattern
   */
  private generateSkillName(pattern: WorkflowPattern): string {
    const states = pattern.states;

    if (states.length === 0) {
      return `pattern-${Date.now()}`;
    }

    // Use first and last states
    const first = states[0].toLowerCase().replace(/_/g, '-');
    const last = states[states.length - 1].toLowerCase().replace(/_/g, '-');

    return `auto-${first}-to-${last}`;
  }

  /**
   * Identify triggers for skill
   */
  private identifyTriggers(pattern: WorkflowPattern): string[] {
    const triggers: string[] = [];

    if (pattern.states.length > 0) {
      triggers.push(`state:${pattern.states[0]}`);
    }

    // Add common triggers based on pattern type
    if (pattern.sequence.includes('TEST')) {
      triggers.push('event:tests:needed');
    }

    if (pattern.sequence.includes('REVIEW')) {
      triggers.push('event:review:requested');
    }

    if (pattern.sequence.includes('DEPLOY')) {
      triggers.push('event:deploy:ready');
    }

    return triggers;
  }

  /**
   * Calculate confidence score
   */
  private calculateConfidence(pattern: WorkflowPattern): number {
    // Confidence based on occurrences and success rate
    const occurrenceFactor = Math.min(pattern.occurrences / 10, 1);
    const successFactor = pattern.successRate;
    const consistencyFactor = pattern.averageDuration > 0 ? 0.9 : 0.5;

    return (occurrenceFactor * 0.3) + (successFactor * 0.5) + (consistencyFactor * 0.2);
  }

  /**
   * Persist skill to IndexedDB
   */
  private async persistSkill(skill: GeneratedSkill): Promise<void> {
    const kbSkill: KBSkill = {
      id: skill.id,
      name: skill.name,
      pattern: skill.pattern,
      generatedFrom: skill.generatedFrom,
      occurrences: skill.occurrences,
      successRate: skill.successRate,
      averageDuration: skill.averageDuration,
      createdAt: skill.createdAt,
      updatedAt: skill.updatedAt
    };

    await KnowledgeBase.put(STORES.SKILLS, kbSkill);
  }

  /**
   * Get all generated skills
   */
  list(): GeneratedSkill[] {
    return Array.from(this.generatedSkills.values());
  }

  /**
   * Get skill by ID
   */
  get(id: string): GeneratedSkill | undefined {
    return this.generatedSkills.get(id);
  }

  /**
   * Get skills that can auto-apply
   */
  getAutoApplicable(): GeneratedSkill[] {
    return this.list().filter(s => s.autoApply);
  }

  /**
   * Get skills for a trigger
   */
  getForTrigger(trigger: string): GeneratedSkill[] {
    return this.list().filter(s => s.triggers.includes(trigger));
  }

  /**
   * Apply skill to current context
   */
  async apply(skillId: string): Promise<boolean> {
    const skill = this.generatedSkills.get(skillId);
    if (!skill) return false;

    EventBus.emit('skill:applying', { skill });

    // Mark as applied
    skill.occurrences++;
    skill.updatedAt = Date.now();
    await this.persistSkill(skill);

    EventBus.emit('skill:applied', { skill });

    return true;
  }

  /**
   * Delete a generated skill
   */
  async delete(skillId: string): Promise<boolean> {
    if (!this.generatedSkills.has(skillId)) return false;

    this.generatedSkills.delete(skillId);
    await KnowledgeBase.delete(STORES.SKILLS, skillId);

    return true;
  }

  /**
   * Get generation statistics
   */
  getStats(): {
    totalSkills: number;
    autoApplicable: number;
    averageSuccessRate: number;
    averageConfidence: number;
    byType: Record<string, number>;
  } {
    const skills = this.list();

    if (skills.length === 0) {
      return {
        totalSkills: 0,
        autoApplicable: 0,
        averageSuccessRate: 0,
        averageConfidence: 0,
        byType: {}
      };
    }

    const byType: Record<string, number> = {};
    let totalSuccessRate = 0;
    let totalConfidence = 0;

    for (const skill of skills) {
      byType[skill.type] = (byType[skill.type] || 0) + 1;
      totalSuccessRate += skill.successRate;
      totalConfidence += skill.confidence;
    }

    return {
      totalSkills: skills.length,
      autoApplicable: skills.filter(s => s.autoApply).length,
      averageSuccessRate: totalSuccessRate / skills.length,
      averageConfidence: totalConfidence / skills.length,
      byType
    };
  }

  /**
   * Clear all generated skills
   */
  async clear(): Promise<void> {
    this.generatedSkills.clear();
    await KnowledgeBase.clearStore(STORES.SKILLS);
  }
}

// Export singleton
export const SkillGenerator = new SkillGeneratorClass();

// Export class for testing
export { SkillGeneratorClass };

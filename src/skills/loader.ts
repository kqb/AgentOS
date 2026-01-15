/**
 * Skill Loader
 *
 * Loads and validates skill definitions from JSON files.
 */

import { EventBus } from '../core/event-bus.js';
import type { SkillConfig, SkillInput, SkillOutput } from '../types/skill.js';

/** Loaded skill with metadata */
export interface LoadedSkill {
  config: SkillConfig;
  path: string;
  loadedAt: number;
  valid: boolean;
  validationErrors: string[];
}

/** Validation result */
interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Skill Loader class
 */
class SkillLoaderClass {
  private loadedSkills: Map<string, LoadedSkill> = new Map();

  /**
   * Load a skill from a JSON object
   */
  load(skillData: unknown, path = 'inline'): LoadedSkill {
    const validation = this.validate(skillData);

    const loadedSkill: LoadedSkill = {
      config: validation.valid ? (skillData as SkillConfig) : this.createEmptyConfig(),
      path,
      loadedAt: Date.now(),
      valid: validation.valid,
      validationErrors: validation.errors
    };

    if (validation.valid) {
      this.loadedSkills.set(loadedSkill.config.name, loadedSkill);
      EventBus.emit('skill:loaded', { name: loadedSkill.config.name, path });
    } else {
      EventBus.emit('skill:load:failed', { path, errors: validation.errors });
    }

    return loadedSkill;
  }

  /**
   * Validate skill definition
   */
  validate(skillData: unknown): ValidationResult {
    const errors: string[] = [];

    if (!skillData || typeof skillData !== 'object') {
      return { valid: false, errors: ['Skill data must be an object'] };
    }

    const skill = skillData as Record<string, unknown>;

    // Required fields
    if (!skill.name || typeof skill.name !== 'string') {
      errors.push('Missing or invalid "name" field');
    } else if (!/^[a-z][a-z0-9-]*$/.test(skill.name)) {
      errors.push('Name must start with lowercase letter and contain only lowercase letters, numbers, and hyphens');
    }

    if (!skill.version || typeof skill.version !== 'string') {
      errors.push('Missing or invalid "version" field');
    } else if (!/^\d+\.\d+\.\d+$/.test(skill.version)) {
      errors.push('Version must be semantic (e.g., 1.0.0)');
    }

    if (!skill.description || typeof skill.description !== 'string') {
      errors.push('Missing or invalid "description" field');
    }

    // Inputs validation
    if (!Array.isArray(skill.inputs)) {
      errors.push('Missing or invalid "inputs" field (must be array)');
    } else {
      skill.inputs.forEach((input: unknown, idx: number) => {
        const inputErrors = this.validateInput(input, idx);
        errors.push(...inputErrors);
      });
    }

    // Outputs validation
    if (!Array.isArray(skill.outputs)) {
      errors.push('Missing or invalid "outputs" field (must be array)');
    } else {
      skill.outputs.forEach((output: unknown, idx: number) => {
        const outputErrors = this.validateOutput(output, idx);
        errors.push(...outputErrors);
      });
    }

    // Prompts validation
    if (!skill.prompts || typeof skill.prompts !== 'object') {
      errors.push('Missing or invalid "prompts" field');
    } else {
      const prompts = skill.prompts as Record<string, unknown>;
      if (!prompts.system || typeof prompts.system !== 'string') {
        errors.push('Missing or invalid "prompts.system" field');
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Validate input definition
   */
  private validateInput(input: unknown, index: number): string[] {
    const errors: string[] = [];
    const prefix = `inputs[${index}]`;

    if (!input || typeof input !== 'object') {
      return [`${prefix}: must be an object`];
    }

    const inp = input as Record<string, unknown>;

    if (!inp.name || typeof inp.name !== 'string') {
      errors.push(`${prefix}: missing or invalid "name"`);
    }

    const validTypes = ['string', 'number', 'boolean', 'object', 'string[]', 'object[]'];
    if (!inp.type || !validTypes.includes(inp.type as string)) {
      errors.push(`${prefix}: invalid "type" (must be one of: ${validTypes.join(', ')})`);
    }

    return errors;
  }

  /**
   * Validate output definition
   */
  private validateOutput(output: unknown, index: number): string[] {
    const errors: string[] = [];
    const prefix = `outputs[${index}]`;

    if (!output || typeof output !== 'object') {
      return [`${prefix}: must be an object`];
    }

    const out = output as Record<string, unknown>;

    if (!out.name || typeof out.name !== 'string') {
      errors.push(`${prefix}: missing or invalid "name"`);
    }

    const validTypes = ['string', 'number', 'boolean', 'object', 'string[]', 'object[]'];
    if (!out.type || !validTypes.includes(out.type as string)) {
      errors.push(`${prefix}: invalid "type" (must be one of: ${validTypes.join(', ')})`);
    }

    return errors;
  }

  /**
   * Create empty config for invalid skills
   */
  private createEmptyConfig(): SkillConfig {
    return {
      name: 'invalid',
      version: '0.0.0',
      description: 'Invalid skill',
      inputs: [],
      outputs: [],
      prompts: { system: '', completionSignal: '' }
    };
  }

  /**
   * Get a loaded skill
   */
  get(name: string): LoadedSkill | null {
    return this.loadedSkills.get(name) || null;
  }

  /**
   * List all loaded skills
   */
  list(): LoadedSkill[] {
    return Array.from(this.loadedSkills.values());
  }

  /**
   * Unload a skill
   */
  unload(name: string): boolean {
    const result = this.loadedSkills.delete(name);
    if (result) {
      EventBus.emit('skill:unloaded', { name });
    }
    return result;
  }

  /**
   * Clear all loaded skills
   */
  clear(): void {
    this.loadedSkills.clear();
    EventBus.emit('skill:cleared', {});
  }
}

// Export singleton instance
export const SkillLoader = new SkillLoaderClass();

// Also export the class for testing
export { SkillLoaderClass };

/**
 * KBImporter - Import knowledge from various sources
 *
 * Supports:
 * - File upload (JSON)
 * - URL fetch
 * - Clipboard paste
 * - Direct data import
 *
 * Handles merging with conflict resolution
 */

import { EventBus } from '../core/event-bus.js';
import { ImprovementScheduler } from '../improvement/scheduler.js';
import { PatternMiner } from '../improvement/pattern-miner.js';
import { PromptRefiner } from '../improvement/prompt-refiner.js';
import { KnowledgeExtractor } from '../improvement/knowledge-extractor.js';
import { FeedbackCollector } from '../improvement/feedback-collector.js';
import { DecisionLogger } from '../improvement/decision-logger.js';
import { HumanFeedback } from '../improvement/human-feedback.js';
import { EXPORT_VERSION, TeamKnowledgeExport } from './exporter.js';

/** Import statistics */
export interface ImportStats {
  patterns: number;
  rules: number;
  knowledge: number;
  skills: number;
  documents: number;
  entities: number;
  relationships: number;
  feedback: number;
  decisions: number;
  conflicts: number;
  skipped: number;
  errors: string[];
}

/** Import options */
export interface ImportOptions {
  mergeStrategy: 'merge' | 'replace' | 'skip-existing';
  importPatterns: boolean;
  importRules: boolean;
  importKnowledge: boolean;
  importDocuments: boolean;
  importFeedback: boolean;
  importDecisions: boolean;
  dryRun: boolean;
}

/** Default import options */
const DEFAULT_OPTIONS: ImportOptions = {
  mergeStrategy: 'merge',
  importPatterns: true,
  importRules: true,
  importKnowledge: true,
  importDocuments: true,
  importFeedback: true,
  importDecisions: true,
  dryRun: false
};

/** Importer singleton */
class KBImporterClass {

  /**
   * Import from file (File API)
   */
  async importFromFile(file: File, options?: Partial<ImportOptions>): Promise<ImportStats> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = async (e) => {
        try {
          const text = e.target?.result as string;
          const data = JSON.parse(text) as TeamKnowledgeExport;
          const result = await this.importData(data, options);
          resolve(result);
        } catch (err) {
          reject(new Error(`Failed to parse file: ${(err as Error).message}`));
        }
      };

      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  }

  /**
   * Import from URL
   */
  async importFromUrl(url: string, options?: Partial<ImportOptions>): Promise<ImportStats> {
    console.log(`[KBImporter] Fetching from URL: ${url}`);

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as TeamKnowledgeExport;
    return this.importData(data, options);
  }

  /**
   * Import from clipboard
   */
  async importFromClipboard(options?: Partial<ImportOptions>): Promise<ImportStats> {
    const text = await navigator.clipboard.readText();

    try {
      const data = JSON.parse(text) as TeamKnowledgeExport;
      return this.importData(data, options);
    } catch {
      throw new Error('Clipboard does not contain valid JSON');
    }
  }

  /**
   * Import from data object
   */
  async importData(
    data: TeamKnowledgeExport,
    options?: Partial<ImportOptions>
  ): Promise<ImportStats> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    console.log(`[KBImporter] Importing data from ${new Date(data.exportedAt).toISOString()}`);

    // Validate version
    if (!data.version) {
      throw new Error('Invalid export file: missing version');
    }

    if (data.version !== EXPORT_VERSION) {
      console.warn(`[KBImporter] Version mismatch: expected ${EXPORT_VERSION}, got ${data.version}`);
    }

    const stats: ImportStats = {
      patterns: 0,
      rules: 0,
      knowledge: 0,
      skills: 0,
      documents: 0,
      entities: 0,
      relationships: 0,
      feedback: 0,
      decisions: 0,
      conflicts: 0,
      skipped: 0,
      errors: []
    };

    if (opts.dryRun) {
      console.log('[KBImporter] Dry run - no changes will be made');
    }

    try {
      // Import patterns
      if (opts.importPatterns && data.patterns) {
        const result = await this.importPatterns(data.patterns, opts);
        stats.patterns = result.imported;
        stats.conflicts += result.conflicts;
        stats.skipped += result.skipped;
      }

      // Import rules
      if (opts.importRules && data.rules) {
        const result = await this.importRules(data.rules, opts);
        stats.rules = result.imported;
        stats.conflicts += result.conflicts;
        stats.skipped += result.skipped;
      }

      // Import knowledge
      if (opts.importKnowledge && data.knowledge) {
        const result = await this.importKnowledge(data.knowledge, opts);
        stats.knowledge = result.imported;
        stats.conflicts += result.conflicts;
        stats.skipped += result.skipped;
      }

      // Import documents
      if (opts.importDocuments && data.documents) {
        const result = await this.importDocuments(data.documents, opts);
        stats.documents = result.imported;
        stats.conflicts += result.conflicts;
        stats.skipped += result.skipped;
      }

      // Import entities
      if (opts.importDocuments && data.entities) {
        const result = await this.importEntities(data.entities, opts);
        stats.entities = result.imported;
        stats.conflicts += result.conflicts;
        stats.skipped += result.skipped;
      }

      // Import relationships
      if (opts.importDocuments && data.relationships) {
        const result = await this.importRelationships(data.relationships, opts);
        stats.relationships = result.imported;
        stats.conflicts += result.conflicts;
        stats.skipped += result.skipped;
      }

      // Import skills
      if (data.skills) {
        const result = await this.importSkills(data.skills, opts);
        stats.skills = result.imported;
        stats.conflicts += result.conflicts;
        stats.skipped += result.skipped;
      }

      // Import feedback
      if (opts.importFeedback && data.feedback) {
        const result = await this.importFeedback(data.feedback, opts);
        stats.feedback = result.imported;
      }

      // Import decisions
      if (opts.importDecisions && data.decisions) {
        const result = await this.importDecisions(data.decisions, opts);
        stats.decisions = result.imported;
      }

      // Import human feedback
      if (opts.importFeedback && data.humanFeedback) {
        await this.importHumanFeedback(data.humanFeedback, opts);
      }

    } catch (error) {
      stats.errors.push((error as Error).message);
    }

    EventBus.emit('kb:imported', {
      timestamp: Date.now(),
      stats,
      source: data.exportedBy
    });

    console.log('[KBImporter] Import complete:', stats);

    return stats;
  }

  /**
   * Import patterns
   */
  private async importPatterns(
    patterns: unknown[],
    opts: ImportOptions
  ): Promise<{ imported: number; conflicts: number; skipped: number }> {
    if (opts.dryRun) {
      return { imported: patterns.length, conflicts: 0, skipped: 0 };
    }

    let imported = 0;
    let conflicts = 0;
    let skipped = 0;

    // PatternMiner stores patterns in memory - import directly
    PatternMiner.importData(patterns as ReturnType<typeof PatternMiner.exportData>);
    imported = patterns.length;

    return { imported, conflicts, skipped };
  }

  /**
   * Import rules
   */
  private async importRules(
    rules: unknown[],
    opts: ImportOptions
  ): Promise<{ imported: number; conflicts: number; skipped: number }> {
    if (opts.dryRun) {
      return { imported: rules.length, conflicts: 0, skipped: 0 };
    }

    let imported = 0;
    let conflicts = 0;
    let skipped = 0;

    const existingRules = PromptRefiner.getRules();

    for (const rule of rules) {
      const r = rule as { id?: string; rule?: string };

      // Check for duplicates
      const exists = existingRules.some(e =>
        (e as { id?: string }).id === r.id ||
        (e as { rule?: string }).rule === r.rule
      );

      if (exists) {
        if (opts.mergeStrategy === 'skip-existing') {
          skipped++;
          continue;
        } else if (opts.mergeStrategy === 'merge') {
          conflicts++;
          // In merge mode, keep both but mark conflict
        }
      }

      imported++;
    }

    // Import all rules
    PromptRefiner.importData(rules as ReturnType<typeof PromptRefiner.exportData>);

    return { imported, conflicts, skipped };
  }

  /**
   * Import knowledge entries
   */
  private async importKnowledge(
    knowledge: unknown[],
    opts: ImportOptions
  ): Promise<{ imported: number; conflicts: number; skipped: number }> {
    if (opts.dryRun) {
      return { imported: knowledge.length, conflicts: 0, skipped: 0 };
    }

    let imported = 0;
    let conflicts = 0;
    let skipped = 0;

    const existing = KnowledgeExtractor.getKnowledge();

    for (const k of knowledge) {
      const entry = k as { id?: string; title?: string };

      // Check for duplicates by ID or title
      const exists = existing.some(e =>
        (e as { id?: string }).id === entry.id ||
        (e as { title?: string }).title === entry.title
      );

      if (exists) {
        if (opts.mergeStrategy === 'skip-existing') {
          skipped++;
          continue;
        }
        conflicts++;
      }

      imported++;
    }

    KnowledgeExtractor.importData(knowledge as ReturnType<typeof KnowledgeExtractor.exportData>);

    return { imported, conflicts, skipped };
  }

  /**
   * Import documents to KnowledgeBase
   */
  private async importDocuments(
    documents: unknown[],
    opts: ImportOptions
  ): Promise<{ imported: number; conflicts: number; skipped: number }> {
    if (opts.dryRun || documents.length === 0) {
      return { imported: documents.length, conflicts: 0, skipped: 0 };
    }

    let imported = 0;
    let conflicts = 0;
    let skipped = 0;

    try {
      const { KnowledgeBase } = await import('../knowledge/kb.js');
      const { DocumentStore } = await import('../knowledge/document-store.js');

      for (const doc of documents) {
        const d = doc as { id?: string; url?: string };

        // Check for existing by URL
        const existing = await DocumentStore.getByUrl(d.url || '').catch(() => null);

        if (existing) {
          if (opts.mergeStrategy === 'skip-existing') {
            skipped++;
            continue;
          }
          conflicts++;
        }

        // Add or update
        await DocumentStore.add(doc as Parameters<typeof DocumentStore.add>[0]);
        imported++;
      }
    } catch {
      console.warn('[KBImporter] KnowledgeBase not available, skipping documents');
    }

    return { imported, conflicts, skipped };
  }

  /**
   * Import entities to KnowledgeBase
   */
  private async importEntities(
    entities: unknown[],
    opts: ImportOptions
  ): Promise<{ imported: number; conflicts: number; skipped: number }> {
    if (opts.dryRun || entities.length === 0) {
      return { imported: entities.length, conflicts: 0, skipped: 0 };
    }

    let imported = 0;
    let conflicts = 0;
    let skipped = 0;

    try {
      const { EntityStore } = await import('../knowledge/entity-store.js');

      for (const entity of entities) {
        const e = entity as { id?: string };

        const existing = await EntityStore.get(e.id || '').catch(() => null);

        if (existing) {
          if (opts.mergeStrategy === 'skip-existing') {
            skipped++;
            continue;
          }
          conflicts++;
        }

        await EntityStore.add(entity as Parameters<typeof EntityStore.add>[0]);
        imported++;
      }
    } catch {
      console.warn('[KBImporter] EntityStore not available, skipping entities');
    }

    return { imported, conflicts, skipped };
  }

  /**
   * Import relationships to KnowledgeBase
   */
  private async importRelationships(
    relationships: unknown[],
    opts: ImportOptions
  ): Promise<{ imported: number; conflicts: number; skipped: number }> {
    if (opts.dryRun || relationships.length === 0) {
      return { imported: relationships.length, conflicts: 0, skipped: 0 };
    }

    let imported = 0;
    let conflicts = 0;
    let skipped = 0;

    try {
      const { RelationshipStore } = await import('../knowledge/relationship-store.js');

      for (const rel of relationships) {
        const r = rel as { id?: string };

        const existing = await RelationshipStore.get(r.id || '').catch(() => null);

        if (existing) {
          if (opts.mergeStrategy === 'skip-existing') {
            skipped++;
            continue;
          }
          conflicts++;
        }

        await RelationshipStore.add(rel as Parameters<typeof RelationshipStore.add>[0]);
        imported++;
      }
    } catch {
      console.warn('[KBImporter] RelationshipStore not available, skipping relationships');
    }

    return { imported, conflicts, skipped };
  }

  /**
   * Import skills to KnowledgeBase
   */
  private async importSkills(
    skills: unknown[],
    opts: ImportOptions
  ): Promise<{ imported: number; conflicts: number; skipped: number }> {
    if (opts.dryRun || skills.length === 0) {
      return { imported: skills.length, conflicts: 0, skipped: 0 };
    }

    let imported = 0;
    let conflicts = 0;
    let skipped = 0;

    try {
      const { KnowledgeBase } = await import('../knowledge/kb.js');

      for (const skill of skills) {
        const s = skill as { id?: string };

        const existing = await KnowledgeBase.get(KnowledgeBase.stores.SKILLS, s.id || '').catch(() => null);

        if (existing) {
          if (opts.mergeStrategy === 'skip-existing') {
            skipped++;
            continue;
          }
          conflicts++;
        }

        await KnowledgeBase.put(KnowledgeBase.stores.SKILLS, skill);
        imported++;
      }
    } catch {
      console.warn('[KBImporter] KnowledgeBase not available, skipping skills');
    }

    return { imported, conflicts, skipped };
  }

  /**
   * Import feedback entries
   */
  private async importFeedback(
    feedback: unknown[],
    opts: ImportOptions
  ): Promise<{ imported: number }> {
    if (opts.dryRun) {
      return { imported: feedback.length };
    }

    FeedbackCollector.importData({
      feedback: feedback as ReturnType<typeof FeedbackCollector.exportData>['feedback']
    });

    return { imported: feedback.length };
  }

  /**
   * Import decisions
   */
  private async importDecisions(
    decisions: unknown[],
    opts: ImportOptions
  ): Promise<{ imported: number }> {
    if (opts.dryRun) {
      return { imported: decisions.length };
    }

    DecisionLogger.importData(decisions as ReturnType<typeof DecisionLogger.exportData>);

    return { imported: decisions.length };
  }

  /**
   * Import human feedback
   */
  private async importHumanFeedback(
    humanFeedback: unknown[],
    opts: ImportOptions
  ): Promise<{ imported: number }> {
    if (opts.dryRun) {
      return { imported: humanFeedback.length };
    }

    HumanFeedback.importData(humanFeedback as ReturnType<typeof HumanFeedback.exportData>);

    return { imported: humanFeedback.length };
  }

  /**
   * Validate export data structure
   */
  validateExport(data: unknown): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!data || typeof data !== 'object') {
      errors.push('Data is not an object');
      return { valid: false, errors };
    }

    const d = data as Record<string, unknown>;

    if (!d.version) {
      errors.push('Missing version field');
    }

    if (!d.exportedAt || typeof d.exportedAt !== 'number') {
      errors.push('Missing or invalid exportedAt field');
    }

    if (d.patterns && !Array.isArray(d.patterns)) {
      errors.push('patterns must be an array');
    }

    if (d.rules && !Array.isArray(d.rules)) {
      errors.push('rules must be an array');
    }

    if (d.knowledge && !Array.isArray(d.knowledge)) {
      errors.push('knowledge must be an array');
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Preview import without making changes
   */
  async previewImport(data: TeamKnowledgeExport): Promise<{
    patterns: number;
    rules: number;
    knowledge: number;
    documents: number;
    entities: number;
    skills: number;
    potentialConflicts: number;
  }> {
    const stats = await this.importData(data, { dryRun: true });

    return {
      patterns: stats.patterns,
      rules: stats.rules,
      knowledge: stats.knowledge,
      documents: stats.documents,
      entities: stats.entities,
      skills: stats.skills,
      potentialConflicts: stats.conflicts
    };
  }
}

// Export singleton
export const KBImporter = new KBImporterClass();

// Export class for testing
export { KBImporterClass };

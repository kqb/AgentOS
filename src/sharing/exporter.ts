/**
 * KBExporter - Export knowledge base and improvement data to shareable formats
 *
 * Supports:
 * - Full JSON export (all knowledge types)
 * - Partial exports (patterns, rules, domain knowledge)
 * - Markdown summary for human review
 * - Git sync file generation
 */

import { EventBus } from '../core/event-bus.js';
import { ImprovementScheduler } from '../improvement/scheduler.js';
import { PatternMiner } from '../improvement/pattern-miner.js';
import { PromptRefiner } from '../improvement/prompt-refiner.js';
import { KnowledgeExtractor } from '../improvement/knowledge-extractor.js';
import { FeedbackCollector } from '../improvement/feedback-collector.js';
import { DecisionLogger } from '../improvement/decision-logger.js';
import { HumanFeedback } from '../improvement/human-feedback.js';

/** Export version for compatibility checking */
export const EXPORT_VERSION = '1.0';

/** Full team knowledge export structure */
export interface TeamKnowledgeExport {
  version: string;
  exportedAt: number;
  exportedBy: string;

  // Improvement system data
  feedback: unknown[];
  decisions: unknown[];
  humanFeedback: unknown[];
  patterns: unknown[];
  rules: unknown[];
  knowledge: unknown[];

  // Knowledge base data (documents, entities, relationships)
  documents: unknown[];
  entities: unknown[];
  relationships: unknown[];
  skills: unknown[];

  // Metadata
  stats: {
    totalPatterns: number;
    totalRules: number;
    totalKnowledge: number;
    totalDocuments: number;
    totalEntities: number;
  };
}

/** Pattern export structure */
export interface PatternExport {
  version: string;
  exportedAt: number;
  agentType?: string;
  patterns: unknown[];
}

/** Rule export structure */
export interface RuleExport {
  version: string;
  exportedAt: number;
  agentType?: string;
  rules: unknown[];
  markdown: string;
}

/** Knowledge export structure */
export interface KnowledgeExport {
  version: string;
  exportedAt: number;
  domain?: string;
  entries: unknown[];
}

/** Git sync file structure */
export interface GitSyncFiles {
  [path: string]: unknown;
}

/** Exporter singleton */
class KBExporterClass {
  private authorId: string | null = null;

  /**
   * Get author ID for exports
   */
  getAuthorId(): string {
    if (this.authorId) return this.authorId;

    // Try localStorage first
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem('agentOS_authorId');
      if (stored) {
        this.authorId = stored;
        return stored;
      }
    }

    // Generate new ID
    this.authorId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Store for future use
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('agentOS_authorId', this.authorId);
    }

    return this.authorId;
  }

  /**
   * Set author ID explicitly
   */
  setAuthorId(id: string): void {
    this.authorId = id;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('agentOS_authorId', id);
    }
  }

  /**
   * Export all knowledge (full export)
   */
  async exportAll(): Promise<TeamKnowledgeExport> {
    console.log('[KBExporter] Starting full export...');

    // Get improvement system data
    const improvementData = ImprovementScheduler.exportAllData();

    // Get knowledge base data (if available)
    const kbData = await this.exportKnowledgeBase();

    const exportData: TeamKnowledgeExport = {
      version: EXPORT_VERSION,
      exportedAt: Date.now(),
      exportedBy: this.getAuthorId(),

      // Improvement data
      feedback: improvementData.feedback || [],
      decisions: improvementData.decisions || [],
      humanFeedback: improvementData.humanFeedback || [],
      patterns: improvementData.patterns || [],
      rules: improvementData.rules || [],
      knowledge: improvementData.knowledge || [],

      // KB data
      documents: kbData.documents,
      entities: kbData.entities,
      relationships: kbData.relationships,
      skills: kbData.skills,

      // Stats
      stats: {
        totalPatterns: (improvementData.patterns || []).length,
        totalRules: (improvementData.rules || []).length,
        totalKnowledge: (improvementData.knowledge || []).length,
        totalDocuments: kbData.documents.length,
        totalEntities: kbData.entities.length
      }
    };

    EventBus.emit('kb:exported', {
      timestamp: exportData.exportedAt,
      stats: exportData.stats
    });

    console.log('[KBExporter] Export complete:', exportData.stats);

    return exportData;
  }

  /**
   * Export knowledge base data (documents, entities, relationships, skills)
   */
  private async exportKnowledgeBase(): Promise<{
    documents: unknown[];
    entities: unknown[];
    relationships: unknown[];
    skills: unknown[];
  }> {
    // Try to import KnowledgeBase dynamically
    try {
      const { KnowledgeBase } = await import('../knowledge/kb.js');

      const [documents, entities, relationships, skills] = await Promise.all([
        KnowledgeBase.getAll(KnowledgeBase.stores.DOCUMENTS).catch(() => []),
        KnowledgeBase.getAll(KnowledgeBase.stores.ENTITIES).catch(() => []),
        KnowledgeBase.getAll(KnowledgeBase.stores.RELATIONSHIPS).catch(() => []),
        KnowledgeBase.getAll(KnowledgeBase.stores.SKILLS).catch(() => [])
      ]);

      return { documents, entities, relationships, skills };
    } catch {
      console.warn('[KBExporter] KnowledgeBase not available, skipping KB export');
      return { documents: [], entities: [], relationships: [], skills: [] };
    }
  }

  /**
   * Download export as JSON file
   */
  async downloadExport(filename = 'agentos-knowledge-export.json'): Promise<void> {
    const data = await this.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();

    URL.revokeObjectURL(url);

    console.log(`[KBExporter] Downloaded: ${filename}`);
  }

  /**
   * Export patterns by agent type
   */
  async exportPatterns(agentType?: string): Promise<PatternExport> {
    const patterns = agentType
      ? PatternMiner.getPatternsForAgent(agentType)
      : PatternMiner.getPatterns();

    return {
      version: EXPORT_VERSION,
      exportedAt: Date.now(),
      agentType,
      patterns
    };
  }

  /**
   * Export rules by agent type
   */
  async exportRules(agentType?: string): Promise<RuleExport> {
    const rules = agentType
      ? PromptRefiner.getRulesForAgent(agentType)
      : PromptRefiner.getRules();

    const markdown = agentType
      ? PromptRefiner.generatePromptAdditions(agentType)
      : this.generateAllRulesMarkdown();

    return {
      version: EXPORT_VERSION,
      exportedAt: Date.now(),
      agentType,
      rules,
      markdown
    };
  }

  /**
   * Generate markdown for all rules
   */
  private generateAllRulesMarkdown(): string {
    const agentTypes = ['code-generator', 'test-writer', 'debugger', 'code-reviewer',
                        'doc-writer', 'team-lead', 'qa-engineer', 'researcher'];

    const sections: string[] = ['# All Learned Rules\n'];

    for (const type of agentTypes) {
      const md = PromptRefiner.generatePromptAdditions(type);
      if (md) {
        sections.push(`## ${type}\n`);
        sections.push(md);
        sections.push('\n');
      }
    }

    return sections.join('\n');
  }

  /**
   * Export domain knowledge
   */
  async exportKnowledge(domain?: string): Promise<KnowledgeExport> {
    const allKnowledge = KnowledgeExtractor.getKnowledge();

    const entries = domain
      ? allKnowledge.filter(k => (k as { agentType?: string }).agentType === domain)
      : allKnowledge;

    return {
      version: EXPORT_VERSION,
      exportedAt: Date.now(),
      domain,
      entries
    };
  }

  /**
   * Export as markdown summary (human-readable)
   */
  async exportMarkdownSummary(): Promise<string> {
    const data = await this.exportAll();

    let md = `# AgentOS Knowledge Base Export\n\n`;
    md += `**Exported:** ${new Date(data.exportedAt).toISOString()}\n`;
    md += `**Exported By:** ${data.exportedBy}\n`;
    md += `**Version:** ${data.version}\n\n`;
    md += `---\n\n`;

    // Stats
    md += `## Summary Statistics\n\n`;
    md += `| Metric | Count |\n`;
    md += `|--------|-------|\n`;
    md += `| Patterns | ${data.stats.totalPatterns} |\n`;
    md += `| Rules | ${data.stats.totalRules} |\n`;
    md += `| Knowledge Entries | ${data.stats.totalKnowledge} |\n`;
    md += `| Documents | ${data.stats.totalDocuments} |\n`;
    md += `| Entities | ${data.stats.totalEntities} |\n\n`;

    // Top patterns by agent type
    const agentTypes = ['code-generator', 'test-writer', 'debugger', 'qa-engineer', 'team-lead', 'researcher'];

    for (const agentType of agentTypes) {
      const patterns = PatternMiner.getPatternsForAgent(agentType);
      const rules = PromptRefiner.getAppliedRulesForAgent(agentType);

      if (patterns.length > 0 || rules.length > 0) {
        md += `## ${agentType.toUpperCase()}\n\n`;

        if (patterns.length > 0) {
          md += `### Top Patterns\n\n`;
          const topPatterns = patterns.slice(0, 5);
          for (const p of topPatterns) {
            const pattern = p as { pattern?: { choice?: string }; evidence?: { successRate?: number; occurrences?: number } };
            const choice = pattern.pattern?.choice || 'unknown';
            const rate = pattern.evidence?.successRate || 0;
            const count = pattern.evidence?.occurrences || 0;
            md += `- **${choice}** - ${Math.round(rate * 100)}% success (n=${count})\n`;
          }
          md += '\n';
        }

        if (rules.length > 0) {
          md += `### Applied Rules\n\n`;
          const topRules = rules.slice(0, 5);
          for (const r of topRules) {
            const rule = r as { rule?: string };
            md += `- ${rule.rule || 'unknown'}\n`;
          }
          md += '\n';
        }
      }
    }

    // Knowledge domains
    const knowledge = KnowledgeExtractor.getKnowledge();
    const byType = new Map<string, unknown[]>();

    for (const k of knowledge) {
      const type = (k as { type?: string }).type || 'unknown';
      if (!byType.has(type)) byType.set(type, []);
      byType.get(type)!.push(k);
    }

    if (byType.size > 0) {
      md += `## Domain Knowledge\n\n`;
      for (const [type, items] of byType) {
        md += `### ${type}\n`;
        md += `- ${items.length} entries\n\n`;
      }
    }

    return md;
  }

  /**
   * Generate files for Git sync
   */
  async generateSyncFiles(): Promise<GitSyncFiles> {
    const files: GitSyncFiles = {};
    const agentTypes = ['code-generator', 'test-writer', 'debugger', 'code-reviewer',
                        'doc-writer', 'team-lead', 'qa-engineer', 'researcher'];

    // Patterns by agent type
    for (const type of agentTypes) {
      const patterns = PatternMiner.getPatternsForAgent(type);
      if (patterns.length > 0) {
        const sanitizedType = type.replace(/-/g, '_');
        files[`patterns/${sanitizedType}-patterns.json`] = {
          agentType: type,
          updatedAt: Date.now(),
          updatedBy: this.getAuthorId(),
          patterns: patterns.slice(0, 50) // Top 50 patterns
        };
      }
    }

    // Rules by agent type
    for (const type of agentTypes) {
      const rules = PromptRefiner.getAppliedRulesForAgent(type);
      if (rules.length > 0) {
        const sanitizedType = type.replace(/-/g, '_');
        files[`rules/${sanitizedType}-learned-rules.json`] = {
          agentType: type,
          updatedAt: Date.now(),
          updatedBy: this.getAuthorId(),
          rules
        };

        // Also generate markdown version
        const markdown = PromptRefiner.generatePromptAdditions(type);
        if (markdown) {
          files[`rules/${sanitizedType}-learned-rules.md`] = markdown;
        }
      }
    }

    // Domain knowledge
    const knowledge = KnowledgeExtractor.getKnowledge();
    const byDomain = new Map<string, unknown[]>();

    for (const k of knowledge) {
      const domain = (k as { agentType?: string }).agentType || 'general';
      if (!byDomain.has(domain)) byDomain.set(domain, []);
      byDomain.get(domain)!.push(k);
    }

    for (const [domain, items] of byDomain) {
      const sanitizedDomain = domain.replace(/-/g, '_');
      files[`domain/${sanitizedDomain}.json`] = {
        domain,
        updatedAt: Date.now(),
        entries: items.slice(-100) // Last 100 per domain
      };
    }

    // Skills from KB (if available)
    try {
      const { KnowledgeBase } = await import('../knowledge/kb.js');
      const skills = await KnowledgeBase.getAll(KnowledgeBase.stores.SKILLS);
      if (skills.length > 0) {
        files['skills/generated-skills.json'] = {
          updatedAt: Date.now(),
          skills
        };
      }
    } catch {
      // KB not available
    }

    // Sync manifest
    files['sync-manifest.json'] = {
      lastSync: Date.now(),
      syncedBy: this.getAuthorId(),
      fileCount: Object.keys(files).length,
      version: EXPORT_VERSION
    };

    console.log('[KBExporter] Generated sync files:', Object.keys(files));

    return files;
  }

  /**
   * Generate Git commands for committing sync files
   */
  generateGitCommands(files: GitSyncFiles): string {
    const fileList = Object.keys(files)
      .map(f => `.agentos/knowledge/${f}`)
      .join('\n    ');

    const date = new Date().toISOString().split('T')[0];

    return `
# Files to commit:
    ${fileList}

# Commands:
git add .agentos/knowledge/
git commit -m "AgentOS: Sync knowledge base [${date}]"
git push

# Or use the /kb-commit command
`;
  }

  /**
   * Export for clipboard (JSON string)
   */
  async exportToClipboard(): Promise<void> {
    const data = await this.exportAll();
    const json = JSON.stringify(data, null, 2);

    await navigator.clipboard.writeText(json);

    console.log('[KBExporter] Copied to clipboard');
  }

  /**
   * Export stats only
   */
  getExportStats(): {
    patterns: number;
    rules: number;
    knowledge: number;
    feedback: number;
    decisions: number;
  } {
    return {
      patterns: PatternMiner.getStats().total,
      rules: PromptRefiner.getStats().total,
      knowledge: KnowledgeExtractor.getStats().total,
      feedback: FeedbackCollector.getRecentFeedback(10000).length,
      decisions: DecisionLogger.getStats().total
    };
  }
}

// Export singleton
export const KBExporter = new KBExporterClass();

// Export class for testing
export { KBExporterClass };

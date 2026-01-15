# Team-Wide Knowledge Base Sharing System

## The Problem

Currently:
```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CURRENT STATE (ISOLATED)                             │
│                                                                              │
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                    │
│   │   Dev A     │    │   Dev B     │    │   Dev C     │                    │
│   │             │    │             │    │             │                    │
│   │ ┌─────────┐ │    │ ┌─────────┐ │    │ ┌─────────┐ │                    │
│   │ │Local KB │ │    │ │Local KB │ │    │ │Local KB │ │                    │
│   │ │(IndexDB)│ │    │ │(IndexDB)│ │    │ │(IndexDB)│ │                    │
│   │ └─────────┘ │    │ └─────────┘ │    │ └─────────┘ │                    │
│   └─────────────┘    └─────────────┘    └─────────────┘                    │
│                                                                              │
│   ❌ Dev A learns something → Dev B/C don't benefit                         │
│   ❌ Duplicate discovery across team                                         │
│   ❌ Knowledge lost when dev leaves                                          │
│   ❌ No institutional memory                                                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

What we need:
```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         TARGET STATE (SHARED)                                │
│                                                                              │
│                    ┌─────────────────────────────┐                          │
│                    │     SHARED KNOWLEDGE BASE    │                          │
│                    │   (Git / S3 / Confluence)    │                          │
│                    └──────────────┬──────────────┘                          │
│                                   │                                          │
│              ┌────────────────────┼────────────────────┐                    │
│              │                    │                    │                    │
│              ▼                    ▼                    ▼                    │
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                    │
│   │   Dev A     │    │   Dev B     │    │   Dev C     │                    │
│   │             │    │             │    │             │                    │
│   │ ┌─────────┐ │    │ ┌─────────┐ │    │ ┌─────────┐ │                    │
│   │ │Local KB │ │    │ │Local KB │ │    │ │Local KB │ │                    │
│   │ │ + Sync  │ │    │ │ + Sync  │ │    │ │ + Sync  │ │                    │
│   │ └─────────┘ │    │ └─────────┘ │    │ └─────────┘ │                    │
│   └─────────────┘    └─────────────┘    └─────────────┘                    │
│                                                                              │
│   ✅ Dev A learns → Everyone benefits automatically                         │
│   ✅ Patterns discovered once, shared forever                               │
│   ✅ Knowledge persists beyond individuals                                  │
│   ✅ Institutional memory grows over time                                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Part 1: Sync Strategy Options

Given enterprise constraints, here are viable options ranked by practicality:

| Option | Pros | Cons | Best For |
|--------|------|------|----------|
| **Git Repo** | Version control, diffs, PRs | Requires commits | Teams with shared repos |
| **S3/Cloud Storage** | Simple, reliable | Needs AWS access | Teams with cloud access |
| **Confluence** | Already approved | Slow, limited API | Documentation-heavy teams |
| **Shared Network Drive** | No new tools | File locking issues | Air-gapped environments |
| **GitHub Gist** | Free, simple | Public or paid | Small teams |
| **Export/Import Files** | Works anywhere | Manual process | Offline/restricted |

### Recommended: Git-Based Sync

Since you're already using Git for code, this is the path of least resistance:

```
team-repo/
├── src/
├── .windsurf/
│   └── rules/
└── .agentos/                    # NEW: Shared knowledge
    ├── knowledge/
    │   ├── patterns/
    │   │   ├── swe-patterns.json
    │   │   ├── qa-patterns.json
    │   │   └── team-lead-patterns.json
    │   ├── rules/
    │   │   ├── swe-learned-rules.md
    │   │   ├── qa-learned-rules.md
    │   │   └── team-lead-learned-rules.md
    │   ├── domain/
    │   │   ├── auth.json
    │   │   ├── database.json
    │   │   └── api.json
    │   └── skills/
    │       └── generated-skills.json
    ├── workflows/
    │   └── workflow-templates.json
    └── sync-manifest.json       # Tracks sync state
```

---

## Part 2: Knowledge Sync Implementation

### 2.1 Sync Manager

```javascript
// kb-sync-manager.js
// Handles bidirectional sync between local IndexedDB and shared storage

const KBSyncManager = {
  config: {
    syncMethod: 'git', // 'git' | 's3' | 'confluence' | 'file'
    syncPath: '.agentos/knowledge',
    syncInterval: 300000, // 5 minutes
    conflictResolution: 'merge', // 'merge' | 'local-wins' | 'remote-wins'
    autoSync: true
  },

  state: {
    lastSync: null,
    pendingChanges: [],
    syncInProgress: false,
    conflicts: []
  },

  // Initialize sync system
  async init(config = {}) {
    Object.assign(this.config, config);
    
    // Load sync state
    await this.loadSyncState();
    
    // Register change listeners
    this.registerChangeListeners();
    
    // Start auto-sync if enabled
    if (this.config.autoSync) {
      this.startAutoSync();
    }
    
    console.log('[KBSync] Initialized with method:', this.config.syncMethod);
  },

  registerChangeListeners() {
    // Listen for local knowledge changes
    EventBus.on('knowledge:added', (entry) => {
      this.queueChange('add', 'knowledge', entry);
    });
    
    EventBus.on('pattern:discovered', (pattern) => {
      this.queueChange('add', 'patterns', pattern);
    });
    
    EventBus.on('rule:generated', (rule) => {
      this.queueChange('add', 'rules', rule);
    });
    
    EventBus.on('skill:created', (skill) => {
      this.queueChange('add', 'skills', skill);
    });
  },

  queueChange(action, type, data) {
    this.state.pendingChanges.push({
      id: `change-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      action,
      type,
      data,
      timestamp: Date.now(),
      author: this.getAuthorId()
    });
    
    this.saveSyncState();
  },

  getAuthorId() {
    // Try to get from git config or environment
    return localStorage.getItem('agentOS_authorId') || 
           `user-${Math.random().toString(36).slice(2, 8)}`;
  },

  // ==========================================================================
  // SYNC OPERATIONS
  // ==========================================================================

  async sync() {
    if (this.state.syncInProgress) {
      console.log('[KBSync] Sync already in progress');
      return;
    }
    
    this.state.syncInProgress = true;
    console.log('[KBSync] Starting sync...');
    
    try {
      // 1. Pull remote changes
      const remoteChanges = await this.pullRemote();
      
      // 2. Detect conflicts
      const conflicts = this.detectConflicts(remoteChanges, this.state.pendingChanges);
      
      // 3. Resolve conflicts
      const resolved = await this.resolveConflicts(conflicts);
      
      // 4. Merge remote changes into local
      await this.mergeRemoteToLocal(remoteChanges, resolved);
      
      // 5. Push local changes to remote
      await this.pushLocal();
      
      // 6. Update sync state
      this.state.lastSync = Date.now();
      this.state.pendingChanges = [];
      this.saveSyncState();
      
      console.log('[KBSync] Sync completed successfully');
      EventBus.emit('kb:sync_complete', { timestamp: this.state.lastSync });
      
    } catch (error) {
      console.error('[KBSync] Sync failed:', error);
      EventBus.emit('kb:sync_failed', { error });
    } finally {
      this.state.syncInProgress = false;
    }
  },

  async pullRemote() {
    switch (this.config.syncMethod) {
      case 'git':
        return this.pullFromGit();
      case 's3':
        return this.pullFromS3();
      case 'confluence':
        return this.pullFromConfluence();
      case 'file':
        return this.pullFromFile();
      default:
        throw new Error(`Unknown sync method: ${this.config.syncMethod}`);
    }
  },

  async pushLocal() {
    switch (this.config.syncMethod) {
      case 'git':
        return this.pushToGit();
      case 's3':
        return this.pushToS3();
      case 'confluence':
        return this.pushToConfluence();
      case 'file':
        return this.pushToFile();
    }
  },

  // ==========================================================================
  // GIT SYNC
  // ==========================================================================

  async pullFromGit() {
    // This runs in Windsurf's terminal or via Cascade
    const syncPath = this.config.syncPath;
    
    // Read current remote state from files
    const files = await this.readGitFiles(syncPath);
    
    return this.parseRemoteState(files);
  },

  async readGitFiles(basePath) {
    const files = {};
    
    // These would be read via file system or git commands
    const paths = [
      'patterns/swe-patterns.json',
      'patterns/qa-patterns.json',
      'patterns/team-lead-patterns.json',
      'rules/swe-learned-rules.md',
      'rules/qa-learned-rules.md',
      'domain/auth.json',
      'domain/database.json',
      'skills/generated-skills.json',
      'sync-manifest.json'
    ];
    
    for (const path of paths) {
      try {
        // In practice, read from filesystem
        const content = localStorage.getItem(`git_sync_${path}`);
        if (content) {
          files[path] = JSON.parse(content);
        }
      } catch (e) {
        console.warn(`[KBSync] Could not read ${path}`);
      }
    }
    
    return files;
  },

  async pushToGit() {
    // Generate files to commit
    const files = await this.generateSyncFiles();
    
    // In practice, this would:
    // 1. Write files to .agentos/knowledge/
    // 2. Stage changes: git add .agentos/
    // 3. Commit: git commit -m "AgentOS: Sync knowledge base"
    // 4. Push: git push
    
    // For now, simulate with localStorage
    for (const [path, content] of Object.entries(files)) {
      localStorage.setItem(`git_sync_${path}`, JSON.stringify(content));
    }
    
    console.log('[KBSync] Pushed to Git:', Object.keys(files));
    
    // Generate commit command for user
    this.generateGitCommands(files);
  },

  async generateSyncFiles() {
    const files = {};
    
    // Patterns by agent type
    const agentTypes = ['swe', 'qa', 'team-lead', 'debugger', 'researcher'];
    for (const type of agentTypes) {
      const patterns = PatternMiner.mineSuccessPatterns(type);
      if (patterns.length > 0) {
        files[`patterns/${type}-patterns.json`] = {
          agentType: type,
          updatedAt: Date.now(),
          updatedBy: this.getAuthorId(),
          patterns: patterns.slice(0, 50) // Top 50 patterns
        };
      }
    }
    
    // Learned rules
    for (const type of agentTypes) {
      const rules = PromptRefiner.learnedRules[type];
      if (rules) {
        files[`rules/${type}-learned-rules.md`] = {
          agentType: type,
          updatedAt: Date.now(),
          updatedBy: this.getAuthorId(),
          markdown: PromptRefiner.generateRuleMarkdown(type),
          structured: rules
        };
      }
    }
    
    // Domain knowledge
    const allKnowledge = KnowledgeExtractor.knowledge;
    const byDomain = {};
    for (const k of allKnowledge) {
      const domain = k.domain || 'general';
      if (!byDomain[domain]) byDomain[domain] = [];
      byDomain[domain].push(k);
    }
    for (const [domain, items] of Object.entries(byDomain)) {
      files[`domain/${domain}.json`] = {
        domain,
        updatedAt: Date.now(),
        entries: items.slice(-100) // Last 100 per domain
      };
    }
    
    // Skills
    const skills = await KnowledgeBase.getAll(KnowledgeBase.stores.skills);
    if (skills.length > 0) {
      files['skills/generated-skills.json'] = {
        updatedAt: Date.now(),
        skills
      };
    }
    
    // Sync manifest
    files['sync-manifest.json'] = {
      lastSync: Date.now(),
      syncedBy: this.getAuthorId(),
      fileCount: Object.keys(files).length,
      version: '1.0'
    };
    
    return files;
  },

  generateGitCommands(files) {
    const fileList = Object.keys(files).map(f => `.agentos/knowledge/${f}`).join('\n    ');
    
    console.log(`
%c╔══════════════════════════════════════════════════════════════════════════════╗
║  📤 GIT SYNC - Run these commands to share knowledge:                         ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                               ║
║  # Files to commit:                                                           ║
║    ${fileList.split('\n').join('\n║    ')}
║                                                                               ║
║  # Commands:                                                                  ║
║  git add .agentos/knowledge/                                                  ║
║  git commit -m "AgentOS: Sync knowledge base [${new Date().toISOString().split('T')[0]}]"       ║
║  git push                                                                     ║
║                                                                               ║
║  # Or use: /kb-commit                                                         ║
╚══════════════════════════════════════════════════════════════════════════════╝`,
      'color: #4caf50; font-family: monospace;'
    );
  },

  // ==========================================================================
  // CONFLICT RESOLUTION
  // ==========================================================================

  detectConflicts(remoteChanges, localChanges) {
    const conflicts = [];
    
    for (const local of localChanges) {
      const remote = remoteChanges.find(r => 
        r.type === local.type && 
        this.isSameEntity(r.data, local.data)
      );
      
      if (remote && remote.timestamp !== local.timestamp) {
        conflicts.push({
          local,
          remote,
          type: local.type
        });
      }
    }
    
    return conflicts;
  },

  isSameEntity(a, b) {
    // Compare by ID or key fields
    if (a.id && b.id) return a.id === b.id;
    if (a.pattern && b.pattern) return a.pattern === b.pattern;
    if (a.choice && b.choice) return a.choice === b.choice;
    return false;
  },

  async resolveConflicts(conflicts) {
    if (conflicts.length === 0) return [];
    
    const resolved = [];
    
    for (const conflict of conflicts) {
      let winner;
      
      switch (this.config.conflictResolution) {
        case 'local-wins':
          winner = conflict.local;
          break;
          
        case 'remote-wins':
          winner = conflict.remote;
          break;
          
        case 'merge':
        default:
          winner = this.mergeConflict(conflict);
          break;
      }
      
      resolved.push({
        conflict,
        resolution: winner,
        strategy: this.config.conflictResolution
      });
    }
    
    // Log conflicts for review
    if (resolved.length > 0) {
      console.warn(`[KBSync] Resolved ${resolved.length} conflicts using "${this.config.conflictResolution}" strategy`);
      this.state.conflicts.push(...resolved);
    }
    
    return resolved;
  },

  mergeConflict(conflict) {
    // Smart merge: take the one with more evidence
    const localSample = conflict.local.data.sampleSize || 0;
    const remoteSample = conflict.remote.data.sampleSize || 0;
    
    if (localSample > remoteSample) {
      return { ...conflict.local, merged: true };
    } else if (remoteSample > localSample) {
      return { ...conflict.remote, merged: true };
    } else {
      // Same sample size - take more recent
      return conflict.local.timestamp > conflict.remote.timestamp 
        ? conflict.local 
        : conflict.remote;
    }
  },

  async mergeRemoteToLocal(remoteChanges, resolved) {
    // Apply remote changes to local KB
    for (const change of remoteChanges) {
      // Skip if we have a local resolution
      const localResolution = resolved.find(r => 
        r.conflict.remote.id === change.id
      );
      
      if (localResolution) continue;
      
      // Apply remote change
      await this.applyRemoteChange(change);
    }
  },

  async applyRemoteChange(change) {
    switch (change.type) {
      case 'patterns':
        // Merge into PatternMiner
        // (Would need to add pattern injection method)
        break;
        
      case 'rules':
        // Merge into PromptRefiner
        if (!PromptRefiner.learnedRules[change.agentType]) {
          PromptRefiner.learnedRules[change.agentType] = {
            bestPractices: [],
            antiPatterns: [],
            workflows: []
          };
        }
        const rules = PromptRefiner.learnedRules[change.agentType];
        // Merge best practices
        for (const bp of change.data.bestPractices || []) {
          if (!rules.bestPractices.some(r => r.content === bp.content)) {
            rules.bestPractices.push({ ...bp, source: 'remote' });
          }
        }
        break;
        
      case 'knowledge':
        // Add to KnowledgeExtractor
        KnowledgeExtractor.knowledge.push({
          ...change.data,
          source: 'remote'
        });
        break;
        
      case 'skills':
        // Add to KnowledgeBase
        await KnowledgeBase.put(KnowledgeBase.stores.skills, {
          ...change.data,
          source: 'remote'
        });
        break;
    }
  },

  // ==========================================================================
  // AUTO SYNC
  // ==========================================================================

  startAutoSync() {
    console.log('[KBSync] Auto-sync enabled, interval:', this.config.syncInterval);
    
    // Initial sync after 30 seconds
    setTimeout(() => this.sync(), 30000);
    
    // Periodic sync
    setInterval(() => this.sync(), this.config.syncInterval);
    
    // Sync on significant events
    EventBus.on('workflow:complete', () => {
      // Debounce - sync 10s after workflow completion
      setTimeout(() => this.sync(), 10000);
    });
  },

  // ==========================================================================
  // STATE PERSISTENCE
  // ==========================================================================

  async loadSyncState() {
    try {
      const saved = localStorage.getItem('agentOS_syncState');
      if (saved) {
        Object.assign(this.state, JSON.parse(saved));
      }
    } catch (e) {
      console.warn('[KBSync] Could not load sync state');
    }
  },

  saveSyncState() {
    localStorage.setItem('agentOS_syncState', JSON.stringify({
      lastSync: this.state.lastSync,
      pendingChanges: this.state.pendingChanges.slice(-100)
    }));
  },

  parseRemoteState(files) {
    const changes = [];
    
    for (const [path, content] of Object.entries(files)) {
      if (path.startsWith('patterns/')) {
        changes.push({
          type: 'patterns',
          agentType: content.agentType,
          data: content,
          timestamp: content.updatedAt
        });
      } else if (path.startsWith('rules/')) {
        changes.push({
          type: 'rules',
          agentType: content.agentType,
          data: content.structured,
          timestamp: content.updatedAt
        });
      } else if (path.startsWith('domain/')) {
        for (const entry of content.entries || []) {
          changes.push({
            type: 'knowledge',
            data: entry,
            timestamp: entry.timestamp
          });
        }
      } else if (path.startsWith('skills/')) {
        for (const skill of content.skills || []) {
          changes.push({
            type: 'skills',
            data: skill,
            timestamp: skill.createdAt
          });
        }
      }
    }
    
    return changes;
  }
};
```

### 2.2 File-Based Export/Import

For teams that can't use Git sync directly:

```javascript
// kb-export-import.js
// Manual export/import for air-gapped or restricted environments

const KBExporter = {
  
  // Export entire knowledge base to a file
  async exportAll() {
    const exportData = {
      version: '1.0',
      exportedAt: Date.now(),
      exportedBy: KBSyncManager.getAuthorId(),
      
      patterns: {},
      rules: {},
      knowledge: [],
      skills: [],
      decisions: [],
      feedback: []
    };
    
    // Patterns by agent type
    const agentTypes = ['swe', 'qa', 'team-lead', 'debugger', 'researcher'];
    for (const type of agentTypes) {
      exportData.patterns[type] = PatternMiner.mineSuccessPatterns(type);
    }
    
    // Learned rules
    exportData.rules = { ...PromptRefiner.learnedRules };
    
    // Domain knowledge
    exportData.knowledge = KnowledgeExtractor.knowledge;
    
    // Skills
    exportData.skills = await KnowledgeBase.getAll(KnowledgeBase.stores.skills);
    
    // Decision history (anonymized)
    exportData.decisions = DecisionLogger.decisions.map(d => ({
      agentType: d.agentType,
      decision: d.decision,
      outcome: d.outcome,
      timestamp: d.timestamp
    }));
    
    // Feedback (anonymized)
    exportData.feedback = FeedbackCollector.signals.map(s => ({
      type: s.type,
      agentType: s.agentType,
      success: s.success,
      timestamp: s.timestamp
    }));
    
    return exportData;
  },

  // Download as JSON file
  async downloadExport(filename = 'agentos-knowledge-export.json') {
    const data = await this.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    
    URL.revokeObjectURL(url);
    
    console.log(`[KBExporter] Downloaded: ${filename}`);
  },

  // Export specific categories
  async exportPatterns(agentType = null) {
    const patterns = {};
    const types = agentType ? [agentType] : ['swe', 'qa', 'team-lead', 'debugger', 'researcher'];
    
    for (const type of types) {
      patterns[type] = PatternMiner.mineSuccessPatterns(type);
    }
    
    return patterns;
  },

  async exportRules(agentType = null) {
    if (agentType) {
      return { [agentType]: PromptRefiner.learnedRules[agentType] };
    }
    return { ...PromptRefiner.learnedRules };
  },

  // Generate shareable markdown summary
  async exportMarkdownSummary() {
    let md = `# AgentOS Knowledge Base Export\n\n`;
    md += `**Exported:** ${new Date().toISOString()}\n`;
    md += `**Exported By:** ${KBSyncManager.getAuthorId()}\n\n`;
    md += `---\n\n`;
    
    const agentTypes = ['swe', 'qa', 'team-lead', 'debugger', 'researcher'];
    
    for (const type of agentTypes) {
      const patterns = PatternMiner.mineSuccessPatterns(type);
      const rules = PromptRefiner.learnedRules[type];
      
      if (patterns.length > 0 || rules) {
        md += `## ${type.toUpperCase()} Agent\n\n`;
        
        if (patterns.length > 0) {
          md += `### Top Patterns\n\n`;
          patterns.slice(0, 5).forEach(p => {
            md += `- **${p.choice}** - ${Math.round(p.successRate * 100)}% success (n=${p.sampleSize})\n`;
          });
          md += '\n';
        }
        
        if (rules) {
          md += PromptRefiner.generateRuleMarkdown(type);
          md += '\n';
        }
      }
    }
    
    // Domain knowledge summary
    const domains = [...new Set(KnowledgeExtractor.knowledge.map(k => k.domain))];
    if (domains.length > 0) {
      md += `## Domain Knowledge\n\n`;
      for (const domain of domains) {
        const items = KnowledgeExtractor.knowledge.filter(k => k.domain === domain);
        md += `### ${domain}\n`;
        md += `- ${items.length} entries\n`;
        const insights = items.flatMap(i => i.insights || []).slice(0, 3);
        insights.forEach(i => {
          md += `- ${i}\n`;
        });
        md += '\n';
      }
    }
    
    return md;
  }
};

const KBImporter = {
  
  // Import from JSON file
  async importFromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = async (e) => {
        try {
          const data = JSON.parse(e.target.result);
          const result = await this.importData(data);
          resolve(result);
        } catch (err) {
          reject(err);
        }
      };
      
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  },

  // Import from JSON data
  async importData(data) {
    const stats = {
      patterns: 0,
      rules: 0,
      knowledge: 0,
      skills: 0,
      conflicts: 0
    };
    
    // Validate version
    if (!data.version) {
      throw new Error('Invalid export file: missing version');
    }
    
    console.log(`[KBImporter] Importing from ${new Date(data.exportedAt).toISOString()}`);
    
    // Import patterns (merge into existing)
    for (const [agentType, patterns] of Object.entries(data.patterns || {})) {
      // Patterns are derived data, so we import the underlying decisions
      stats.patterns += patterns.length;
    }
    
    // Import rules
    for (const [agentType, rules] of Object.entries(data.rules || {})) {
      if (!rules) continue;
      
      if (!PromptRefiner.learnedRules[agentType]) {
        PromptRefiner.learnedRules[agentType] = {
          bestPractices: [],
          antiPatterns: [],
          workflows: [],
          lastUpdated: null
        };
      }
      
      const existing = PromptRefiner.learnedRules[agentType];
      
      // Merge best practices
      for (const bp of rules.bestPractices || []) {
        if (!existing.bestPractices.some(e => e.content === bp.content)) {
          existing.bestPractices.push({ ...bp, source: 'import' });
          stats.rules++;
        } else {
          stats.conflicts++;
        }
      }
      
      // Merge anti-patterns
      for (const ap of rules.antiPatterns || []) {
        if (!existing.antiPatterns.some(e => e.content === ap.content)) {
          existing.antiPatterns.push({ ...ap, source: 'import' });
          stats.rules++;
        }
      }
      
      // Merge workflows
      for (const wf of rules.workflows || []) {
        if (!existing.workflows.some(e => e.content === wf.content)) {
          existing.workflows.push({ ...wf, source: 'import' });
          stats.rules++;
        }
      }
      
      existing.lastUpdated = Date.now();
    }
    
    // Import knowledge
    for (const entry of data.knowledge || []) {
      const exists = KnowledgeExtractor.knowledge.some(k => 
        k.id === entry.id || 
        (k.task === entry.task && k.domain === entry.domain)
      );
      
      if (!exists) {
        KnowledgeExtractor.knowledge.push({ ...entry, source: 'import' });
        stats.knowledge++;
      } else {
        stats.conflicts++;
      }
    }
    
    // Import skills
    for (const skill of data.skills || []) {
      const existing = await KnowledgeBase.get(KnowledgeBase.stores.skills, skill.id);
      if (!existing) {
        await KnowledgeBase.put(KnowledgeBase.stores.skills, { ...skill, source: 'import' });
        stats.skills++;
      }
    }
    
    // Persist changes
    PromptRefiner.persist();
    KnowledgeExtractor.persist();
    
    console.log('[KBImporter] Import complete:', stats);
    return stats;
  },

  // Import from URL (e.g., raw GitHub file)
  async importFromUrl(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.status}`);
    }
    const data = await response.json();
    return this.importData(data);
  },

  // Import from clipboard
  async importFromClipboard() {
    const text = await navigator.clipboard.readText();
    const data = JSON.parse(text);
    return this.importData(data);
  }
};
```

### 2.3 Real-Time Collaboration (WebRTC P2P)

For teams that want real-time sync without a central server:

```javascript
// kb-p2p-sync.js
// Peer-to-peer knowledge sharing using WebRTC

const KBPeerSync = {
  peers: new Map(),
  localPeerId: null,
  signalingChannel: null,

  async init() {
    this.localPeerId = `peer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    
    // Use BroadcastChannel for same-origin peers (other tabs)
    this.localChannel = new BroadcastChannel('agentos-kb-sync');
    this.localChannel.onmessage = (e) => this.handleLocalPeerMessage(e.data);
    
    // Announce presence
    this.announcePresence();
    
    console.log('[KBPeerSync] Initialized as:', this.localPeerId);
  },

  announcePresence() {
    this.localChannel.postMessage({
      type: 'presence',
      peerId: this.localPeerId,
      timestamp: Date.now()
    });
  },

  handleLocalPeerMessage(message) {
    switch (message.type) {
      case 'presence':
        if (message.peerId !== this.localPeerId) {
          console.log('[KBPeerSync] Discovered peer:', message.peerId);
          this.peers.set(message.peerId, { lastSeen: Date.now() });
          this.requestSync(message.peerId);
        }
        break;
        
      case 'sync_request':
        if (message.targetPeerId === this.localPeerId) {
          this.sendSyncData(message.peerId);
        }
        break;
        
      case 'sync_data':
        if (message.targetPeerId === this.localPeerId) {
          this.receiveSyncData(message.data);
        }
        break;
        
      case 'knowledge_update':
        // Real-time knowledge sharing
        this.handleKnowledgeUpdate(message);
        break;
    }
  },

  requestSync(targetPeerId) {
    this.localChannel.postMessage({
      type: 'sync_request',
      peerId: this.localPeerId,
      targetPeerId,
      lastSync: KBSyncManager.state.lastSync
    });
  },

  async sendSyncData(targetPeerId) {
    const data = await KBExporter.exportAll();
    
    this.localChannel.postMessage({
      type: 'sync_data',
      peerId: this.localPeerId,
      targetPeerId,
      data
    });
  },

  async receiveSyncData(data) {
    console.log('[KBPeerSync] Receiving sync data...');
    const stats = await KBImporter.importData(data);
    console.log('[KBPeerSync] Imported:', stats);
  },

  // Broadcast new knowledge in real-time
  broadcastUpdate(type, data) {
    this.localChannel.postMessage({
      type: 'knowledge_update',
      peerId: this.localPeerId,
      updateType: type,
      data,
      timestamp: Date.now()
    });
  },

  handleKnowledgeUpdate(message) {
    if (message.peerId === this.localPeerId) return;
    
    console.log(`[KBPeerSync] Received ${message.updateType} from ${message.peerId}`);
    
    // Apply update based on type
    switch (message.updateType) {
      case 'pattern':
        // Add to local patterns
        break;
      case 'rule':
        // Merge rule
        break;
      case 'knowledge':
        KnowledgeExtractor.knowledge.push({
          ...message.data,
          source: `peer:${message.peerId}`
        });
        break;
    }
  },

  // Get connected peers
  getPeers() {
    const now = Date.now();
    const active = [];
    
    this.peers.forEach((info, peerId) => {
      if (now - info.lastSeen < 60000) { // Active in last minute
        active.push({ peerId, ...info });
      }
    });
    
    return active;
  }
};
```

---

## Part 3: Command Interface

```javascript
// Register sync commands
if (window.CommandParser) {
  
  // Manual sync trigger
  CommandParser.register('kb-sync', async () => {
    await KBSyncManager.sync();
  }, 'Sync knowledge base with team');

  // Export commands
  CommandParser.register('kb-export', async () => {
    await KBExporter.downloadExport();
  }, 'Export knowledge base to JSON file');

  CommandParser.register('kb-export-md', async () => {
    const md = await KBExporter.exportMarkdownSummary();
    console.log(md);
    
    // Also copy to clipboard
    await navigator.clipboard.writeText(md);
    console.log('📋 Copied to clipboard!');
  }, 'Export knowledge summary as Markdown');

  // Import commands  
  CommandParser.register('kb-import', async (args) => {
    if (args.startsWith('http')) {
      const stats = await KBImporter.importFromUrl(args);
      console.log('Import complete:', stats);
    } else {
      console.log('Usage: /kb-import <url> or use /kb-import-file');
    }
  }, 'Import knowledge from URL');

  CommandParser.register('kb-import-clipboard', async () => {
    try {
      const stats = await KBImporter.importFromClipboard();
      console.log('Import complete:', stats);
    } catch (e) {
      console.error('Import failed:', e.message);
    }
  }, 'Import knowledge from clipboard');

  // Git integration
  CommandParser.register('kb-commit', async () => {
    await KBSyncManager.pushToGit();
  }, 'Generate files and show git commands');

  // Peer sync
  CommandParser.register('kb-peers', () => {
    const peers = KBPeerSync.getPeers();
    if (peers.length === 0) {
      console.log('No active peers found');
    } else {
      console.table(peers);
    }
  }, 'Show connected peers');

  // Status
  CommandParser.register('kb-sync-status', () => {
    console.log('\n📊 SYNC STATUS:\n');
    console.log('Last sync:', KBSyncManager.state.lastSync 
      ? new Date(KBSyncManager.state.lastSync).toISOString() 
      : 'Never');
    console.log('Pending changes:', KBSyncManager.state.pendingChanges.length);
    console.log('Sync method:', KBSyncManager.config.syncMethod);
    console.log('Auto-sync:', KBSyncManager.config.autoSync ? 'Enabled' : 'Disabled');
  }, 'Show sync status');
}
```

---

## Part 4: Team Workflow

### 4.1 Daily Workflow

```
MORNING:
┌─────────────────────────────────────────────────────────────────────────────┐
│  1. Pull latest from Git                                                    │
│     $ git pull                                                              │
│                                                                             │
│  2. Import team knowledge                                                   │
│     /kb-sync                                                                │
│                                                                             │
│  3. Check what team learned yesterday                                       │
│     /learned-rules swe                                                      │
│     /patterns swe                                                           │
└─────────────────────────────────────────────────────────────────────────────┘

DURING WORK:
┌─────────────────────────────────────────────────────────────────────────────┐
│  • AgentOS automatically collects patterns as you work                      │
│  • New knowledge syncs to peers in real-time (if P2P enabled)              │
│  • Periodic auto-sync every 5 minutes                                       │
└─────────────────────────────────────────────────────────────────────────────┘

END OF DAY:
┌─────────────────────────────────────────────────────────────────────────────┐
│  1. Export today's learnings                                                │
│     /kb-commit                                                              │
│                                                                             │
│  2. Commit to Git                                                           │
│     $ git add .agentos/knowledge/                                           │
│     $ git commit -m "AgentOS: Knowledge sync"                               │
│     $ git push                                                              │
│                                                                             │
│  3. Or share manually                                                       │
│     /kb-export                                                              │
│     → Share JSON file with team                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Onboarding New Team Members

```
NEW TEAM MEMBER JOINS:
┌─────────────────────────────────────────────────────────────────────────────┐
│  1. Clone repo (includes .agentos/knowledge/)                               │
│     $ git clone <repo>                                                      │
│                                                                             │
│  2. Inject AgentOS bundles                                                  │
│     (follow standard setup)                                                 │
│                                                                             │
│  3. Import team knowledge                                                   │
│     /kb-sync                                                                │
│                                                                             │
│  4. Instant access to:                                                      │
│     • All team-discovered patterns                                          │
│     • Learned best practices                                                │
│     • Domain knowledge                                                      │
│     • Generated skills                                                      │
│                                                                             │
│  → New member starts with FULL team intelligence, not from scratch          │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.3 Knowledge Curation

```
PERIODIC REVIEW (weekly/monthly):
┌─────────────────────────────────────────────────────────────────────────────┐
│  1. Export markdown summary                                                 │
│     /kb-export-md                                                           │
│                                                                             │
│  2. Review as team:                                                         │
│     • Are patterns still valid?                                             │
│     • Any patterns to promote to official rules?                            │
│     • Any patterns to deprecate?                                            │
│                                                                             │
│  3. Curate:                                                                 │
│     • Move high-value patterns to .windsurf/rules/                          │
│     • Archive outdated patterns                                             │
│     • Document exceptions                                                   │
│                                                                             │
│  4. Commit curated knowledge                                                │
│     $ git commit -m "AgentOS: Weekly knowledge curation"                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Part 5: Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        TEAM KNOWLEDGE SHARING FLOW                               │
│                                                                                  │
│   DEV A's BROWSER                      SHARED REPO                               │
│   ┌─────────────────┐                  ┌─────────────────┐                      │
│   │ IndexedDB       │                  │ .agentos/       │                      │
│   │ ┌─────────────┐ │    PUSH          │ knowledge/      │                      │
│   │ │ Local KB    │─┼──────────────────▶│ ├─ patterns/   │                      │
│   │ └─────────────┘ │                  │ ├─ rules/       │                      │
│   │ ┌─────────────┐ │                  │ ├─ domain/      │                      │
│   │ │ Patterns    │─┼──────────────────▶│ └─ skills/     │                      │
│   │ └─────────────┘ │                  │                 │                      │
│   │ ┌─────────────┐ │    PULL          │                 │                      │
│   │ │ Rules       │◀┼──────────────────┼─────────────────│                      │
│   │ └─────────────┘ │                  │                 │                      │
│   └─────────────────┘                  └────────┬────────┘                      │
│                                                 │                                │
│   DEV B's BROWSER                               │   DEV C's BROWSER             │
│   ┌─────────────────┐                           │   ┌─────────────────┐         │
│   │ IndexedDB       │◀──────────────────────────┼───│ IndexedDB       │         │
│   │ (synced)        │                           │   │ (synced)        │         │
│   └─────────────────┘                           │   └─────────────────┘         │
│         │                                       │         │                      │
│         │              P2P (optional)           │         │                      │
│         └───────────────────────────────────────┴─────────┘                      │
│                     BroadcastChannel                                             │
│                     (same-origin tabs)                                           │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Summary

### Sharing Methods

| Method | Setup | Real-Time | Offline | Best For |
|--------|-------|-----------|---------|----------|
| **Git Sync** | Add .agentos/ to repo | No | Yes | Most teams |
| **File Export** | None | No | Yes | Air-gapped |
| **P2P Sync** | None | Yes | No | Collocated teams |
| **URL Import** | Host JSON file | No | No | Public sharing |

### Commands

| Command | Description |
|---------|-------------|
| `/kb-sync` | Sync with team (Git/remote) |
| `/kb-export` | Download JSON export |
| `/kb-export-md` | Export Markdown summary |
| `/kb-import <url>` | Import from URL |
| `/kb-import-clipboard` | Import from clipboard |
| `/kb-commit` | Generate Git commit files |
| `/kb-peers` | Show connected P2P peers |
| `/kb-sync-status` | Show sync status |

### What Gets Shared

| Data Type | Description | Benefit |
|-----------|-------------|---------|
| **Patterns** | Success/failure correlations | "X approach works 90% of time" |
| **Rules** | Auto-generated best practices | Agents get smarter |
| **Domain Knowledge** | Extracted insights | Contextual awareness |
| **Skills** | Generated capabilities | Reusable workflows |
| **Decision History** | Anonymized choices | More training data |

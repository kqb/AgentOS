/**
 * Knowledge Base Team Sharing System
 * Enables team-wide sharing of learned patterns, rules, and domain knowledge
 * 
 * Sync Methods:
 * - Git: Commit .agentos/knowledge/ to repo
 * - File: Export/import JSON files
 * - P2P: BroadcastChannel for same-origin tabs
 */

(function() {
  'use strict';

  // ==========================================================================
  // SIZE MANAGEMENT
  // ==========================================================================

  const KBSizeManager = {
    LIMITS: {
      maxPatternsPerType: 100,
      maxRulesPerType: 50,
      maxKnowledgePerDomain: 200,
      maxSkills: 100,
      warnAtKB: 5000,
      maxKB: 10000
    },

    // Calculate current size
    async calculateSize() {
      const sizes = {
        patterns: 0,
        rules: 0,
        knowledge: 0,
        skills: 0,
        total: 0
      };

      // Patterns
      const agentTypes = ['swe', 'qa', 'team-lead', 'debugger', 'researcher'];
      for (const type of agentTypes) {
        const patterns = PatternMiner?.mineSuccessPatterns(type) || [];
        sizes.patterns += JSON.stringify(patterns).length;
      }

      // Rules
      sizes.rules = JSON.stringify(PromptRefiner?.learnedRules || {}).length;

      // Knowledge
      sizes.knowledge = JSON.stringify(KnowledgeExtractor?.knowledge || []).length;

      // Skills
      if (KnowledgeBase?.db) {
        const skills = await KnowledgeBase.getAll(KnowledgeBase.stores.skills);
        sizes.skills = JSON.stringify(skills).length;
      }

      sizes.total = sizes.patterns + sizes.rules + sizes.knowledge + sizes.skills;

      return {
        bytes: sizes,
        kb: {
          patterns: Math.round(sizes.patterns / 1024),
          rules: Math.round(sizes.rules / 1024),
          knowledge: Math.round(sizes.knowledge / 1024),
          skills: Math.round(sizes.skills / 1024),
          total: Math.round(sizes.total / 1024)
        },
        status: sizes.total / 1024 > this.LIMITS.maxKB ? 'OVER_LIMIT' :
                sizes.total / 1024 > this.LIMITS.warnAtKB ? 'WARNING' : 'OK'
      };
    },

    // Prune old/low-value data
    async prune(aggressive = false) {
      const pruned = { patterns: 0, rules: 0, knowledge: 0 };
      const threshold = aggressive ? 0.5 : 0.3; // Keep top 50% or 70%

      // Prune knowledge (oldest first)
      const knowledge = KnowledgeExtractor?.knowledge || [];
      if (knowledge.length > this.LIMITS.maxKnowledgePerDomain * 5) {
        const keepCount = Math.floor(knowledge.length * (1 - threshold));
        const sorted = [...knowledge].sort((a, b) => b.timestamp - a.timestamp);
        KnowledgeExtractor.knowledge = sorted.slice(0, keepCount);
        pruned.knowledge = knowledge.length - keepCount;
        KnowledgeExtractor.persist();
      }

      // Prune rules (keep highest confidence)
      for (const [type, rules] of Object.entries(PromptRefiner?.learnedRules || {})) {
        if (rules.bestPractices?.length > this.LIMITS.maxRulesPerType) {
          const sorted = [...rules.bestPractices].sort((a, b) => 
            (b.confidence || 0) - (a.confidence || 0)
          );
          const removed = rules.bestPractices.length - this.LIMITS.maxRulesPerType;
          rules.bestPractices = sorted.slice(0, this.LIMITS.maxRulesPerType);
          pruned.rules += removed;
        }
      }
      PromptRefiner.persist();

      console.log('[KBSizeManager] Pruned:', pruned);
      return pruned;
    },

    // Archive old data to separate file (not synced)
    async archive() {
      const archive = {
        archivedAt: Date.now(),
        knowledge: [],
        decisions: []
      };

      // Archive knowledge older than 30 days
      const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
      const knowledge = KnowledgeExtractor?.knowledge || [];
      
      archive.knowledge = knowledge.filter(k => k.timestamp < cutoff);
      KnowledgeExtractor.knowledge = knowledge.filter(k => k.timestamp >= cutoff);
      KnowledgeExtractor.persist();

      // Archive decisions older than 30 days
      const decisions = DecisionLogger?.decisions || [];
      archive.decisions = decisions.filter(d => d.timestamp < cutoff);
      DecisionLogger.decisions = decisions.filter(d => d.timestamp >= cutoff);
      DecisionLogger.persist();

      // Store archive locally (not in Git)
      const archiveKey = `kb_archive_${Date.now()}`;
      localStorage.setItem(archiveKey, JSON.stringify(archive));

      console.log('[KBSizeManager] Archived:', {
        knowledge: archive.knowledge.length,
        decisions: archive.decisions.length,
        key: archiveKey
      });

      return archive;
    },

    // Show size report
    async report() {
      const size = await this.calculateSize();
      
      console.log(`
%c╔═══════════════════════════════════════════════════════════════════════════╗
║                    📊 KNOWLEDGE BASE SIZE REPORT                           ║
╠═══════════════════════════════════════════════════════════════════════════╣
║                                                                            ║
║  Component        Size (KB)    Limit (KB)    Status                       ║
║  ─────────────────────────────────────────────────────────────            ║
║  Patterns         ${String(size.kb.patterns).padStart(6)}       ~500         ${size.kb.patterns > 500 ? '⚠️' : '✅'}                         ║
║  Rules            ${String(size.kb.rules).padStart(6)}       ~250         ${size.kb.rules > 250 ? '⚠️' : '✅'}                         ║
║  Knowledge        ${String(size.kb.knowledge).padStart(6)}       ~2000        ${size.kb.knowledge > 2000 ? '⚠️' : '✅'}                         ║
║  Skills           ${String(size.kb.skills).padStart(6)}       ~100         ${size.kb.skills > 100 ? '⚠️' : '✅'}                         ║
║  ─────────────────────────────────────────────────────────────            ║
║  TOTAL            ${String(size.kb.total).padStart(6)}       ${this.LIMITS.maxKB}        ${size.status === 'OK' ? '✅ OK' : size.status === 'WARNING' ? '⚠️ WARN' : '🔴 OVER'}                        ║
║                                                                            ║
║  Git-safe: ${size.kb.total < 10000 ? 'YES ✅' : 'NO ❌ - Run /kb-prune'}                                         ║
║                                                                            ║
╚═══════════════════════════════════════════════════════════════════════════╝`,
        'color: #ff9800; font-family: monospace;'
      );

      return size;
    }
  };

  // ==========================================================================
  // SYNC MANAGER
  // ==========================================================================

  const KBSyncManager = {
    config: {
      syncMethod: 'git',
      syncPath: '.agentos/knowledge',
      syncInterval: 300000,
      conflictResolution: 'merge',
      autoSync: true
    },

    state: {
      lastSync: null,
      pendingChanges: [],
      syncInProgress: false
    },

    async init(config = {}) {
      Object.assign(this.config, config);
      await this.loadSyncState();
      this.registerChangeListeners();
      
      if (this.config.autoSync) {
        this.startAutoSync();
      }
      
      console.log('[KBSync] Initialized:', this.config.syncMethod);
    },

    registerChangeListeners() {
      EventBus.on('knowledge:added', (e) => this.queueChange('add', 'knowledge', e));
      EventBus.on('pattern:discovered', (e) => this.queueChange('add', 'patterns', e));
      EventBus.on('rule:generated', (e) => this.queueChange('add', 'rules', e));
    },

    queueChange(action, type, data) {
      this.state.pendingChanges.push({
        id: `change-${Date.now()}`,
        action,
        type,
        data,
        timestamp: Date.now(),
        author: this.getAuthorId()
      });
      this.saveSyncState();
    },

    getAuthorId() {
      let id = localStorage.getItem('agentOS_authorId');
      if (!id) {
        id = `user-${Math.random().toString(36).slice(2, 8)}`;
        localStorage.setItem('agentOS_authorId', id);
      }
      return id;
    },

    async sync() {
      if (this.state.syncInProgress) return;
      
      this.state.syncInProgress = true;
      console.log('[KBSync] Starting sync...');
      
      try {
        const remoteData = await this.pullRemote();
        await this.mergeRemote(remoteData);
        await this.pushLocal();
        
        this.state.lastSync = Date.now();
        this.state.pendingChanges = [];
        this.saveSyncState();
        
        console.log('[KBSync] Sync complete');
        EventBus.emit('kb:sync_complete', { timestamp: this.state.lastSync });
      } catch (e) {
        console.error('[KBSync] Sync failed:', e);
        EventBus.emit('kb:sync_failed', { error: e });
      } finally {
        this.state.syncInProgress = false;
      }
    },

    async pullRemote() {
      // Read from localStorage simulation of git files
      const files = {};
      const keys = Object.keys(localStorage).filter(k => k.startsWith('kb_shared_'));
      
      for (const key of keys) {
        try {
          files[key.replace('kb_shared_', '')] = JSON.parse(localStorage.getItem(key));
        } catch (e) {}
      }
      
      return files;
    },

    async mergeRemote(remoteData) {
      for (const [path, content] of Object.entries(remoteData)) {
        if (path.startsWith('patterns/')) {
          await this.mergePatterns(content);
        } else if (path.startsWith('rules/')) {
          await this.mergeRules(content);
        } else if (path.startsWith('knowledge/')) {
          await this.mergeKnowledge(content);
        }
      }
    },

    async mergePatterns(content) {
      // Patterns are derived, mainly for display
      console.log('[KBSync] Merged patterns for:', content.agentType);
    },

    async mergeRules(content) {
      const agentType = content.agentType;
      if (!agentType) return;
      
      if (!PromptRefiner.learnedRules[agentType]) {
        PromptRefiner.learnedRules[agentType] = {
          bestPractices: [],
          antiPatterns: [],
          workflows: [],
          lastUpdated: null
        };
      }
      
      const local = PromptRefiner.learnedRules[agentType];
      const remote = content.structured || content;
      
      // Merge best practices
      for (const bp of remote.bestPractices || []) {
        if (!local.bestPractices.some(l => l.content === bp.content)) {
          local.bestPractices.push({ ...bp, source: 'remote' });
        }
      }
      
      // Merge anti-patterns
      for (const ap of remote.antiPatterns || []) {
        if (!local.antiPatterns.some(l => l.content === ap.content)) {
          local.antiPatterns.push({ ...ap, source: 'remote' });
        }
      }
      
      // Merge workflows
      for (const wf of remote.workflows || []) {
        if (!local.workflows.some(l => l.content === wf.content)) {
          local.workflows.push({ ...wf, source: 'remote' });
        }
      }
      
      local.lastUpdated = Date.now();
      PromptRefiner.persist();
    },

    async mergeKnowledge(content) {
      for (const entry of content.entries || []) {
        const exists = KnowledgeExtractor.knowledge.some(k =>
          k.id === entry.id || (k.task === entry.task && k.domain === entry.domain)
        );
        
        if (!exists) {
          KnowledgeExtractor.knowledge.push({ ...entry, source: 'remote' });
        }
      }
      KnowledgeExtractor.persist();
    },

    async pushLocal() {
      const files = await this.generateSyncFiles();
      
      // Store in localStorage (simulating git)
      for (const [path, content] of Object.entries(files)) {
        localStorage.setItem(`kb_shared_${path}`, JSON.stringify(content));
      }
      
      this.showGitCommands(files);
    },

    // Size limits to keep Git happy
    SIZE_LIMITS: {
      maxPatternsPerType: 100,      // ~10KB per file
      maxRulesPerType: 50,          // ~5KB per file  
      maxKnowledgePerDomain: 200,   // ~20KB per file
      maxSkills: 100,               // ~10KB
      warnAtTotalKB: 5000,          // 5MB warning
      maxTotalKB: 10000             // 10MB hard limit
    },

    async generateSyncFiles() {
      const files = {};
      const agentTypes = ['swe', 'qa', 'team-lead', 'debugger', 'researcher'];
      
      // Patterns (limited to top by confidence × sample size)
      for (const type of agentTypes) {
        const patterns = PatternMiner?.mineSuccessPatterns(type) || [];
        if (patterns.length > 0) {
          const topPatterns = patterns
            .sort((a, b) => (b.successRate * b.sampleSize) - (a.successRate * a.sampleSize))
            .slice(0, this.SIZE_LIMITS.maxPatternsPerType);
          
          files[`patterns/${type}.json`] = {
            agentType: type,
            updatedAt: Date.now(),
            updatedBy: this.getAuthorId(),
            patterns: topPatterns,
            _pruned: patterns.length - topPatterns.length
          };
        }
      }
      
      // Rules
      for (const type of agentTypes) {
        const rules = PromptRefiner?.learnedRules[type];
        if (rules && (rules.bestPractices.length > 0 || rules.antiPatterns.length > 0)) {
          files[`rules/${type}.json`] = {
            agentType: type,
            updatedAt: Date.now(),
            updatedBy: this.getAuthorId(),
            structured: rules
          };
        }
      }
      
      // Domain knowledge
      const allKnowledge = KnowledgeExtractor?.knowledge || [];
      const byDomain = {};
      for (const k of allKnowledge) {
        const domain = k.domain || 'general';
        if (!byDomain[domain]) byDomain[domain] = [];
        byDomain[domain].push(k);
      }
      for (const [domain, entries] of Object.entries(byDomain)) {
        files[`knowledge/${domain}.json`] = {
          domain,
          updatedAt: Date.now(),
          entries: entries.slice(-100)
        };
      }
      
      // Manifest
      files['manifest.json'] = {
        lastSync: Date.now(),
        syncedBy: this.getAuthorId(),
        version: '1.0'
      };
      
      return files;
    },

    showGitCommands(files) {
      const fileList = Object.keys(files).join('\n    ');
      console.log(`
%c╔═════════════════════════════════════════════════════════════════════════════╗
║  📤 SHARE KNOWLEDGE - Copy these files to .agentos/knowledge/ and commit:    ║
╠═════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  Files generated:                                                            ║
║    ${fileList.split('\n').join('\n║    ')}
║                                                                              ║
║  Git commands:                                                               ║
║    git add .agentos/knowledge/                                               ║
║    git commit -m "AgentOS: Sync knowledge base"                              ║
║    git push                                                                  ║
║                                                                              ║
╚═════════════════════════════════════════════════════════════════════════════╝`,
        'color: #4caf50; font-family: monospace;'
      );
    },

    startAutoSync() {
      setTimeout(() => this.sync(), 60000);
      setInterval(() => this.sync(), this.config.syncInterval);
    },

    loadSyncState() {
      try {
        const saved = localStorage.getItem('agentOS_syncState');
        if (saved) Object.assign(this.state, JSON.parse(saved));
      } catch (e) {}
    },

    saveSyncState() {
      localStorage.setItem('agentOS_syncState', JSON.stringify({
        lastSync: this.state.lastSync,
        pendingChanges: this.state.pendingChanges.slice(-50)
      }));
    }
  };

  // ==========================================================================
  // EXPORTER
  // ==========================================================================

  const KBExporter = {
    async exportAll() {
      const data = {
        version: '1.0',
        exportedAt: Date.now(),
        exportedBy: KBSyncManager.getAuthorId(),
        patterns: {},
        rules: {},
        knowledge: [],
        skills: []
      };
      
      const agentTypes = ['swe', 'qa', 'team-lead', 'debugger', 'researcher'];
      
      for (const type of agentTypes) {
        data.patterns[type] = PatternMiner?.mineSuccessPatterns(type) || [];
      }
      
      data.rules = { ...(PromptRefiner?.learnedRules || {}) };
      data.knowledge = KnowledgeExtractor?.knowledge || [];
      
      if (KnowledgeBase?.db) {
        data.skills = await KnowledgeBase.getAll(KnowledgeBase.stores.skills);
      }
      
      return data;
    },

    async download(filename = 'agentos-knowledge.json') {
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

    async exportMarkdown() {
      let md = `# AgentOS Knowledge Export\n\n`;
      md += `**Exported:** ${new Date().toISOString()}\n\n---\n\n`;
      
      const agentTypes = ['swe', 'qa', 'team-lead', 'debugger', 'researcher'];
      
      for (const type of agentTypes) {
        const patterns = PatternMiner?.mineSuccessPatterns(type) || [];
        const rules = PromptRefiner?.learnedRules[type];
        
        if (patterns.length > 0 || rules) {
          md += `## ${type.toUpperCase()}\n\n`;
          
          if (patterns.length > 0) {
            md += `### Patterns\n`;
            patterns.slice(0, 5).forEach(p => {
              md += `- **${p.choice}** - ${Math.round(p.successRate * 100)}% (n=${p.sampleSize})\n`;
            });
            md += '\n';
          }
          
          if (rules) {
            if (rules.bestPractices.length > 0) {
              md += `### Best Practices\n`;
              rules.bestPractices.slice(0, 5).forEach(r => {
                md += `- ${r.content}\n`;
              });
              md += '\n';
            }
            
            if (rules.antiPatterns.length > 0) {
              md += `### Anti-Patterns\n`;
              rules.antiPatterns.slice(0, 5).forEach(r => {
                md += `- ${r.content}\n`;
              });
              md += '\n';
            }
          }
        }
      }
      
      return md;
    }
  };

  // ==========================================================================
  // IMPORTER
  // ==========================================================================

  const KBImporter = {
    async importFromFile(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
          try {
            const data = JSON.parse(e.target.result);
            resolve(await this.importData(data));
          } catch (err) {
            reject(err);
          }
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
      });
    },

    async importData(data) {
      const stats = { patterns: 0, rules: 0, knowledge: 0, skills: 0 };
      
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
        
        const local = PromptRefiner.learnedRules[agentType];
        
        for (const bp of rules.bestPractices || []) {
          if (!local.bestPractices.some(l => l.content === bp.content)) {
            local.bestPractices.push({ ...bp, source: 'import' });
            stats.rules++;
          }
        }
        
        for (const ap of rules.antiPatterns || []) {
          if (!local.antiPatterns.some(l => l.content === ap.content)) {
            local.antiPatterns.push({ ...ap, source: 'import' });
            stats.rules++;
          }
        }
        
        local.lastUpdated = Date.now();
      }
      
      // Import knowledge
      for (const entry of data.knowledge || []) {
        const exists = KnowledgeExtractor.knowledge.some(k =>
          k.id === entry.id || (k.task === entry.task && k.domain === entry.domain)
        );
        
        if (!exists) {
          KnowledgeExtractor.knowledge.push({ ...entry, source: 'import' });
          stats.knowledge++;
        }
      }
      
      // Import skills
      for (const skill of data.skills || []) {
        if (KnowledgeBase?.db) {
          await KnowledgeBase.put(KnowledgeBase.stores.skills, { ...skill, source: 'import' });
          stats.skills++;
        }
      }
      
      PromptRefiner.persist();
      KnowledgeExtractor.persist();
      
      console.log('[KBImporter] Import complete:', stats);
      return stats;
    },

    async importFromUrl(url) {
      const response = await fetch(url);
      const data = await response.json();
      return this.importData(data);
    },

    async importFromClipboard() {
      const text = await navigator.clipboard.readText();
      return this.importData(JSON.parse(text));
    }
  };

  // ==========================================================================
  // P2P SYNC (Same-origin tabs)
  // ==========================================================================

  const KBPeerSync = {
    peerId: null,
    peers: new Map(),
    channel: null,

    init() {
      this.peerId = `peer-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      
      try {
        this.channel = new BroadcastChannel('agentos-kb-sync');
        this.channel.onmessage = (e) => this.handleMessage(e.data);
        this.announce();
        console.log('[KBPeerSync] Initialized:', this.peerId);
      } catch (e) {
        console.warn('[KBPeerSync] BroadcastChannel not supported');
      }
    },

    announce() {
      if (!this.channel) return;
      this.channel.postMessage({ type: 'announce', peerId: this.peerId });
    },

    handleMessage(msg) {
      if (msg.peerId === this.peerId) return;
      
      switch (msg.type) {
        case 'announce':
          this.peers.set(msg.peerId, { lastSeen: Date.now() });
          console.log('[KBPeerSync] Peer found:', msg.peerId);
          break;
          
        case 'knowledge_update':
          this.handleUpdate(msg);
          break;
      }
    },

    handleUpdate(msg) {
      if (msg.updateType === 'knowledge') {
        KnowledgeExtractor.knowledge.push({ ...msg.data, source: `peer:${msg.peerId}` });
      }
    },

    broadcast(type, data) {
      if (!this.channel) return;
      this.channel.postMessage({
        type: 'knowledge_update',
        peerId: this.peerId,
        updateType: type,
        data,
        timestamp: Date.now()
      });
    },

    getPeers() {
      const active = [];
      const now = Date.now();
      this.peers.forEach((info, id) => {
        if (now - info.lastSeen < 60000) active.push({ id, ...info });
      });
      return active;
    }
  };

  // ==========================================================================
  // COMMANDS
  // ==========================================================================

  if (window.CommandParser) {
    CommandParser.register('kb-sync', async () => {
      await KBSyncManager.sync();
    }, 'Sync knowledge with team');

    CommandParser.register('kb-export', async () => {
      await KBExporter.download();
    }, 'Export knowledge to JSON');

    CommandParser.register('kb-export-md', async () => {
      const md = await KBExporter.exportMarkdown();
      console.log(md);
      await navigator.clipboard.writeText(md);
      console.log('📋 Copied to clipboard!');
    }, 'Export knowledge as Markdown');

    CommandParser.register('kb-import', async (args) => {
      if (args.startsWith('http')) {
        await KBImporter.importFromUrl(args.trim());
      } else {
        console.log('Usage: /kb-import <url>');
        console.log('Or drag a JSON file to the console');
      }
    }, 'Import knowledge from URL');

    CommandParser.register('kb-import-clipboard', async () => {
      try {
        await KBImporter.importFromClipboard();
      } catch (e) {
        console.error('Failed:', e.message);
      }
    }, 'Import from clipboard');

    CommandParser.register('kb-peers', () => {
      const peers = KBPeerSync.getPeers();
      if (peers.length === 0) {
        console.log('No active peers');
      } else {
        console.table(peers);
      }
    }, 'Show connected peers');

    CommandParser.register('kb-sync-status', () => {
      console.log('\n📊 SYNC STATUS:');
      console.log('Last sync:', KBSyncManager.state.lastSync 
        ? new Date(KBSyncManager.state.lastSync).toLocaleString() 
        : 'Never');
      console.log('Pending:', KBSyncManager.state.pendingChanges.length);
      console.log('Method:', KBSyncManager.config.syncMethod);
      console.log('Peers:', KBPeerSync.getPeers().length);
    }, 'Show sync status');

    CommandParser.register('kb-set-author', (args) => {
      const name = args.trim();
      if (name) {
        localStorage.setItem('agentOS_authorId', name);
        console.log('Author set to:', name);
      } else {
        console.log('Current author:', KBSyncManager.getAuthorId());
        console.log('Usage: /kb-set-author <name>');
      }
    }, 'Set your author name for sync');
  }

  // ==========================================================================
  // FILE DROP HANDLER
  // ==========================================================================

  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    
    for (const file of e.dataTransfer.files) {
      if (file.name.endsWith('.json')) {
        console.log('[KBSync] Importing dropped file:', file.name);
        try {
          await KBImporter.importFromFile(file);
        } catch (err) {
          console.error('Import failed:', err);
        }
      }
    }
  });

  // ==========================================================================
  // INIT
  // ==========================================================================

  window.KBSyncManager = KBSyncManager;
  window.KBExporter = KBExporter;
  window.KBImporter = KBImporter;
  window.KBPeerSync = KBPeerSync;

  KBSyncManager.init();
  KBSyncManager.init();
  KBPeerSync.init();

  // Register size management commands
  if (window.CommandParser) {
    CommandParser.register('kb-size', async () => {
      await KBSizeManager.report();
    }, 'Show knowledge base size report');

    CommandParser.register('kb-prune', async (args) => {
      const aggressive = args.includes('--aggressive') || args.includes('-a');
      console.log(`Pruning KB (${aggressive ? 'aggressive' : 'normal'})...`);
      const result = await KBSizeManager.prune(aggressive);
      console.log('Pruned:', result);
      await KBSizeManager.report();
    }, 'Prune old/low-value data [--aggressive]');

    CommandParser.register('kb-archive', async () => {
      console.log('Archiving old data...');
      await KBSizeManager.archive();
      await KBSizeManager.report();
    }, 'Archive data older than 30 days');
  }

  // Export size manager
  window.KBSizeManager = KBSizeManager;

  console.log(`
%c╔═════════════════════════════════════════════════════════════════════════════╗
║              📡 Team Knowledge Sharing System Loaded                         ║
╠═════════════════════════════════════════════════════════════════════════════╣
║  /kb-sync            - Sync with team repository                            ║
║  /kb-export          - Download knowledge as JSON                           ║
║  /kb-export-md       - Export as Markdown (copies to clipboard)             ║
║  /kb-import <url>    - Import from URL                                      ║
║  /kb-peers           - Show connected peers                                 ║
║  /kb-sync-status     - Show sync status                                     ║
╠═════════════════════════════════════════════════════════════════════════════╣
║  /kb-size            - Show size report (Git limits)                        ║
║  /kb-prune [-a]      - Prune old/low-value data                             ║
║  /kb-archive         - Archive data older than 30 days                      ║
╠═════════════════════════════════════════════════════════════════════════════╣
║  💡 Drag & drop JSON files to import                                        ║
║  💡 Max recommended size: 10MB for Git                                      ║
╚═════════════════════════════════════════════════════════════════════════════╝`,
    'color: #2196f3; font-family: monospace;'
  );

})();

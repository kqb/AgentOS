/**
 * AgentOS Loader (Legacy)
 *
 * NOTE: CDP injection is now the recommended method.
 * See: npm run inject --help
 *
 * For Electron-based apps like Windsurf, use CDP injection instead:
 *
 *   1. Start Windsurf with: --remote-debugging-port=9222
 *   2. Run: npm run inject:persistent
 *
 * Legacy Usage (if CDP unavailable):
 *   1. Open DevTools Console (Cmd+Option+I)
 *   2. Paste this entire file
 *   3. Press Enter
 *   4. AgentOS + Workflow Engine will be initialized
 */

(async function loadAgentOS() {
  'use strict';

  const VERSION = '1.0.0';

  console.log(`%c[AgentOS Loader] Starting v${VERSION}...`, 'color: #4fc3f7');

  // Check if already loaded
  if (window.AgentOS && window.WorkflowEngine) {
    console.warn('[AgentOS Loader] Already initialized. Skipping.');
    return;
  }

  // Loader can work in two modes:
  // 1. Inline - scripts embedded below
  // 2. Fetch - load from local files (requires file:// or localhost server)

  const INLINE_MODE = true; // Set to false to load from files

  if (INLINE_MODE) {
    console.log('[AgentOS Loader] Using inline mode...');

    // ==== INLINE SCRIPTS START ====
    // The build process should concatenate the actual scripts here
    // For now, show instructions

    if (!window.AgentOS) {
      console.error(`
[AgentOS Loader] Inline scripts not embedded.

To use AgentOS, paste the scripts in this order:
1. agentOS-bundle.js
2. workflow-engine-bundle.js

Or set INLINE_MODE = false and serve files locally.
      `);
      return;
    }
    // ==== INLINE SCRIPTS END ====

  } else {
    // Fetch mode - requires local server
    const BASE_URL = 'http://localhost:8080/.windsurf/injector/';

    try {
      console.log('[AgentOS Loader] Fetching agentOS-bundle.js...');
      const agentOSScript = await fetch(BASE_URL + 'agentOS-bundle.js').then(r => r.text());
      eval(agentOSScript);

      console.log('[AgentOS Loader] Fetching workflow-engine-bundle.js...');
      const workflowScript = await fetch(BASE_URL + 'workflow-engine-bundle.js').then(r => r.text());
      eval(workflowScript);

    } catch (e) {
      console.error('[AgentOS Loader] Failed to fetch scripts:', e.message);
      console.log(`
To use fetch mode, start a local server:
  cd /path/to/AgentOS
  python3 -m http.server 8080
      `);
      return;
    }
  }

  // Verify loading
  if (window.AgentOS && window.WorkflowEngine) {
    console.log('%c[AgentOS Loader] Success! All systems ready.', 'color: #81c784; font-weight: bold');

    console.log(`
Quick Start:
  AgentOS.spawnAgent()                    - Spawn new agent
  AgentOS.list()                          - List all agents
  CommandParser.parse('/help')            - Show workflow commands

Keyboard Shortcuts:
  Cmd+Shift+I  - Spawn agent
  Cmd+Shift+K  - Toggle panel
  Cmd+Shift+L  - List agents
    `);
  } else {
    console.error('[AgentOS Loader] Loading incomplete. Check console for errors.');
  }

})();

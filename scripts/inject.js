#!/usr/bin/env node

/**
 * AgentOS CDP Injector CLI
 *
 * Injects AgentOS into a running browser via Chrome DevTools Protocol.
 *
 * Usage:
 *   node scripts/inject.js [options]
 *
 * Options:
 *   --port <number>    CDP port (default: 9222)
 *   --host <string>    CDP host (default: localhost)
 *   --persistent       Inject persistently (survives page reloads)
 *   --target <id>      Target specific page by ID
 *   --list             List available targets
 *   --bundle <path>    Path to bundle file (default: dist/agentOS-combined.js)
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// Parse arguments
const args = process.argv.slice(2);
const options = {
  port: 9222,
  host: 'localhost',
  persistent: false,
  target: null,
  list: false,
  bundle: path.join(ROOT, 'dist', 'agentOS-combined.js')
};

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--port':
      options.port = parseInt(args[++i], 10);
      break;
    case '--host':
      options.host = args[++i];
      break;
    case '--persistent':
      options.persistent = true;
      break;
    case '--target':
      options.target = args[++i];
      break;
    case '--list':
      options.list = true;
      break;
    case '--bundle':
      options.bundle = args[++i];
      break;
    case '--help':
      console.log(`
AgentOS CDP Injector

Usage: node scripts/inject.js [options]

Options:
  --port <number>    CDP port (default: 9222)
  --host <string>    CDP host (default: localhost)
  --persistent       Inject persistently (survives page reloads)
  --target <id>      Target specific page by ID
  --list             List available targets
  --bundle <path>    Path to bundle file

Prerequisites:
  Start Windsurf with debugging enabled:
    - macOS: /Applications/Windsurf.app/Contents/MacOS/Electron --remote-debugging-port=9222
    - Linux: windsurf --remote-debugging-port=9222
    - Windows: windsurf.exe --remote-debugging-port=9222

Example:
  node scripts/inject.js --port 9222 --persistent
      `);
      process.exit(0);
  }
}

/**
 * Get available CDP targets
 */
async function getTargets() {
  const url = `http://${options.host}:${options.port}/json`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error(`\n❌ Failed to connect to CDP at ${options.host}:${options.port}`);
    console.error('\nMake sure to start Windsurf with debugging enabled:');
    console.error(`  /Applications/Windsurf.app/Contents/MacOS/Electron --remote-debugging-port=${options.port}`);
    console.error('\nOr for VS Code:');
    console.error(`  code --remote-debugging-port=${options.port}`);
    process.exit(1);
  }
}

/**
 * List available targets
 */
async function listTargets() {
  const targets = await getTargets();

  console.log('\n📋 Available CDP Targets:\n');

  targets.forEach((target, i) => {
    console.log(`${i + 1}. [${target.type}] ${target.title || 'Untitled'}`);
    console.log(`   ID: ${target.targetId}`);
    console.log(`   URL: ${target.url}`);
    console.log('');
  });

  console.log(`Total: ${targets.length} targets`);
}

/**
 * Connect to target via WebSocket
 */
function connectWebSocket(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);

    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

/**
 * Send CDP command
 */
function sendCommand(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Date.now();

    const handler = (data) => {
      const message = JSON.parse(data.toString());
      if (message.id === id) {
        ws.off('message', handler);
        if (message.error) {
          reject(new Error(message.error.message));
        } else {
          resolve(message.result);
        }
      }
    };

    ws.on('message', handler);
    ws.send(JSON.stringify({ id, method, params }));

    // Timeout
    setTimeout(() => {
      ws.off('message', handler);
      reject(new Error('Command timeout'));
    }, 30000);
  });
}

/**
 * Inject the bundle
 */
async function inject() {
  // Load bundle
  if (!fs.existsSync(options.bundle)) {
    console.error(`\n❌ Bundle not found: ${options.bundle}`);
    console.error('\nRun "npm run bundle" first to build the bundle.');
    process.exit(1);
  }

  const bundle = fs.readFileSync(options.bundle, 'utf-8');
  console.log(`📦 Loaded bundle: ${options.bundle} (${(bundle.length / 1024).toFixed(2)} KB)`);

  // Get targets
  const targets = await getTargets();

  // Find target
  let target;
  if (options.target) {
    target = targets.find(t => t.targetId === options.target);
    if (!target) {
      console.error(`\n❌ Target not found: ${options.target}`);
      process.exit(1);
    }
  } else {
    // Find first page target (prefer webview for Windsurf)
    target = targets.find(t => t.type === 'webview')
          || targets.find(t => t.type === 'page')
          || targets[0];
  }

  if (!target || !target.webSocketDebuggerUrl) {
    console.error('\n❌ No suitable target found');
    process.exit(1);
  }

  console.log(`\n🎯 Target: ${target.title || target.url}`);
  console.log(`   Type: ${target.type}`);

  // Connect
  console.log('\n🔌 Connecting via WebSocket...');
  const ws = await connectWebSocket(target.webSocketDebuggerUrl);
  console.log('   Connected!');

  try {
    // Enable domains
    await sendCommand(ws, 'Runtime.enable');
    await sendCommand(ws, 'Page.enable');

    if (options.persistent) {
      // Add script to run on new documents
      console.log('\n💉 Injecting persistently...');
      const result = await sendCommand(ws, 'Page.addScriptToEvaluateOnNewDocument', {
        source: bundle
      });
      console.log(`   Script ID: ${result.identifier}`);
    }

    // Inject immediately
    console.log('\n💉 Injecting into current page...');
    await sendCommand(ws, 'Runtime.evaluate', {
      expression: bundle,
      awaitPromise: true
    });

    // Verify injection
    const check = await sendCommand(ws, 'Runtime.evaluate', {
      expression: 'typeof window.AgentOS !== "undefined" ? window.AgentOS.VERSION : null',
      returnByValue: true
    });

    if (check.result?.value) {
      console.log(`\n✅ AgentOS v${check.result.value} injected successfully!`);
    } else {
      console.log('\n✅ Bundle injected (version check unavailable)');
    }

    if (options.persistent) {
      console.log('   Persistent mode: Will auto-inject on page reloads');
    }

    console.log('\n📌 Available globals in page:');
    console.log('   - AgentOS');
    console.log('   - EventBus');
    console.log('   - StateManager');
    console.log('   - IntegrationRegistry');
    console.log('   - SsoDetector');
    console.log('   - WorkflowTracker');

  } finally {
    ws.close();
  }
}

// Main
async function main() {
  console.log('\n🤖 AgentOS CDP Injector\n');

  if (options.list) {
    await listTargets();
  } else {
    await inject();
  }
}

main().catch(error => {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
});

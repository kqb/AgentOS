# AgentOS

Multi-agent orchestration layer for Windsurf IDE over Chrome DevTools Protocol.

AgentOS extends Windsurf's agent loop with programmatic multi-agent coordination. Spawn, route, and supervise multiple agents in a single IDE session via CDP.

## Features

- Multi-agent spawning: launch and manage N agents concurrently
- CDP-based control: programmatic access to the Cascade panel
- Skill routing: dispatch tasks to specialist agents by role
- Memory bank: shared state across agent turns
- Session recovery: restore agent state after reloads

## Requirements

- Windsurf IDE with remote debugging (--remote-debugging-port=9333)
- Node.js 18+
- TypeScript

## Quick start

    git clone https://github.com/kqb/AgentOS.git
    cd AgentOS
    npm install
    npm run build
    npm start

## Structure

- agents/: agent definitions and role specs
- skills/: pluggable skill modules
- memory-bank/: persistent context store
- docs/: architecture and API reference

## Related

- cascade-multiagent: lower-level CDP primitives for Windsurf Cascade (https://github.com/kqb/cascade-multiagent)

## License

MIT

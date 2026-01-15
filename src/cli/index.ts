/**
 * CLI Module - Command-line interface for AgentOS
 *
 * Components:
 * - CommandParser: Parse and route /commands
 * - Handlers: Built-in command implementations
 * - Middleware: Validation, logging, caching
 */

// Parser
export {
  CommandParser,
  CommandParserClass,
  type ParsedCommand,
  type CommandResult,
  type CommandHandler,
  type CommandContext,
  type CommandRegistration,
  type Middleware
} from './parser.js';

// Handlers
export {
  handleHelp,
  handleAgentList,
  handleSpawn,
  handleWorkflowStatus,
  handleKbStats,
  handleSearch,
  handleScrape,
  handleResearch,
  handlePollStatus,
  handleImplementWorkItem
} from './handlers.js';

// Middleware
export {
  loggingMiddleware,
  validationMiddleware,
  errorHandlingMiddleware,
  timingMiddleware,
  createRateLimitMiddleware,
  createAuthMiddleware,
  createCacheMiddleware,
  createAuditMiddleware
} from './middleware.js';

/**
 * Initialize CLI with default commands and middleware
 */
export async function initCLI(): Promise<void> {
  const { CommandParser } = await import('./parser.js');
  const {
    handleHelp,
    handleAgentList,
    handleSpawn,
    handleWorkflowStatus,
    handleKbStats,
    handleSearch,
    handleScrape,
    handleResearch,
    handlePollStatus,
    handleImplementWorkItem
  } = await import('./handlers.js');
  const {
    loggingMiddleware,
    validationMiddleware,
    errorHandlingMiddleware
  } = await import('./middleware.js');

  // Add middleware
  CommandParser.use(errorHandlingMiddleware);
  CommandParser.use(validationMiddleware);
  CommandParser.use(loggingMiddleware);

  // Register built-in commands
  CommandParser.register('help', handleHelp, 'Show available commands', {
    usage: '/help [command]',
    examples: ['/help', '/help search'],
    aliases: ['h', '?']
  });

  CommandParser.register('agent-list', handleAgentList, 'List all agent pools', {
    usage: '/agent-list [--json]',
    examples: ['/agent-list', '/agent-list --json'],
    aliases: ['agents', 'al']
  });

  CommandParser.register('spawn', handleSpawn, 'Spawn agent(s) in a pool', {
    usage: '/spawn <pool-type> [--count N]',
    examples: ['/spawn swe-pool', '/spawn swe-pool --count 3'],
    aliases: ['sp']
  });

  CommandParser.register('workflow-status', handleWorkflowStatus, 'Show workflow status', {
    usage: '/workflow-status [--json]',
    examples: ['/workflow-status'],
    aliases: ['wf-status', 'wfs']
  });

  CommandParser.register('kb-stats', handleKbStats, 'Show knowledge base statistics', {
    usage: '/kb-stats [--json]',
    examples: ['/kb-stats'],
    aliases: ['kbs']
  });

  CommandParser.register('search', handleSearch, 'Search the knowledge base', {
    usage: '/search <query> [--limit N]',
    examples: ['/search authentication', '/search "OAuth2 flow" --limit 5'],
    aliases: ['s', 'find']
  });

  CommandParser.register('scrape', handleScrape, 'Scrape URL to knowledge base', {
    usage: '/scrape <url> [--source TYPE]',
    examples: ['/scrape https://example.com/docs', '/scrape https://api.example.com --source github'],
    aliases: ['sc']
  });

  CommandParser.register('research', handleResearch, 'Research a topic', {
    usage: '/research <query>',
    examples: ['/research "how to implement OAuth2"', '/research authentication best practices'],
    aliases: ['r']
  });

  CommandParser.register('poll-status', handlePollStatus, 'Show active polling tasks', {
    usage: '/poll-status [--json]',
    examples: ['/poll-status'],
    aliases: ['ps']
  });

  CommandParser.register('implement-work-item', handleImplementWorkItem, 'Start SDLC workflow for work item', {
    usage: '/implement-work-item <id>',
    examples: ['/implement-work-item JIRA-123', '/implement-work-item GH-456'],
    aliases: ['implement', 'iwi']
  });

  console.log('[CLI] Initialized with', CommandParser.getCommands().size, 'commands');
}

/**
 * Execute a command string
 */
export async function executeCommand(input: string): Promise<import('./parser.js').CommandResult> {
  const { CommandParser } = await import('./parser.js');
  return CommandParser.execute(input);
}

/**
 * Quick parse helper
 */
export function parseCommand(input: string): import('./parser.js').ParsedCommand | null {
  const { CommandParser } = require('./parser.js');
  return CommandParser.parse(input);
}

/**
 * Get CLI help text
 */
export function getHelp(command?: string): string {
  const { CommandParser } = require('./parser.js');
  return CommandParser.getHelp(command);
}

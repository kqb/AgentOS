/**
 * CommandParser - CLI-style command parsing and routing
 *
 * Provides:
 * - Slash command parsing (/command args)
 * - Route registration
 * - Middleware support
 * - Help generation
 */

import { EventBus } from '../core/event-bus.js';

/** Parsed command structure */
export interface ParsedCommand {
  command: string;
  args: string[];
  rawArgs: string;
  flags: Record<string, string | boolean>;
}

/** Command result */
export interface CommandResult {
  success: boolean;
  data?: unknown;
  error?: string;
  message?: string;
}

/** Command handler function */
export type CommandHandler = (
  args: string[],
  flags: Record<string, string | boolean>,
  context: CommandContext
) => Promise<CommandResult> | CommandResult;

/** Command context passed to handlers */
export interface CommandContext {
  rawInput: string;
  parsed: ParsedCommand;
  user?: string;
  timestamp: number;
}

/** Command registration options */
export interface CommandRegistration {
  handler: CommandHandler;
  description: string;
  usage?: string;
  examples?: string[];
  aliases?: string[];
}

/** Middleware function */
export type Middleware = (
  command: ParsedCommand,
  context: CommandContext,
  next: () => Promise<CommandResult>
) => Promise<CommandResult>;

/** Command parser singleton */
class CommandParserClass {
  private routes: Map<string, CommandRegistration> = new Map();
  private middleware: Middleware[] = [];
  private aliasMap: Map<string, string> = new Map();

  /**
   * Parse a command string
   */
  parse(input: string): ParsedCommand | null {
    const trimmed = input.trim();

    // Must start with /
    if (!trimmed.startsWith('/')) {
      return null;
    }

    // Split into parts
    const parts = trimmed.slice(1).match(/(?:[^\s"]+|"[^"]*")+/g) || [];
    if (parts.length === 0) return null;

    const command = parts[0].toLowerCase();
    const rest = parts.slice(1);

    // Parse flags and args
    const args: string[] = [];
    const flags: Record<string, string | boolean> = {};

    for (let i = 0; i < rest.length; i++) {
      const part = rest[i].replace(/^"|"$/g, ''); // Remove quotes

      if (part.startsWith('--')) {
        const flagName = part.slice(2);
        const eqIdx = flagName.indexOf('=');

        if (eqIdx > -1) {
          flags[flagName.slice(0, eqIdx)] = flagName.slice(eqIdx + 1);
        } else if (i + 1 < rest.length && !rest[i + 1].startsWith('-')) {
          flags[flagName] = rest[++i].replace(/^"|"$/g, '');
        } else {
          flags[flagName] = true;
        }
      } else if (part.startsWith('-')) {
        const shortFlags = part.slice(1);
        for (const f of shortFlags) {
          flags[f] = true;
        }
      } else {
        args.push(part);
      }
    }

    return {
      command,
      args,
      rawArgs: rest.join(' '),
      flags
    };
  }

  /**
   * Register a command handler
   */
  register(
    command: string,
    handler: CommandHandler,
    description: string,
    options?: {
      usage?: string;
      examples?: string[];
      aliases?: string[];
    }
  ): void {
    const normalizedCommand = command.toLowerCase().replace(/^\//, '');

    this.routes.set(normalizedCommand, {
      handler,
      description,
      usage: options?.usage,
      examples: options?.examples,
      aliases: options?.aliases
    });

    // Register aliases
    if (options?.aliases) {
      for (const alias of options.aliases) {
        this.aliasMap.set(alias.toLowerCase(), normalizedCommand);
      }
    }

    console.log(`[CommandParser] Registered: /${normalizedCommand}`);
  }

  /**
   * Add middleware
   */
  use(middleware: Middleware): void {
    this.middleware.push(middleware);
  }

  /**
   * Execute a command
   */
  async execute(input: string): Promise<CommandResult> {
    const parsed = this.parse(input);

    if (!parsed) {
      return {
        success: false,
        error: 'Invalid command format. Commands must start with /'
      };
    }

    // Resolve aliases
    const resolvedCommand = this.aliasMap.get(parsed.command) || parsed.command;
    parsed.command = resolvedCommand;

    const registration = this.routes.get(resolvedCommand);

    if (!registration) {
      return {
        success: false,
        error: `Unknown command: /${parsed.command}. Use /help for available commands.`
      };
    }

    const context: CommandContext = {
      rawInput: input,
      parsed,
      timestamp: Date.now()
    };

    EventBus.emit('command:executing', { command: parsed.command, args: parsed.args });

    // Build middleware chain
    let index = 0;
    const executeNext = async (): Promise<CommandResult> => {
      if (index < this.middleware.length) {
        const mw = this.middleware[index++];
        return mw(parsed, context, executeNext);
      }
      return registration.handler(parsed.args, parsed.flags, context);
    };

    try {
      const result = await executeNext();

      EventBus.emit('command:completed', {
        command: parsed.command,
        success: result.success
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      EventBus.emit('command:error', {
        command: parsed.command,
        error: errorMessage
      });

      return {
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Get all registered commands
   */
  getCommands(): Map<string, CommandRegistration> {
    return new Map(this.routes);
  }

  /**
   * Get command help
   */
  getHelp(command?: string): string {
    if (command) {
      const normalized = command.toLowerCase().replace(/^\//, '');
      const resolved = this.aliasMap.get(normalized) || normalized;
      const reg = this.routes.get(resolved);

      if (!reg) {
        return `Unknown command: /${command}`;
      }

      let help = `/${resolved} - ${reg.description}\n`;

      if (reg.usage) {
        help += `\nUsage: ${reg.usage}\n`;
      }

      if (reg.aliases?.length) {
        help += `\nAliases: ${reg.aliases.map(a => '/' + a).join(', ')}\n`;
      }

      if (reg.examples?.length) {
        help += '\nExamples:\n';
        for (const ex of reg.examples) {
          help += `  ${ex}\n`;
        }
      }

      return help;
    }

    // List all commands
    let help = 'Available Commands:\n\n';

    const sorted = Array.from(this.routes.entries())
      .sort((a, b) => a[0].localeCompare(b[0]));

    for (const [cmd, reg] of sorted) {
      help += `  /${cmd.padEnd(25)} ${reg.description}\n`;
    }

    help += '\nUse /help <command> for detailed help on a specific command.';

    return help;
  }

  /**
   * Check if command exists
   */
  hasCommand(command: string): boolean {
    const normalized = command.toLowerCase().replace(/^\//, '');
    return this.routes.has(normalized) || this.aliasMap.has(normalized);
  }

  /**
   * Remove a command
   */
  unregister(command: string): boolean {
    const normalized = command.toLowerCase().replace(/^\//, '');

    const reg = this.routes.get(normalized);
    if (!reg) return false;

    // Remove aliases
    if (reg.aliases) {
      for (const alias of reg.aliases) {
        this.aliasMap.delete(alias.toLowerCase());
      }
    }

    return this.routes.delete(normalized);
  }

  /**
   * Clear all commands
   */
  clear(): void {
    this.routes.clear();
    this.aliasMap.clear();
    this.middleware = [];
  }
}

// Export singleton
export const CommandParser = new CommandParserClass();

// Export class for testing
export { CommandParserClass };

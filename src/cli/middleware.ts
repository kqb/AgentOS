/**
 * Command Middleware - Validation, logging, and auth
 *
 * Middleware functions that wrap command execution.
 */

import { ParsedCommand, CommandContext, CommandResult, Middleware } from './parser.js';
import { EventBus } from '../core/event-bus.js';

/**
 * Logging middleware - logs all command executions
 */
export const loggingMiddleware: Middleware = async (
  command: ParsedCommand,
  context: CommandContext,
  next: () => Promise<CommandResult>
): Promise<CommandResult> => {
  const startTime = Date.now();

  console.log(`[CLI] Executing: /${command.command} ${command.rawArgs}`);

  const result = await next();

  const duration = Date.now() - startTime;

  console.log(
    `[CLI] Completed: /${command.command} - ${result.success ? 'SUCCESS' : 'FAILED'} (${duration}ms)`
  );

  EventBus.emit('command:logged', {
    command: command.command,
    args: command.args,
    success: result.success,
    duration
  });

  return result;
};

/**
 * Validation middleware - validates command arguments
 */
export const validationMiddleware: Middleware = async (
  command: ParsedCommand,
  _context: CommandContext,
  next: () => Promise<CommandResult>
): Promise<CommandResult> => {
  // Check for empty commands
  if (!command.command) {
    return {
      success: false,
      error: 'Empty command'
    };
  }

  // Check for command injection attempts
  const dangerousPatterns = [
    /[;&|`$]/,           // Shell metacharacters
    /<script/i,          // Script tags
    /javascript:/i,      // JavaScript protocol
    /\.\.\//,            // Path traversal
  ];

  const fullInput = `${command.command} ${command.rawArgs}`;

  for (const pattern of dangerousPatterns) {
    if (pattern.test(fullInput)) {
      console.warn(`[CLI] Blocked suspicious input: ${fullInput}`);
      return {
        success: false,
        error: 'Invalid characters in command'
      };
    }
  }

  return next();
};

/**
 * Rate limiting middleware - prevents command spam
 */
export function createRateLimitMiddleware(options?: {
  maxCommands?: number;
  windowMs?: number;
}): Middleware {
  const maxCommands = options?.maxCommands ?? 30;
  const windowMs = options?.windowMs ?? 60000; // 1 minute

  const commandHistory: number[] = [];

  return async (
    _command: ParsedCommand,
    _context: CommandContext,
    next: () => Promise<CommandResult>
  ): Promise<CommandResult> => {
    const now = Date.now();

    // Remove old entries
    while (commandHistory.length > 0 && commandHistory[0] < now - windowMs) {
      commandHistory.shift();
    }

    if (commandHistory.length >= maxCommands) {
      return {
        success: false,
        error: `Rate limit exceeded. Max ${maxCommands} commands per ${windowMs / 1000} seconds.`
      };
    }

    commandHistory.push(now);
    return next();
  };
}

/**
 * Auth middleware - checks permissions (placeholder)
 */
export function createAuthMiddleware(options?: {
  requiredPermissions?: string[];
}): Middleware {
  const requiredPermissions = options?.requiredPermissions ?? [];

  return async (
    command: ParsedCommand,
    context: CommandContext,
    next: () => Promise<CommandResult>
  ): Promise<CommandResult> => {
    // In a real implementation, this would check user permissions
    // For now, just pass through
    if (requiredPermissions.length > 0) {
      console.log(`[CLI] Auth check for /${command.command}`);
    }

    return next();
  };
}

/**
 * Error handling middleware - wraps errors nicely
 */
export const errorHandlingMiddleware: Middleware = async (
  command: ParsedCommand,
  _context: CommandContext,
  next: () => Promise<CommandResult>
): Promise<CommandResult> => {
  try {
    return await next();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error occurred';

    console.error(`[CLI] Error in /${command.command}:`, error);

    EventBus.emit('command:error', {
      command: command.command,
      error: message
    });

    return {
      success: false,
      error: `Command failed: ${message}`
    };
  }
};

/**
 * Timing middleware - adds duration to results
 */
export const timingMiddleware: Middleware = async (
  _command: ParsedCommand,
  _context: CommandContext,
  next: () => Promise<CommandResult>
): Promise<CommandResult> => {
  const startTime = Date.now();

  const result = await next();

  const duration = Date.now() - startTime;

  return {
    ...result,
    data: {
      ...((result.data as object) || {}),
      _duration: duration
    }
  };
};

/**
 * Cache middleware - caches command results
 */
export function createCacheMiddleware(options?: {
  ttlMs?: number;
  maxEntries?: number;
  cacheableCommands?: string[];
}): Middleware {
  const ttlMs = options?.ttlMs ?? 60000; // 1 minute
  const maxEntries = options?.maxEntries ?? 100;
  const cacheableCommands = new Set(options?.cacheableCommands ?? [
    'kb-stats',
    'workflow-status',
    'agent-list'
  ]);

  interface CacheEntry {
    result: CommandResult;
    timestamp: number;
  }

  const cache = new Map<string, CacheEntry>();

  return async (
    command: ParsedCommand,
    _context: CommandContext,
    next: () => Promise<CommandResult>
  ): Promise<CommandResult> => {
    // Only cache specified commands
    if (!cacheableCommands.has(command.command)) {
      return next();
    }

    // Don't cache if --no-cache flag
    if (command.flags['no-cache']) {
      return next();
    }

    const cacheKey = `${command.command}:${JSON.stringify(command.args)}`;

    // Check cache
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < ttlMs) {
      return {
        ...cached.result,
        data: {
          ...((cached.result.data as object) || {}),
          _cached: true
        }
      };
    }

    // Execute and cache
    const result = await next();

    if (result.success) {
      // Evict old entries if at max
      if (cache.size >= maxEntries) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey) cache.delete(oldestKey);
      }

      cache.set(cacheKey, {
        result,
        timestamp: Date.now()
      });
    }

    return result;
  };
}

/**
 * Audit middleware - logs commands for audit trail
 */
export function createAuditMiddleware(options?: {
  logToConsole?: boolean;
  emitEvents?: boolean;
}): Middleware {
  const logToConsole = options?.logToConsole ?? false;
  const emitEvents = options?.emitEvents ?? true;

  const auditLog: Array<{
    timestamp: number;
    command: string;
    args: string[];
    success: boolean;
    user?: string;
  }> = [];

  return async (
    command: ParsedCommand,
    context: CommandContext,
    next: () => Promise<CommandResult>
  ): Promise<CommandResult> => {
    const result = await next();

    const auditEntry = {
      timestamp: Date.now(),
      command: command.command,
      args: command.args,
      success: result.success,
      user: context.user
    };

    auditLog.push(auditEntry);

    // Keep only last 1000 entries
    if (auditLog.length > 1000) {
      auditLog.shift();
    }

    if (logToConsole) {
      console.log('[AUDIT]', JSON.stringify(auditEntry));
    }

    if (emitEvents) {
      EventBus.emit('audit:command', auditEntry);
    }

    return result;
  };
}

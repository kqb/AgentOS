/**
 * SignalParser - Parse agent communication signals
 *
 * Recognizes text-based signals:
 * - [TASK_COMPLETE] - Task finished successfully
 * - [HANDOFF] - Transfer to another agent
 * - [CONTEXT_SAVE] - Save context to memory bank
 * - [NEXT_STATE] - Transition to next workflow state
 * - [ESCALATE] - Escalate to human
 * - [ERROR] - Error occurred
 * - [BLOCKED] - Agent is blocked
 * - [POLL_START] - Start polling external system
 * - [POLL_STOP] - Stop polling
 */

import { EventBus } from './event-bus.js';

/** Signal types */
export type SignalType =
  | 'TASK_COMPLETE'
  | 'HANDOFF'
  | 'CONTEXT_SAVE'
  | 'NEXT_STATE'
  | 'ESCALATE'
  | 'ERROR'
  | 'BLOCKED'
  | 'POLL_START'
  | 'POLL_STOP'
  | 'UNKNOWN';

/** Parsed signal */
export interface ParsedSignal {
  type: SignalType;
  raw: string;
  payload: Record<string, string>;
  timestamp: number;
}

/** Signal pattern definition */
interface SignalPattern {
  type: SignalType;
  pattern: RegExp;
  payloadKeys: string[];
}

/** Signal patterns */
const SIGNAL_PATTERNS: SignalPattern[] = [
  {
    type: 'TASK_COMPLETE',
    pattern: /\[TASK_COMPLETE(?::([^\]]+))?\]/,
    payloadKeys: ['summary']
  },
  {
    type: 'HANDOFF',
    pattern: /\[HANDOFF:(\w+)(?::([^\]]+))?\]/,
    payloadKeys: ['targetAgent', 'context']
  },
  {
    type: 'CONTEXT_SAVE',
    pattern: /\[CONTEXT_SAVE:(\w+)(?::([^\]]+))?\]/,
    payloadKeys: ['key', 'value']
  },
  {
    type: 'NEXT_STATE',
    pattern: /\[NEXT_STATE:(\w+)(?::([^\]]+))?\]/,
    payloadKeys: ['state', 'reason']
  },
  {
    type: 'ESCALATE',
    pattern: /\[ESCALATE(?::([^\]]+))?\]/,
    payloadKeys: ['reason']
  },
  {
    type: 'ERROR',
    pattern: /\[ERROR(?::([^\]]+))?\]/,
    payloadKeys: ['message']
  },
  {
    type: 'BLOCKED',
    pattern: /\[BLOCKED(?::([^\]]+))?\]/,
    payloadKeys: ['reason']
  },
  {
    type: 'POLL_START',
    pattern: /\[POLL_START:(\w+)(?::(\d+))?\]/,
    payloadKeys: ['system', 'interval']
  },
  {
    type: 'POLL_STOP',
    pattern: /\[POLL_STOP:(\w+)\]/,
    payloadKeys: ['system']
  }
];

/** Signal parser class */
class SignalParserClass {
  private debugMode = false;

  /**
   * Parse text for signals
   * @param text Text to parse
   * @returns Array of parsed signals
   */
  parse(text: string): ParsedSignal[] {
    const signals: ParsedSignal[] = [];

    for (const pattern of SIGNAL_PATTERNS) {
      const matches = text.matchAll(new RegExp(pattern.pattern, 'g'));

      for (const match of matches) {
        const payload: Record<string, string> = {};

        // Extract payload values
        pattern.payloadKeys.forEach((key, idx) => {
          if (match[idx + 1]) {
            payload[key] = match[idx + 1];
          }
        });

        const signal: ParsedSignal = {
          type: pattern.type,
          raw: match[0],
          payload,
          timestamp: Date.now()
        };

        signals.push(signal);

        if (this.debugMode) {
          console.log(`[SignalParser] Found signal: ${signal.type}`, signal.payload);
        }

        // Emit event for each signal
        EventBus.emit(`signal:${signal.type.toLowerCase()}`, signal);
        EventBus.emit('signal:any', signal);
      }
    }

    return signals;
  }

  /**
   * Check if text contains any signal
   * @param text Text to check
   */
  hasSignal(text: string): boolean {
    return SIGNAL_PATTERNS.some(p => p.pattern.test(text));
  }

  /**
   * Check if text contains a specific signal type
   * @param text Text to check
   * @param type Signal type to look for
   */
  hasSignalType(text: string, type: SignalType): boolean {
    const pattern = SIGNAL_PATTERNS.find(p => p.type === type);
    return pattern ? pattern.pattern.test(text) : false;
  }

  /**
   * Extract first signal of a specific type
   * @param text Text to parse
   * @param type Signal type to extract
   */
  extractFirst(text: string, type: SignalType): ParsedSignal | null {
    const signals = this.parse(text);
    return signals.find(s => s.type === type) || null;
  }

  /**
   * Create a signal string
   * @param type Signal type
   * @param payload Optional payload values
   */
  create(type: SignalType, payload?: Record<string, string>): string {
    if (!payload || Object.keys(payload).length === 0) {
      return `[${type}]`;
    }

    const values = Object.values(payload).filter(v => v);
    if (values.length === 0) {
      return `[${type}]`;
    }

    return `[${type}:${values.join(':')}]`;
  }

  /**
   * Strip all signals from text
   * @param text Text to clean
   */
  stripSignals(text: string): string {
    let result = text;
    for (const pattern of SIGNAL_PATTERNS) {
      result = result.replace(new RegExp(pattern.pattern, 'g'), '');
    }
    return result.trim();
  }

  /**
   * Register a custom signal pattern
   * @param type Signal type name
   * @param pattern Regex pattern
   * @param payloadKeys Keys for captured groups
   */
  registerPattern(type: SignalType, pattern: RegExp, payloadKeys: string[]): void {
    // Check if type already exists
    const existingIdx = SIGNAL_PATTERNS.findIndex(p => p.type === type);
    if (existingIdx >= 0) {
      SIGNAL_PATTERNS[existingIdx] = { type, pattern, payloadKeys };
    } else {
      SIGNAL_PATTERNS.push({ type, pattern, payloadKeys });
    }

    if (this.debugMode) {
      console.log(`[SignalParser] Registered pattern for: ${type}`);
    }
  }

  /**
   * Enable debug logging
   */
  enableDebug(): void {
    this.debugMode = true;
    console.log('[SignalParser] Debug mode enabled');
  }

  /**
   * Disable debug logging
   */
  disableDebug(): void {
    this.debugMode = false;
  }

  /**
   * Get all registered signal types
   */
  getSignalTypes(): SignalType[] {
    return SIGNAL_PATTERNS.map(p => p.type);
  }
}

// Export singleton instance
export const SignalParser = new SignalParserClass();

// Also export the class for testing
export { SignalParserClass };

// Export helper functions
export function parseSignals(text: string): ParsedSignal[] {
  return SignalParser.parse(text);
}

export function createSignal(type: SignalType, payload?: Record<string, string>): string {
  return SignalParser.create(type, payload);
}

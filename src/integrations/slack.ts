/**
 * Slack Integration Adapter
 *
 * Webhook-based notifications and messaging:
 * - Send messages to channels
 * - Rich message formatting (blocks)
 * - Thread replies
 */

import { IntegrationAdapter, RequestOptions } from './base.js';
import type { IntegrationResult, SlackMessage } from '../types/integration.js';

/** Slack block element */
interface SlackBlock {
  type: 'section' | 'divider' | 'header' | 'context' | 'actions';
  text?: {
    type: 'plain_text' | 'mrkdwn';
    text: string;
    emoji?: boolean;
  };
  fields?: Array<{
    type: 'plain_text' | 'mrkdwn';
    text: string;
  }>;
  accessory?: unknown;
  elements?: unknown[];
}

/** Message payload */
interface SendMessagePayload {
  channel?: string;
  text: string;
  blocks?: SlackBlock[];
  threadTs?: string;
  unfurlLinks?: boolean;
  unfurlMedia?: boolean;
}

/** Webhook payload */
interface WebhookPayload {
  text: string;
  blocks?: SlackBlock[];
  thread_ts?: string;
  unfurl_links?: boolean;
  unfurl_media?: boolean;
}

/**
 * Slack Integration Adapter
 */
export class SlackAdapter extends IntegrationAdapter<'slack'> {
  readonly type = 'slack' as const;
  readonly name = 'Slack';
  readonly baseUrl = 'https://hooks.slack.com/services';

  private webhookUrl: string | null = null;
  private botToken: string | null = null;

  /**
   * Authenticate - for Slack, this means validating webhook URL
   */
  protected async doAuthenticate(): Promise<boolean> {
    if (!this.config?.credentials) {
      throw new Error('Slack credentials not configured');
    }

    const { webhookUrl, botToken } = this.config.credentials as { webhookUrl?: string; botToken?: string };

    if (webhookUrl) {
      this.webhookUrl = webhookUrl;
      // Webhook URLs don't need authentication test
      return true;
    }

    if (botToken) {
      this.botToken = botToken;
      this.authState.token = botToken;
      // Test with auth.test endpoint
      const result = await this.request<{ ok: boolean }>('auth.test');
      return result.success && (result.data as { ok: boolean })?.ok;
    }

    throw new Error('Either webhookUrl or botToken required');
  }

  /**
   * Build URL - different for webhook vs API
   */
  protected buildUrl(path: string): string {
    if (this.webhookUrl && path === 'webhook') {
      return this.webhookUrl;
    }
    return `https://slack.com/api/${path}`;
  }

  /**
   * Send a message via webhook
   */
  async sendWebhookMessage(
    text: string,
    options: { blocks?: SlackBlock[]; threadTs?: string } = {}
  ): Promise<IntegrationResult<void>> {
    if (!this.webhookUrl) {
      return { success: false, error: 'Webhook URL not configured' };
    }

    const payload: WebhookPayload = {
      text,
      blocks: options.blocks,
      thread_ts: options.threadTs,
      unfurl_links: false,
      unfurl_media: false
    };

    return this.request<void>('webhook', {
      method: 'POST',
      body: payload
    });
  }

  /**
   * Send a message via Bot API
   */
  async sendMessage(payload: SendMessagePayload): Promise<IntegrationResult<SlackMessage>> {
    if (!this.botToken) {
      return { success: false, error: 'Bot token not configured' };
    }

    return this.request<SlackMessage>('chat.postMessage', {
      method: 'POST',
      body: {
        channel: payload.channel,
        text: payload.text,
        blocks: payload.blocks,
        thread_ts: payload.threadTs,
        unfurl_links: payload.unfurlLinks ?? false,
        unfurl_media: payload.unfurlMedia ?? false
      }
    });
  }

  /**
   * Update an existing message
   */
  async updateMessage(
    channel: string,
    ts: string,
    text: string,
    blocks?: SlackBlock[]
  ): Promise<IntegrationResult<SlackMessage>> {
    if (!this.botToken) {
      return { success: false, error: 'Bot token not configured' };
    }

    return this.request<SlackMessage>('chat.update', {
      method: 'POST',
      body: {
        channel,
        ts,
        text,
        blocks
      }
    });
  }

  /**
   * Delete a message
   */
  async deleteMessage(channel: string, ts: string): Promise<IntegrationResult<void>> {
    if (!this.botToken) {
      return { success: false, error: 'Bot token not configured' };
    }

    return this.request<void>('chat.delete', {
      method: 'POST',
      body: { channel, ts }
    });
  }

  /**
   * Add a reaction to a message
   */
  async addReaction(channel: string, ts: string, emoji: string): Promise<IntegrationResult<void>> {
    if (!this.botToken) {
      return { success: false, error: 'Bot token not configured' };
    }

    return this.request<void>('reactions.add', {
      method: 'POST',
      body: { channel, timestamp: ts, name: emoji }
    });
  }

  /**
   * Create a formatted message for workflow updates
   */
  createWorkflowMessage(
    title: string,
    status: 'success' | 'failure' | 'in_progress' | 'blocked',
    details: Array<{ label: string; value: string }>
  ): { text: string; blocks: SlackBlock[] } {
    const statusEmoji = {
      success: ':white_check_mark:',
      failure: ':x:',
      in_progress: ':hourglass_flowing_sand:',
      blocked: ':warning:'
    };

    const statusText = {
      success: 'Completed',
      failure: 'Failed',
      in_progress: 'In Progress',
      blocked: 'Blocked'
    };

    const blocks: SlackBlock[] = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${statusEmoji[status]} ${title}`,
          emoji: true
        }
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Status:*\n${statusText[status]}` },
          ...details.map(d => ({ type: 'mrkdwn' as const, text: `*${d.label}:*\n${d.value}` }))
        ]
      }
    ];

    return {
      text: `${title} - ${statusText[status]}`,
      blocks
    };
  }

  /**
   * Create error notification
   */
  createErrorMessage(
    title: string,
    error: string,
    context?: Record<string, string>
  ): { text: string; blocks: SlackBlock[] } {
    const blocks: SlackBlock[] = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `:rotating_light: ${title}`,
          emoji: true
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `\`\`\`${error}\`\`\``
        }
      }
    ];

    if (context) {
      blocks.push({
        type: 'context',
        elements: Object.entries(context).map(([k, v]) => ({
          type: 'mrkdwn',
          text: `*${k}:* ${v}`
        }))
      } as SlackBlock);
    }

    return {
      text: `${title}: ${error}`,
      blocks
    };
  }

  /**
   * Test connection
   */
  async testConnection(): Promise<boolean> {
    if (this.webhookUrl) {
      // Send a test message
      const result = await this.sendWebhookMessage('AgentOS connection test');
      return result.success;
    }

    if (this.botToken) {
      const result = await this.request<{ ok: boolean }>('auth.test');
      return result.success && (result.data as { ok: boolean })?.ok;
    }

    return false;
  }

  /**
   * Mock request handler
   */
  protected async mockRequest<R>(path: string, options: RequestOptions): Promise<IntegrationResult<R>> {
    console.log(`[Slack Mock] ${options.method || 'GET'} ${path}`);

    if (path === 'webhook' || path === 'chat.postMessage') {
      const body = options.body as WebhookPayload | undefined;
      console.log(`[Slack Mock] Message: ${body?.text}`);
      return {
        success: true,
        data: {
          ok: true,
          channel: 'C1234567890',
          ts: `${Date.now()}.000000`,
          message: {
            text: body?.text || '',
            type: 'message'
          }
        } as R
      };
    }

    if (path === 'auth.test') {
      return {
        success: true,
        data: {
          ok: true,
          user_id: 'U1234567890',
          team_id: 'T1234567890'
        } as R
      };
    }

    return { success: true, data: { ok: true } as R };
  }
}

// Export singleton instance
export const slackAdapter = new SlackAdapter();

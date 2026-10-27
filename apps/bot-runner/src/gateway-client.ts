/**
 * Gateway Client — calls the panel LLM gateway using the bot's HMAC token.
 *
 * Route: POST /internal/llm/chat
 */

import type { GatewayChatMessage, GatewayChatResponse } from './types.js';

export interface CallGatewayOptions {
  gatewayUrl: string;
  botToken: string;
  messages: GatewayChatMessage[];
  maxTokens?: number;
  timeoutMs?: number;
}

export class GatewayClient {
  private gatewayUrl: string;
  private botToken: string;

  constructor(gatewayUrl: string, botToken: string) {
    this.gatewayUrl = gatewayUrl.replace(/\/+$/, '');
    this.botToken = botToken;
  }

  /**
   * Request a chat completion from the panel gateway.
   */
  async chat(messages: GatewayChatMessage[], maxTokens = 150, timeoutMs = 20000): Promise<string> {
    const url = `${this.gatewayUrl}/internal/llm/chat`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.botToken}`,
        },
        body: JSON.stringify({
          messages,
          max_tokens: maxTokens,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({ message: res.statusText })) as { code?: string; message?: string };
        if (res.status === 429) {
          if (errJson.code === 'BUDGET_EXHAUSTED') {
            throw new Error('Daily token budget has been exhausted.');
          }
          throw new Error('Rate limit exceeded. Please wait a moment.');
        }
        throw new Error(errJson.message ?? `Gateway error (${res.status})`);
      }

      const data = await res.json() as GatewayChatResponse;
      const content = data.choices?.[0]?.message?.content;
      return content ?? '';
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error('LLM request timed out.');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

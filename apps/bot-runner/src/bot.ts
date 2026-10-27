/**
 * Mineflayer Bot Lifecycle and Event Loop.
 *
 * Implements §9B.4 & §9B.5 of IMPLEMENTATION_PLAN.md.
 */

import mineflayer from 'mineflayer';
import type { BotConfig } from './types.js';
import {
  isAddressedToBot,
  handleFastCommand,
  checkPlayerRateLimit,
  sanitizeOutput,
  formatPromptWithInjectionDefense,
} from './chat.js';
import { GatewayClient } from './gateway-client.js';

export class CompanionBotRunner {
  private config: BotConfig;
  private bot: mineflayer.Bot | null = null;
  private gatewayClient: GatewayClient;
  private isRunning = false;
  private reconnectTimeout: NodeJS.Timeout | null = null;

  constructor(config: BotConfig) {
    this.config = config;
    this.gatewayClient = new GatewayClient(config.panelGatewayUrl, config.botToken);
  }

  /**
   * Start the bot and initiate connection.
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.connect();
  }

  /**
   * Stop the bot and disconnect cleanly.
   */
  stop(): void {
    this.isRunning = false;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.bot) {
      this.bot.quit();
      this.bot = null;
    }
    console.log(`[BotRunner] Bot "${this.config.botName}" stopped.`);
  }

  private connect(): void {
    console.log(`[BotRunner] Connecting to ${this.config.serverHost}:${this.config.serverPort} as "${this.config.botName}" (auth: ${this.config.authMode})...`);

    try {
      this.bot = mineflayer.createBot({
        host: this.config.serverHost,
        port: this.config.serverPort,
        username: this.config.botName,
        auth: this.config.authMode === 'offline' ? 'offline' : 'microsoft',
        version: this.config.minecraftVersion || undefined,
      });

      this.setupEventHandlers(this.bot);
    } catch (err) {
      console.error('[BotRunner] Failed to initialize mineflayer bot:', err);
      this.scheduleReconnect();
    }
  }

  private setupEventHandlers(bot: mineflayer.Bot): void {
    bot.on('spawn', () => {
      console.log(`[BotRunner] "${this.config.botName}" successfully spawned into the game!`);
      // Initial greeting
      setTimeout(() => {
        try {
          bot.chat(`${this.config.botName} ready! Say "!help" or talk to me directly.`);
        } catch {
          // ignore chat error on initial spawn
        }
      }, 1500);
    });

    // Public chat listener
    bot.on('chat', (username: string, message: string) => {
      this.handleIncomingChat(username, message, false);
    });

    // Private whisper listener
    bot.on('whisper', (username: string, message: string) => {
      this.handleIncomingChat(username, message, true);
    });

    bot.on('kicked', (reason: string) => {
      console.warn(`[BotRunner] Bot was kicked: ${reason}`);
      this.scheduleReconnect();
    });

    bot.on('error', (err: Error) => {
      console.error('[BotRunner] Bot error:', err.message);
    });

    bot.on('end', () => {
      console.log('[BotRunner] Connection ended.');
      if (this.isRunning) {
        this.scheduleReconnect();
      }
    });
  }

  private async handleIncomingChat(username: string, message: string, isWhisper: boolean): Promise<void> {
    if (!this.bot) return;

    // Never respond to own messages
    if (username === this.config.botName || username === this.bot.username) {
      return;
    }

    // 1. Addressing Check (§9B.5): Unaddressed messages produce zero LLM calls
    const { addressed, content } = isAddressedToBot(message, this.config.botName, isWhisper);
    if (!addressed) {
      return;
    }

    console.log(`[BotRunner] Addressed chat from "${username}": "${content}"`);

    // 2. Fast Commands (instant, zero LLM, work even if LLM is offline)
    const statusSnapshot = this.getStatusSnapshot();
    const fastCmd = handleFastCommand(content, this.config.botName, statusSnapshot);
    if (fastCmd.isFastCommand && fastCmd.reply) {
      this.bot.chat(fastCmd.reply);
      return;
    }

    // 3. Player Rate Limit (1 message per 2 seconds per player)
    if (!checkPlayerRateLimit(username)) {
      this.bot.chat(`[${this.config.botName}] Please wait a moment before sending another message.`);
      return;
    }

    // 4. Natural Language Chat through the LLM Gateway
    try {
      const messages = formatPromptWithInjectionDefense(
        username,
        content,
        this.config.persona,
        this.config.botName,
      );

      const reply = await this.gatewayClient.chat(messages);
      const sanitized = sanitizeOutput(reply);

      if (sanitized) {
        this.bot.chat(sanitized);
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Error communicating with AI gateway';
      console.error('[BotRunner] Gateway chat failure:', errMsg);
      this.bot.chat(`[${this.config.botName}] Sorry, I had trouble thinking of a reply: ${errMsg}`);
    }
  }

  private getStatusSnapshot(): string {
    if (!this.bot) return 'Offline';
    const health = this.bot.health ?? 20;
    const food = this.bot.food ?? 20;
    const pos = this.bot.entity?.position;
    const coords = pos ? `(${Math.round(pos.x)}, ${Math.round(pos.y)}, ${Math.round(pos.z)})` : 'unknown';
    return `Health: ${health}/20 | Food: ${food}/20 | Pos: ${coords}`;
  }

  private scheduleReconnect(): void {
    if (!this.isRunning || this.reconnectTimeout) return;
    console.log('[BotRunner] Reconnecting in 10 seconds...');
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      if (this.isRunning) {
        this.connect();
      }
    }, 10000);
  }
}

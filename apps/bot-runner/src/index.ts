/**
 * Entry point for the VaultRealm Bot Runner container.
 */

import { z } from 'zod';
import { CompanionBotRunner } from './bot.js';
import type { BotConfig } from './types.js';

const envSchema = z.object({
  BOT_ID: z.string().min(1, 'BOT_ID is required'),
  BOT_NAME: z.string().default('Buddy'),
  SERVER_ID: z.string().default('default-server'),
  SERVER_HOST: z.string().default('localhost'),
  SERVER_PORT: z.coerce.number().default(25565),
  AUTH_MODE: z.enum(['offline', 'microsoft', 'proxy']).default('offline'),
  PERSONA: z.string().default('helpful friend'),
  PANEL_GATEWAY_URL: z.string().default('http://localhost:3001'),
  BOT_TOKEN: z.string().min(1, 'BOT_TOKEN is required'),
  MINECRAFT_VERSION: z.string().optional(),
});

function main() {
  console.log('[BotRunner] Starting VaultRealm AI Companion...');

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('[BotRunner] Invalid environment configuration:');
    for (const issue of parsed.error.issues) {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }

  const env = parsed.data;
  const config: BotConfig = {
    botId: env.BOT_ID,
    botName: env.BOT_NAME,
    serverId: env.SERVER_ID,
    serverHost: env.SERVER_HOST,
    serverPort: env.SERVER_PORT,
    authMode: env.AUTH_MODE,
    persona: env.PERSONA,
    panelGatewayUrl: env.PANEL_GATEWAY_URL,
    botToken: env.BOT_TOKEN,
    minecraftVersion: env.MINECRAFT_VERSION,
  };

  const runner = new CompanionBotRunner(config);
  runner.start();

  const shutdown = () => {
    console.log('[BotRunner] Shutting down cleanly...');
    runner.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();

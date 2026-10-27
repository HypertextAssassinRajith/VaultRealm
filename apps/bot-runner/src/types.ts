/**
 * Types for the Bot Runner.
 */

import type { ProtectedZone, Vec3 } from './safety.js';
import type { CommandPolicy } from './permissions.js';

export interface BotConfig {
  botId: string;
  botName: string;
  serverId: string;
  serverHost: string;
  serverPort: number;
  authMode: 'offline' | 'microsoft' | 'proxy';
  persona: string;
  panelGatewayUrl: string;
  botToken: string;
  minecraftVersion?: string;
  ownerName?: string;
  trustedPlayers?: string[];
  whoCanCommand?: CommandPolicy;
  protectedZones?: ProtectedZone[];
  savedPlaces?: Record<string, Vec3>;
  useJsonActionFallback?: boolean;
}

export interface ChatMessage {
  username: string;
  message: string;
  isWhisper: boolean;
  timestamp: number;
}

export interface FastCommandResult {
  isFastCommand: boolean;
  reply?: string;
  command?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface GatewayChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface GatewayChatResponse {
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: ToolCall[];
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

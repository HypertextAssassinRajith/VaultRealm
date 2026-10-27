/**
 * Types for the Bot Runner.
 */

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

export interface GatewayChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GatewayChatResponse {
  choices: Array<{
    message: {
      role: string;
      content: string | null;
    };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

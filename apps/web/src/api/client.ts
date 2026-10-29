/**
 * VaultRealm API Client — Typed wrapper around Fastify backend.
 */

export interface ApiError {
  code: string;
  message: string;
  details?: string[];
}

export interface User {
  id: string;
  email: string;
  username: string;
  role: 'admin' | 'user';
  token?: string;
}

export interface ServerPort {
  name: string;
  hostPort: number;
  containerPort: number;
  protocol: string;
}

export interface ServerDetail {
  id: string;
  name: string;
  templateId: string;
  templateName: string;
  status: 'creating' | 'pulling' | 'starting' | 'running' | 'stopping' | 'stopped' | 'crashed' | 'error';
  ramMb: number;
  cpuLimit: number;
  diskLimitMb: number;
  ports: ServerPort[];
  createdAt: string;
  lastStartedAt: string | null;
}

export interface GameTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  minRamMb: number;
  defaultRamMb: number;
  defaultCpu: number;
  defaultDiskMb: number;
  ports: Array<{ name: string; containerPort: number; protocol: 'tcp' | 'udp' }>;
  env: Array<{ key: string; label: string; default?: string; required?: boolean }>;
}

export interface CapacityStatus {
  host: {
    totalHostRamMb: number;
    budgetPct: number;
    budgetRamMb: number;
    allocatedRamMb: number;
    availableBudgetRamMb: number;
    freeHostRamMb: number;
  };
  user: {
    serverCount: number;
    quotaServers: number;
    ramMb: number;
    quotaRamMb: number;
    cpuLimit: number;
    quotaCpu: number;
    diskLimitMb: number;
    quotaDiskMb: number;
  };
}

export interface DiagnosisFinding {
  ruleId: string;
  severity: 'info' | 'warn' | 'error';
  title: string;
  explanation: string;
  evidence: string[];
  fixes: Array<{
    label: string;
    action: {
      type: string;
      payload?: Record<string, unknown>;
    };
  }>;
}

export interface TimelineEvent {
  id: string;
  serverId: string;
  kind: string;
  message: string;
  ts: string;
  dataJson?: string;
}

const TOKEN_KEY = 'vr_session_token';

let currentToken: string | null =
  typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null;

export function getAuthToken(): string | null {
  return currentToken;
}

export function setAuthToken(token: string | null): void {
  currentToken = token;
  if (typeof window !== 'undefined') {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (currentToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${currentToken}`);
  }

  const res = await fetch(path, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (!res.ok) {
    let error: ApiError = {
      code: 'HTTP_ERROR',
      message: `Request failed with status ${res.status}`,
    };
    try {
      const data = await res.json();
      if (data && (data.message || data.code)) {
        error = data;
      }
    } catch {
      // ignore JSON parse error on non-json response
    }
    throw error;
  }

  if (res.status === 204) {
    return {} as T;
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return res.json();
  }

  return res.text() as unknown as T;
}

export const api = {
  // Auth
  getSetupStatus: () => request<{ needsSetup: boolean }>('/api/auth/setup-status'),
  getMe: () => request<User>('/api/me'),
  login: async (login: string, password: string) => {
    const user = await request<User>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ login, password }),
    });
    if (user.token) {
      setAuthToken(user.token);
    }
    return user;
  },
  register: async (body: { email: string; username: string; password: string; inviteCode?: string }) => {
    const user = await request<User>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (user.token) {
      setAuthToken(user.token);
    }
    return user;
  },
  logout: async () => {
    try {
      return await request<{ message: string }>('/api/auth/logout', { method: 'POST' });
    } finally {
      setAuthToken(null);
    }
  },
  getToken: () => getAuthToken(),

  // System
  getCapacity: () => request<CapacityStatus>('/api/system/capacity'),

  // Templates
  listTemplates: () => request<GameTemplate[]>('/api/templates'),

  // Servers
  listServers: () => request<ServerDetail[]>('/api/servers'),
  getServer: (id: string) => request<ServerDetail>(`/api/servers/${id}`),
  deployServer: (data: {
    name: string;
    templateId: string;
    ramMb?: number;
    cpuLimit?: number;
    env?: Record<string, string>;
  }) => request<{ id: string; name: string; status: string }>('/api/servers', {
    method: 'POST',
    body: JSON.stringify(data),
  }),

  // Power actions
  startServer: (id: string) => request<{ message: string }>(`/api/servers/${id}/start`, { method: 'POST' }),
  stopServer: (id: string) => request<{ message: string }>(`/api/servers/${id}/stop`, { method: 'POST' }),
  restartServer: (id: string) => request<{ message: string }>(`/api/servers/${id}/restart`, { method: 'POST' }),
  killServer: (id: string) => request<{ message: string }>(`/api/servers/${id}/kill`, { method: 'POST' }),
  deleteServer: (id: string) => request<{ message: string }>(`/api/servers/${id}`, { method: 'DELETE' }),

  // Console & Debugging
  sendCommand: (id: string, command: string) =>
    request<{ output: string; timestamp: string }>(`/api/servers/${id}/command`, {
      method: 'POST',
      body: JSON.stringify({ command }),
    }),
  getEvents: (id: string) => request<TimelineEvent[]>(`/api/servers/${id}/events`),
  getDiagnosis: (id: string) => request<DiagnosisFinding[]>(`/api/servers/${id}/diagnose`),
  applyFix: (id: string, action: { type: string; payload?: Record<string, unknown> }) =>
    request<{ success: boolean; message: string }>(`/api/servers/${id}/fixes/apply`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    }),
  getDebugBundleUrl: (id: string) => `/api/servers/${id}/debug-bundle`,

  // Admin
  listInvites: () => request<Array<{ id: string; code: string; uses: number; maxUses: number; createdAt: string }>>('/api/admin/invites'),
  createInvite: (maxUses = 10) =>
    request<{ id: string; code: string; maxUses: number }>('/api/admin/invites', {
      method: 'POST',
      body: JSON.stringify({ maxUses }),
    }),
  deleteInvite: (id: string) => request<{ message: string }>(`/api/admin/invites/${id}`, { method: 'DELETE' }),

  // Companion & LLM Endpoints
  listEndpointPresets: () => request<{ presets: LlmEndpointPreset[] }>('/api/llm-endpoints/presets'),
  listEndpoints: () => request<{ endpoints: LlmEndpoint[] }>('/api/llm-endpoints'),
  createEndpoint: (data: {
    name: string;
    baseUrl: string;
    apiKey?: string;
    defaultModel?: string;
    timeoutS?: number;
  }) => request<LlmEndpoint>('/api/llm-endpoints', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  updateEndpoint: (
    id: string,
    data: Partial<{
      name: string;
      baseUrl: string;
      apiKey: string;
      defaultModel: string;
      timeoutS: number;
    }>,
  ) => request<{ id: string; updated: string[] }>(`/api/llm-endpoints/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  deleteEndpoint: (id: string) => request<void>(`/api/llm-endpoints/${id}`, { method: 'DELETE' }),
  testEndpoint: (id: string, model?: string) =>
    request<TestConnectionResult>(`/api/llm-endpoints/${id}/test`, {
      method: 'POST',
      body: JSON.stringify({ model }),
    }),
  getCompanionUsage: (serverId: string) =>
    request<CompanionUsage>(`/api/servers/${serverId}/companion/usage`),

  // Bot management
  getBot: (serverId: string) =>
    request<{ configured: boolean; bot: BotDetail | null }>(`/api/servers/${serverId}/companion/bot`),
  updateBot: (serverId: string, data: BotConfigInput) =>
    request<{ id: string; serverId: string; name: string; status: string }>(`/api/servers/${serverId}/companion/bot`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  spawnBot: (serverId: string) =>
    request<{ success: boolean; status: string; containerId: string }>(`/api/servers/${serverId}/companion/bot/spawn`, {
      method: 'POST',
    }),
  despawnBot: (serverId: string) =>
    request<{ success: boolean; status: string }>(`/api/servers/${serverId}/companion/bot/despawn`, {
      method: 'POST',
    }),
  sendBotAction: (serverId: string, action: string, message?: string) =>
    request<{ success: boolean; action: string }>(`/api/servers/${serverId}/companion/bot/action`, {
      method: 'POST',
      body: JSON.stringify({ action, message }),
    }),
  getBotUsage: (serverId: string) =>
    request<CompanionUsage>(`/api/servers/${serverId}/companion/bot/usage`),
  getBotTraces: (serverId: string) =>
    request<{ traces: CompanionTrace[] }>(`/api/servers/${serverId}/companion/bot/traces`),
  getBotDeviceCode: (serverId: string) =>
    request<{ userCode: string; verificationUri: string; expiresIn: number; message: string }>(
      `/api/servers/${serverId}/companion/bot/device-code`,
      { method: 'POST' },
    ),
};

export interface LlmEndpointPreset {
  id: string;
  name: string;
  baseUrl: string;
  defaultModel: string;
}

export interface LlmEndpoint {
  id: string;
  ownerId: string;
  scope: string;
  name: string;
  baseUrl: string;
  defaultModel: string | null;
  lastFour: string | null;
  hasKey: boolean;
  supportsTools: boolean;
  timeoutS: number;
  createdAt: string;
}

export interface TestConnectionStep {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
}

export interface TestConnectionResult {
  steps: TestConnectionStep[];
  supportsTools: boolean;
}



export interface BotDetail {
  id: string;
  serverId: string;
  endpointId: string;
  name: string;
  persona: string;
  model: string | null;
  mode: 'off' | 'manual' | 'auto-solo' | 'always';
  authMode: 'offline' | 'microsoft' | 'proxy';
  whoCanCommand: string;
  proactive: boolean;
  dailyTokenBudget: number;
  rpmLimit: number;
  status: 'offline' | 'joining' | 'online' | 'error';
  containerId: string | null;
  lastSpawnedAt: string | null;
  lastDespawnedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface BotConfigInput {
  endpointId: string;
  name?: string;
  persona?: string;
  model?: string | null;
  mode?: 'off' | 'manual' | 'auto-solo' | 'always';
  authMode?: 'offline' | 'microsoft' | 'proxy';
  whoCanCommand?: string;
  dailyTokenBudget?: number;
  rpmLimit?: number;
  proactive?: boolean;
}

export interface CompanionUsage {
  day: string;
  botId: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requests: number;
  dailyBudget: number;
  remainingTokens: number;
  percentUsed: number;
  estimatedCostUsd: number;
  rpmLimit: number;
}

export interface CompanionTrace {
  id: string;
  timestamp: string;
  latencyMs: number;
  status: string;
  request: unknown;
  response: unknown;
}

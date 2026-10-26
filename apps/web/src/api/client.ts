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

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(path, {
    ...options,
    headers,
    credentials: 'same-origin',
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
  login: (login: string, password: string) =>
    request<User>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ login, password }),
    }),
  register: (body: { email: string; username: string; password: string; inviteCode?: string }) =>
    request<User>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  logout: () => request<{ message: string }>('/api/auth/logout', { method: 'POST' }),

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
};

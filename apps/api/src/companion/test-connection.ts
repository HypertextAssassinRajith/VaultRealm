/**
 * Test-Connection — 3-step validation of an LLM endpoint.
 *
 * 1. GET /models (optional — some endpoints lack it)
 * 2. Tiny chat completion
 * 3. Tool-call probe (tests if the model supports function calling)
 *
 * Failures are mapped to human-readable fixes.
 */

export interface TestStep {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
}

export interface TestConnectionResult {
  steps: TestStep[];
  supportsTools: boolean;
}

/**
 * Map HTTP errors to human-readable fix suggestions.
 */
function mapError(error: unknown): string {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();

    // Check for known status codes in the message
    if (msg.includes('401') || msg.includes('unauthorized')) {
      return 'Invalid API key. Check that your key is correct and has not expired.';
    }
    if (msg.includes('403') || msg.includes('forbidden')) {
      return 'Access denied. Your API key may not have permission for this model.';
    }
    if (msg.includes('404') || msg.includes('not found')) {
      return 'Wrong base URL or invalid model name. Make sure the URL includes /v1 if required (e.g. https://api.openai.com/v1).';
    }
    if (msg.includes('429') || msg.includes('rate limit') || msg.includes('quota')) {
      return 'Rate limited or quota exceeded on the endpoint. Wait and try again, or upgrade your plan.';
    }
    if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('etimedout')) {
      return 'Request timed out. The model may be too slow — try a smaller/faster model.';
    }
    if (msg.includes('econnrefused') || msg.includes('connection refused')) {
      return 'Connection refused. The endpoint is not reachable from this server. Check the URL and that the service is running.';
    }
    if (msg.includes('enotfound') || msg.includes('getaddrinfo')) {
      return 'DNS resolution failed. The hostname could not be resolved. Check the URL.';
    }
    if (msg.includes('ssl') || msg.includes('certificate') || msg.includes('cert')) {
      return 'SSL/TLS error. The endpoint may have an invalid certificate.';
    }

    return error.message;
  }
  return String(error);
}

/**
 * Make a fetch request with timeout handling.
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeoutMs?: number },
): Promise<Response> {
  const { timeoutMs = 15000, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...fetchOptions, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Request timed out');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Run the 3-step connection test against an LLM endpoint.
 */
export async function testConnection(
  baseUrl: string,
  apiKey: string | null,
  model: string | null,
  extraHeaders: Record<string, string> = {},
  timeoutS: number = 15,
): Promise<TestConnectionResult> {
  const steps: TestStep[] = [];
  let supportsTools = false;
  const timeoutMs = timeoutS * 1000;

  // Build common headers
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extraHeaders,
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  // Normalize base URL (remove trailing slash)
  const base = baseUrl.replace(/\/+$/, '');

  // ── Step 1: GET /models ──────────────────────────────────────────────────
  try {
    const res = await fetchWithTimeout(`${base}/models`, {
      method: 'GET',
      headers,
      timeoutMs,
    });

    if (res.ok) {
      const data = await res.json() as { data?: Array<{ id: string }> };
      const count = data?.data?.length ?? 0;
      steps.push({
        name: 'List Models',
        status: 'pass',
        message: `Found ${count} model${count !== 1 ? 's' : ''} available.`,
      });
    } else {
      // Non-critical: some endpoints don't support /models
      steps.push({
        name: 'List Models',
        status: 'warn',
        message: `Endpoint returned ${res.status}. Model listing may not be supported (this is OK for some providers).`,
      });
    }
  } catch (err) {
    steps.push({
      name: 'List Models',
      status: 'warn',
      message: `Could not list models: ${mapError(err)}`,
    });
  }

  // ── Step 2: Chat Completion ──────────────────────────────────────────────
  const chatModel = model ?? 'gpt-3.5-turbo';
  try {
    const res = await fetchWithTimeout(`${base}/chat/completions`, {
      method: 'POST',
      headers,
      timeoutMs,
      body: JSON.stringify({
        model: chatModel,
        messages: [
          { role: 'user', content: 'Respond with exactly: OK' },
        ],
        max_tokens: 5,
        temperature: 0,
      }),
    });

    if (res.ok) {
      const data = await res.json() as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const reply = data?.choices?.[0]?.message?.content ?? '(empty)';
      steps.push({
        name: 'Chat Completion',
        status: 'pass',
        message: `Model responded: "${reply.slice(0, 50)}"`,
      });
    } else {
      const body = await res.text().catch(() => '');
      throw new Error(`${res.status} ${res.statusText}: ${body.slice(0, 200)}`);
    }
  } catch (err) {
    steps.push({
      name: 'Chat Completion',
      status: 'fail',
      message: mapError(err),
    });
    // Can't proceed to tool test if basic completion fails
    return { steps, supportsTools: false };
  }

  // ── Step 3: Tool-Call Probe ──────────────────────────────────────────────
  try {
    const res = await fetchWithTimeout(`${base}/chat/completions`, {
      method: 'POST',
      headers,
      timeoutMs,
      body: JSON.stringify({
        model: chatModel,
        messages: [
          { role: 'system', content: 'You must call the ping tool to respond.' },
          { role: 'user', content: 'Ping test' },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'ping',
              description: 'Simple connectivity test',
              parameters: {
                type: 'object',
                properties: {
                  message: { type: 'string', description: 'Ping message' },
                },
                required: ['message'],
              },
            },
          },
        ],
        tool_choice: 'auto',
        max_tokens: 50,
        temperature: 0,
      }),
    });

    if (res.ok) {
      const data = await res.json() as {
        choices?: Array<{
          message?: {
            tool_calls?: Array<{ function?: { name?: string } }>;
          };
        }>;
      };
      const toolCalls = data?.choices?.[0]?.message?.tool_calls;
      if (toolCalls && toolCalls.length > 0) {
        supportsTools = true;
        steps.push({
          name: 'Tool Calling',
          status: 'pass',
          message: `Model supports tool calling (called: ${toolCalls[0]?.function?.name ?? 'unknown'}).`,
        });
      } else {
        steps.push({
          name: 'Tool Calling',
          status: 'warn',
          message: 'Model did not use tools. Will fall back to JSON-action mode (still works, but less reliable).',
        });
      }
    } else {
      const body = await res.text().catch(() => '');
      // Tool calling might not be supported — that's a warning, not failure
      if (body.includes('tools') || body.includes('not supported')) {
        steps.push({
          name: 'Tool Calling',
          status: 'warn',
          message: 'This model/endpoint does not support tool calling. Will use JSON-action fallback mode.',
        });
      } else {
        steps.push({
          name: 'Tool Calling',
          status: 'warn',
          message: `Tool probe returned ${res.status}: ${mapError(new Error(body.slice(0, 200)))}`,
        });
      }
    }
  } catch (err) {
    steps.push({
      name: 'Tool Calling',
      status: 'warn',
      message: `Tool probe failed: ${mapError(err)}. Will use JSON-action fallback mode.`,
    });
  }

  return { steps, supportsTools };
}

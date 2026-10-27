/**
 * SSRF Guard — validates LLM endpoint URLs to prevent Server-Side Request Forgery.
 *
 * Blocks loopback, link-local, cloud-metadata, and private-range IPs
 * unless the endpoint was created by an admin or ALLOW_PRIVATE_LLM_ENDPOINTS=true.
 */

import { URL } from 'node:url';
import dns from 'node:dns/promises';
import { getConfig } from '../config.js';

/** Private/dangerous IP ranges to block. */
const BLOCKED_RANGES = [
  // IPv4
  { prefix: '127.', description: 'loopback' },
  { prefix: '0.', description: 'unspecified' },
  { prefix: '10.', description: 'private (10.x)' },
  { prefix: '169.254.', description: 'link-local / cloud metadata' },
  // IPv6
  { prefix: '::1', description: 'IPv6 loopback' },
  { prefix: 'fe80:', description: 'IPv6 link-local' },
  { prefix: 'fd', description: 'IPv6 ULA' },
  { prefix: 'fc', description: 'IPv6 ULA' },
] as const;

/** Check if an IP is in 172.16.0.0/12 range. */
function isPrivate172(ip: string): boolean {
  if (!ip.startsWith('172.')) return false;
  const second = parseInt(ip.split('.')[1] ?? '0', 10);
  return second >= 16 && second <= 31;
}

/** Check if an IP is in 192.168.0.0/16 range. */
function isPrivate192(ip: string): boolean {
  return ip.startsWith('192.168.');
}

/** Check if the IP is the AWS/cloud metadata endpoint. */
function isMetadata(ip: string): boolean {
  return ip === '169.254.169.254' || ip === 'fd00:ec2::254';
}

/**
 * Checks whether an IP address is in a blocked range.
 * Returns the reason if blocked, undefined if safe.
 */
export function checkIpBlocked(ip: string): string | undefined {
  const lower = ip.toLowerCase();

  if (isMetadata(ip)) {
    return 'cloud metadata endpoint (169.254.169.254)';
  }

  for (const range of BLOCKED_RANGES) {
    if (lower.startsWith(range.prefix)) {
      return range.description;
    }
  }

  if (isPrivate172(ip)) return 'private range (172.16-31.x)';
  if (isPrivate192(ip)) return 'private range (192.168.x)';

  return undefined;
}

export interface SsrfResult {
  safe: boolean;
  reason?: string;
}

/**
 * Validate an LLM endpoint URL for SSRF safety.
 *
 * @param url - The base URL to validate (e.g. "https://api.openai.com/v1")
 * @param isAdmin - Whether the requester has admin role
 * @returns Whether the URL is safe to use
 */
export async function validateEndpointUrl(
  url: string,
  isAdmin: boolean,
): Promise<SsrfResult> {
  // 1. Parse the URL
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { safe: false, reason: 'Invalid URL format' };
  }

  // 2. Must be http or https
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { safe: false, reason: `Unsupported protocol: ${parsed.protocol}` };
  }

  // 3. Admin or ALLOW_PRIVATE_LLM_ENDPOINTS bypasses IP checks
  const config = getConfig();
  if (isAdmin || config.ALLOW_PRIVATE_LLM_ENDPOINTS) {
    return { safe: true };
  }

  // 4. Resolve hostname to IP addresses
  const hostname = parsed.hostname;

  // Block localhost directly
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return {
      safe: false,
      reason: `Blocked: ${hostname} loopback. Use a public endpoint or set ALLOW_PRIVATE_LLM_ENDPOINTS=true for local models.`,
    };
  }

  // Block direct IP usage of known dangerous IPs
  const directBlock = checkIpBlocked(hostname);
  if (directBlock) {
    return {
      safe: false,
      reason: `Blocked: ${hostname} resolves to ${directBlock}. Use a public endpoint or set ALLOW_PRIVATE_LLM_ENDPOINTS=true for local models.`,
    };
  }

  // 5. DNS resolution check with timeout
  const withTimeout = <T>(p: Promise<T>, ms = 1000): Promise<T> => {
    let timer: NodeJS.Timeout;
    return Promise.race([
      p,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('DNS timeout')), ms);
      }),
    ]).finally(() => clearTimeout(timer));
  };

  try {
    const addresses = await withTimeout(dns.resolve4(hostname), 1000).catch(() => [] as string[]);
    const addresses6 = await withTimeout(dns.resolve6(hostname), 500).catch(() => [] as string[]);
    const allAddresses = [...addresses, ...addresses6];

    if (allAddresses.length === 0) {
      // Couldn't resolve — might be a direct IP or unreachable hostname
      // If the hostname itself is an IP, we already checked it above
      return { safe: true };
    }

    for (const addr of allAddresses) {
      const blocked = checkIpBlocked(addr);
      if (blocked) {
        return {
          safe: false,
          reason: `Blocked: ${hostname} resolves to ${addr} (${blocked}). Use a public endpoint or set ALLOW_PRIVATE_LLM_ENDPOINTS=true for local models.`,
        };
      }
    }
  } catch {
    // DNS resolution failed — this will be caught when actually connecting
    // Allow it through SSRF check; the test-connection will surface the error
  }

  return { safe: true };
}

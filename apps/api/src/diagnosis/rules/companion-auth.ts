/**
 * Diagnosis Rule: Companion Authentication Mode Mismatch.
 *
 * Implements §9B.4 & §9B.6 of IMPLEMENTATION_PLAN.md:
 * Detects when a companion bot joins an online-mode server using offline auth.
 */

import type { DiagnosisRule, Finding, DiagnosisContext } from '../types.js';

export const companionAuthRule: DiagnosisRule = {
  id: 'companion-auth-mismatch',
  name: 'AI Companion Authentication Mode Mismatch',
  match(ctx: DiagnosisContext): Finding | null {
    const authFailLine = ctx.logs.find(
      (line) =>
        /Failed to verify username!/i.test(line) ||
        /Invalid credentials\. Cannot verify username/i.test(line) ||
        /Disconnecting .*: Failed to verify username!/i.test(line) ||
        /User .* is not authenticated with Mojang/i.test(line) ||
        /Authentication servers are unreachable/i.test(line) ||
        /com\.mojang\.authlib\.exceptions\.AuthenticationUnavailableException/i.test(line),
    );

    if (authFailLine) {
      return {
        ruleId: 'companion-auth-mismatch',
        severity: 'error',
        title: 'Companion bot cannot authenticate (Online Mode mismatch)',
        explanation:
          'The Minecraft server has online-mode=true enabled, requiring valid Microsoft/Mojang authenticated accounts. The bot is trying to join with unauthenticated offline credentials.',
        fixes: [
          {
            label: 'Open Microsoft Device-Code Guide',
            action: {
              type: 'open-docs',
              payload: { url: 'https://vaultrealm.dev/docs/companion#microsoft-auth' },
            },
          },
          {
            label: 'Set ONLINE_MODE=FALSE (Private Servers Only)',
            action: {
              type: 'set-env',
              payload: { ONLINE_MODE: 'FALSE' },
            },
          },
        ],
        evidence: [authFailLine],
      };
    }

    return null;
  },
};

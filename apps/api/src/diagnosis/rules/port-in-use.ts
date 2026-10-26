import type { DiagnosisRule, Finding, DiagnosisContext } from '../types.js';

export const portInUseRule: DiagnosisRule = {
  id: 'port-in-use',
  name: 'Port Conflict / Address Already in Use',
  match(ctx: DiagnosisContext): Finding | null {
    const bindLogLine = ctx.logs.find(
      (line) =>
        /FAILED TO BIND TO PORT/i.test(line) ||
        /Address already in use/i.test(line) ||
        /BindException/i.test(line) ||
        /EADDRINUSE/i.test(line),
    );

    if (bindLogLine) {
      return {
        ruleId: 'port-in-use',
        severity: 'error',
        title: 'Port is already in use by another service',
        explanation:
          'The server could not start because its configured port is already occupied by another running server or host process.',
        fixes: [
          {
            label: 'Reallocate a new host port',
            action: { type: 'change-port' },
          },
          {
            label: 'Restart server',
            action: { type: 'restart' },
          },
        ],
        evidence: [bindLogLine],
      };
    }

    return null;
  },
};

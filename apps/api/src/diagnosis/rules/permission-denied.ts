import type { DiagnosisRule, Finding, DiagnosisContext } from '../types.js';

export const permissionDeniedRule: DiagnosisRule = {
  id: 'permission-denied',
  name: 'Storage Volume Permission Denied',
  match(ctx: DiagnosisContext): Finding | null {
    const permLine = ctx.logs.find(
      (line) =>
        /\bPermission denied\b/i.test(line) ||
        /\bEACCES\b/i.test(line) ||
        /\bEPERM\b/i.test(line) ||
        /\(Permission denied\)/i.test(line),
    );

    if (permLine) {
      return {
        ruleId: 'permission-denied',
        severity: 'error',
        title: 'Storage volume permission denied',
        explanation:
          'The container process does not have permission to read or write files inside its data volume. This usually occurs when host directory ownership does not match the container user UID.',
        fixes: [
          {
            label: 'Fix volume permissions (chown to container UID)',
            action: { type: 'chown-volume' },
          },
          {
            label: 'Restart server',
            action: { type: 'restart' },
          },
        ],
        evidence: [permLine],
      };
    }

    return null;
  },
};

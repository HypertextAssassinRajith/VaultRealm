import type { DiagnosisRule, Finding, DiagnosisContext } from '../types.js';

export const diskFullRule: DiagnosisRule = {
  id: 'disk-full',
  name: 'Disk Space Exhausted',
  match(ctx: DiagnosisContext): Finding | null {
    const diskLine = ctx.logs.find(
      (line) =>
        /No space left on device/i.test(line) ||
        /ENOSPC/i.test(line) ||
        /disk full/i.test(line),
    );

    if (diskLine) {
      return {
        ruleId: 'disk-full',
        severity: 'error',
        title: 'Host storage disk is full',
        explanation:
          'The server cannot write files or save world chunks because the host partition has run out of available free space.',
        fixes: [
          {
            label: 'Clean up old backups and logs',
            action: { type: 'clean-disk' },
          },
          {
            label: 'Open documentation on disk cleanup',
            action: {
              type: 'open-docs',
              payload: { topic: 'disk-cleanup' },
            },
          },
        ],
        evidence: [diskLine],
      };
    }

    return null;
  },
};

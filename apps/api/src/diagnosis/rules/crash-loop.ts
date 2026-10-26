import type { DiagnosisRule, Finding, DiagnosisContext } from '../types.js';

export const crashLoopRule: DiagnosisRule = {
  id: 'crash-loop',
  name: 'Container Crash Loop',
  match(ctx: DiagnosisContext): Finding | null {
    // Check logs for explicit crash loop text
    const crashLogLine = ctx.logs.find(
      (line) => /crash-looping/i.test(line) || /crash loop/i.test(line),
    );

    // Or check events for >= 3 crash/die events within 5 minutes (300,000 ms)
    let crashCount = 0;
    const now = Date.now();
    const fiveMinutesMs = 5 * 60 * 1000;

    if (ctx.events) {
      for (const evt of ctx.events) {
        if (
          evt.kind.includes('die') ||
          evt.kind.includes('crash') ||
          evt.kind.includes('failed')
        ) {
          const evtTime = new Date(evt.ts).getTime();
          if (now - evtTime <= fiveMinutesMs) {
            crashCount++;
          }
        }
      }
    }

    if (crashLogLine || crashCount >= 3) {
      return {
        ruleId: 'crash-loop',
        severity: 'error',
        title: 'Server is caught in a crash loop',
        explanation:
          'The server container has repeatedly exited and restarted multiple times in the last 5 minutes. Restart policy should be temporarily paused to prevent server thrashing.',
        fixes: [
          {
            label: 'Stop server and review logs',
            action: {
              type: 'restart',
              payload: { pauseRestartPolicy: true },
            },
          },
          {
            label: 'Open documentation on crash loop resolution',
            action: {
              type: 'open-docs',
              payload: { topic: 'crash-loop' },
            },
          },
        ],
        evidence: crashLogLine
          ? [crashLogLine]
          : [`Detected ${crashCount} crash events in the last 5 minutes`],
      };
    }

    return null;
  },
};

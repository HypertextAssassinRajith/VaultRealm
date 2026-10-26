import type { DiagnosisRule, Finding, DiagnosisContext } from '../types.js';

export const noReadySignalRule: DiagnosisRule = {
  id: 'no-ready-signal',
  name: 'No Ready Signal Received',
  match(ctx: DiagnosisContext): Finding | null {
    const timeoutLogLine = ctx.logs.find(
      (line) =>
        /Ready signal timed out/i.test(line) ||
        /timed out after \d+ seconds without match/i.test(line),
    );

    const hasTimeoutEvent = ctx.events?.some(
      (e) =>
        e.kind.includes('ready_timeout') ||
        (e.kind.includes('verify') && e.kind.includes('failed')),
    );

    if (timeoutLogLine || hasTimeoutEvent) {
      return {
        ruleId: 'no-ready-signal',
        severity: 'warn',
        title: 'Server startup timed out waiting for ready signal',
        explanation:
          'The server process was started, but did not log its expected startup completion signal within the configured timeout window.',
        fixes: [
          {
            label: 'Restart server with increased timeout',
            action: { type: 'restart' },
          },
          {
            label: 'Open server documentation',
            action: {
              type: 'open-docs',
              payload: { topic: 'slow-startup' },
            },
          },
        ],
        evidence: timeoutLogLine
          ? [timeoutLogLine]
          : ['Startup verification timed out before matching expected ready pattern'],
      };
    }

    return null;
  },
};

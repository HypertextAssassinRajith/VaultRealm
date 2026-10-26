import type { DiagnosisRule, Finding, DiagnosisContext } from '../types.js';

export const oomKilledRule: DiagnosisRule = {
  id: 'oom-killed',
  name: 'Out of Memory (OOM)',
  match(ctx: DiagnosisContext): Finding | null {
    const isOomKilled = ctx.inspect?.state?.oomKilled === true;
    const isExit137 = ctx.inspect?.state?.exitCode === 137;

    const oomLogLine = ctx.logs.find(
      (line) =>
        /OutOfMemoryError/i.test(line) ||
        /-XX:OnOutOfMemoryError/i.test(line) ||
        /\bkilled\b/i.test(line.trim()),
    );

    if (isOomKilled || isExit137 || oomLogLine) {
      const currentRam = ctx.inspect?.hostConfig?.memory
        ? Math.round(ctx.inspect.hostConfig.memory / (1024 * 1024))
        : ctx.template?.defaultRamMb ?? 2048;
      const targetRam = currentRam + 1024;

      return {
        ruleId: 'oom-killed',
        severity: 'error',
        title: 'Server ran out of memory (OOM)',
        explanation: `The server process exceeded its memory allocation (${currentRam} MB) and was killed by the OS or JVM. Game servers need sufficient RAM to load chunks and assets.`,
        fixes: [
          {
            label: `Increase RAM to ${targetRam} MB`,
            action: {
              type: 'raise-ram',
              payload: { ramMb: targetRam },
            },
          },
          {
            label: 'Restart server',
            action: { type: 'restart' },
          },
        ],
        evidence: oomLogLine
          ? [oomLogLine]
          : [isOomKilled ? 'Docker State: OOMKilled=true' : 'Exit code: 137 (SIGKILL by OOM killer)'],
      };
    }

    return null;
  },
};

import type { DiagnosisRule, Finding, DiagnosisContext } from '../types.js';

export const unknownExitRule: DiagnosisRule = {
  id: 'unknown-exit',
  name: 'Unexpected Process Exit',
  match(ctx: DiagnosisContext): Finding | null {
    if (ctx.inspect && !ctx.inspect.state.running && ctx.inspect.state.exitCode !== 0) {
      const exitCode = ctx.inspect.state.exitCode;
      const lastLine = ctx.logs.length > 0 ? ctx.logs[ctx.logs.length - 1]! : 'No logs available';

      return {
        ruleId: 'unknown-exit',
        severity: 'error',
        title: `Server process exited unexpectedly (code ${exitCode})`,
        explanation: `The game server terminated with non-zero exit code ${exitCode}. Check recent container logs for error details.`,
        fixes: [
          {
            label: 'Restart server',
            action: { type: 'restart' },
          },
        ],
        evidence: [
          `Exit Code: ${exitCode}`,
          `Last log line: ${lastLine}`,
        ],
      };
    }

    return null;
  },
};

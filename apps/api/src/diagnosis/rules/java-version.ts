import type { DiagnosisRule, Finding, DiagnosisContext } from '../types.js';

export const javaVersionRule: DiagnosisRule = {
  id: 'java-version',
  name: 'Incompatible Java Runtime Version',
  match(ctx: DiagnosisContext): Finding | null {
    const javaLine = ctx.logs.find(
      (line) =>
        /UnsupportedClassVersionError/i.test(line) ||
        /compiled by a more recent version of the Java Runtime/i.test(line) ||
        /requires Java \d+/i.test(line),
    );

    if (javaLine) {
      return {
        ruleId: 'java-version',
        severity: 'error',
        title: 'Incompatible Java Runtime version',
        explanation:
          'The game server jar requires a newer Java Runtime version than what is currently running in the container.',
        fixes: [
          {
            label: 'Upgrade Java Runtime image to Java 21',
            action: {
              type: 'set-env',
              payload: { IMAGE_TAG: 'java21', JVM_OPTS: '' },
            },
          },
          {
            label: 'Restart server',
            action: { type: 'restart' },
          },
        ],
        evidence: [javaLine],
      };
    }

    return null;
  },
};

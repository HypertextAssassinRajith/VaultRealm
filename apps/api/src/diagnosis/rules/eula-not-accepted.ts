import type { DiagnosisRule, Finding, DiagnosisContext } from '../types.js';

export const eulaNotAcceptedRule: DiagnosisRule = {
  id: 'eula-not-accepted',
  name: 'Minecraft EULA Not Accepted',
  match(ctx: DiagnosisContext): Finding | null {
    const eulaLine = ctx.logs.find(
      (line) =>
        /agree to the EULA/i.test(line) ||
        /eula\.txt/i.test(line) ||
        /You need to agree to the EULA in order to run the server/i.test(line),
    );

    if (eulaLine) {
      return {
        ruleId: 'eula-not-accepted',
        severity: 'error',
        title: 'Minecraft EULA has not been accepted',
        explanation:
          'Mojang requires accepting the Minecraft End User License Agreement (EULA) before the server software is allowed to run.',
        fixes: [
          {
            label: 'Accept EULA (Set EULA=TRUE)',
            action: {
              type: 'set-env',
              payload: { EULA: 'TRUE' },
            },
          },
          {
            label: 'Open Minecraft EULA website',
            action: {
              type: 'open-docs',
              payload: { url: 'https://account.mojang.com/documents/minecraft_eula' },
            },
          },
        ],
        evidence: [eulaLine],
      };
    }

    return null;
  },
};

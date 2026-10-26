import type { Config } from 'drizzle-kit';

export default {
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env['DATA_DIR']
      ? `${process.env['DATA_DIR']}/panel.db`
      : './data/panel.db',
  },
} satisfies Config;

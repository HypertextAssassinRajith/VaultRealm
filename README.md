# VaultRealm

A lightweight, modern, multi-user control panel for self-hosting game servers (Minecraft, Palworld, Valheim, …) on a VPS.

## Features

- **One-click deploy** — pick a game, name it, click Deploy
- **Easy debugging** — when something breaks, the panel tells you *what* and *how to fix it*
- **Light and modern** — single small container, fast dark UI, no heavy PHP stack
- **AI companion** — connect any OpenAI-compatible endpoint for AI buddy players

## Tech Stack

- **Backend**: Node.js 22, Fastify, SQLite (Drizzle ORM), dockerode
- **Frontend**: React, Vite, Tailwind CSS v4
- **Deployment**: Docker Compose + Caddy (auto TLS)

## Development

### Prerequisites

- Node.js 22+
- pnpm 9+
- Docker (for running game servers)

### Setup

```bash
# Install dependencies
pnpm install

# Start development servers (API + frontend)
pnpm dev
```

- API: http://localhost:3001
- Frontend: http://localhost:5173

Username: admin (or email: admin@vaultrealm.local)
Password: AdminSecurePassword123!

### Scripts

```bash
pnpm dev        # Start all dev servers
pnpm test       # Run all tests
pnpm typecheck  # TypeScript type checking
pnpm lint       # ESLint
pnpm build      # Production build
```

## Project Structure

```
VaultRealm/
├─ apps/
│  ├─ api/         # Fastify backend
│  └─ web/         # React frontend
├─ templates/      # Game server templates (YAML)
├─ data/           # Runtime data (gitignored)
├─ docker-compose.yml
└─ Caddyfile
```

## License

MIT
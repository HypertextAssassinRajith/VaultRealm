# VaultRealm

A lightweight, modern, multi-user control panel for self-hosting game servers (Minecraft, Palworld, Valheim, …) on a VPS.

## Features

- **One-click deploy** — pick a game, name it, click Deploy
- **Easy debugging** — when something breaks, the panel tells you *what* and *how to fix it*
- **Light and modern** — single small container, fast dark UI, no heavy PHP stack
- **AI companion** — connect any OpenAI-compatible endpoint for AI buddy players

## Tech Stack

- **Backend**: Node.js 22, Fastify, SQLite (Drizzle ORM), dockerode
- **Frontend**: React 19, Vite, Tailwind CSS v4
- **Deployment**: Docker Compose + Caddy (auto TLS)
- **CI/CD**: GitHub Actions → `ghcr.io/hypertextassassinrajith/vaultrealm`

## Development

### Prerequisites

- Node.js 22+
- pnpm 9+
- Docker (for running game servers — optional in dev, mocked by default)

### Setup

```bash
# Install dependencies
pnpm install

# Configure environment
cp apps/api/.env.example apps/api/.env

# Start development servers (API + frontend)
pnpm dev
```

- API: http://localhost:3001
- Frontend: http://localhost:5173

### Default Credentials

| Field | Value |
|-------|-------|
| Username | `admin` |
| Email | `admin@vaultrealm.local` |
| Password | `AdminSecurePassword123!` |

### Scripts

```bash
pnpm dev        # Start all dev servers
pnpm test       # Run all tests (125+)
pnpm typecheck  # TypeScript type checking
pnpm lint       # ESLint
pnpm build      # Production build
```

## Documentation

📖 **[Developer Guide](docs/DEVELOPER_GUIDE.md)** — Architecture, API reference, testing, and how to add templates, routes, and diagnosis rules.

## Project Structure

```
VaultRealm/
├── apps/
│   ├── api/           # Fastify backend (TypeScript)
│   │   ├── src/       # Source code
│   │   └── test/      # 125+ integration tests
│   └── web/           # React 19 frontend (Vite + Tailwind v4)
│       └── src/       # Components, API client, styles
├── docs/              # Developer documentation
├── docker-compose.yml # Production stack
├── Dockerfile         # Multi-stage production build
├── Caddyfile          # Reverse proxy + auto TLS
└── .github/workflows/ # CI/CD (GHCR publish)
```

## Supported Games

| Game | Template ID | Min RAM |
|------|-------------|---------|
| Minecraft Java | `minecraft-java` | 1 GB |
| Minecraft Bedrock | `minecraft-bedrock` | 512 MB |
| Valheim | `valheim` | 2 GB |
| Palworld | `palworld` | 8 GB |
| Terraria | `terraria` | 512 MB |

## License

MIT
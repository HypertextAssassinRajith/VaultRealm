# VaultRealm

A lightweight, modern, multi-user control panel for self-hosting game servers (Minecraft, Palworld, Valheim, …) on a VPS.

## Features

- **One-click deploy** — pick a game, name it, click Deploy
- **Easy debugging** — when something breaks, the panel tells you *what* and *how to fix it*
- **Light and modern** — single small container, fast dark UI, no heavy PHP stack
- **AI companion** — connect any OpenAI-compatible endpoint for AI buddy players
- **Cloud Disaster Recovery** — Google Drive 1-click backup and restore

## Quick Start (Automated Installer)

Install and run VaultRealm on any Linux server (Ubuntu, Debian, CentOS, AlmaLinux, Rocky, Fedora, Alpine) with a single command — no manual Docker configuration required:

```bash
bash <(curl -Ls https://raw.githubusercontent.com/VaultSoft-Labs-Software-Automation/VaultRealm/master/install.sh)
```

### Install a Specific Version

To install a specific version, append its tag (e.g. `v0.1.7`):

```bash
bash <(curl -Ls https://raw.githubusercontent.com/VaultSoft-Labs-Software-Automation/VaultRealm/master/install.sh) v0.1.7
```

### Install the Rolling Dev Build

To install the latest rolling development build from the `dev` branch:

```bash
bash <(curl -Ls https://raw.githubusercontent.com/VaultSoft-Labs-Software-Automation/VaultRealm/dev/install.sh) dev-latest
```

### Management CLI (`vaultrealm` / `vr`)

After installation, run `vaultrealm` or `vr` in your terminal to open the interactive management menu:

```bash
vaultrealm
```

You can also run direct subcommands:
- `vaultrealm status` — Check panel & container health
- `vaultrealm logs` — Stream live panel logs (Ctrl+C to exit)
- `vaultrealm restart` — Restart the control panel service
- `vaultrealm update` — Pull and update to the latest image
- `vaultrealm port <number>` — Change the web panel listening port
- `vaultrealm reset` — Reset initial setup credentials
- `vaultrealm uninstall` — Remove panel service

### Unattended Installation (Cloud-Init / CI)

The installer also runs non-interactively for headless server deployments. Set `VR_NONINTERACTIVE=1`:

```bash
VR_NONINTERACTIVE=1 bash <(curl -Ls https://raw.githubusercontent.com/VaultSoft-Labs-Software-Automation/VaultRealm/master/install.sh)
```

---

## Tech Stack

- **Backend**: Node.js 22, Fastify, SQLite (Drizzle ORM), dockerode
- **Frontend**: React 19, Vite, Tailwind CSS v4
- **Deployment**: Automated Systemd Installer / Docker Compose + Caddy (auto TLS)
- **CI/CD**: GitHub Actions → `hypertextassassin/vaultrealm`

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
pnpm test       # Run all tests (280+)
pnpm typecheck  # TypeScript type checking
pnpm lint       # ESLint
pnpm build      # Production build
pnpm docker:build     # Build panel Docker image
pnpm docker:build:bot # Build companion bot Docker image
```

## Documentation

📖 **[Developer Guide](docs/DEVELOPER_GUIDE.md)** — Architecture, API reference, testing, and how to add templates, routes, and diagnosis rules.

## Project Structure

```
VaultRealm/
├── apps/
│   ├── api/           # Fastify backend (TypeScript)
│   │   ├── src/       # Source code
│   │   └── test/      # 230+ integration tests
│   ├── web/           # React 19 frontend (Vite + Tailwind v4)
│   │   └── src/       # Components, API client, styles
│   └── bot-runner/    # Autonomous AI companion bot runner
├── docs/              # Developer documentation
├── install.sh         # 1-Click Linux Automated Installer & Management CLI
├── docker-compose.yml # Production stack
├── Dockerfile         # Multi-stage production build
├── Caddyfile          # Reverse proxy + auto TLS
└── .github/workflows/ # CI/CD (Docker Hub & GHCR publish)
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

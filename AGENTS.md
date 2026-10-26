# Project rules for AI agents

- Source of truth: IMPLEMENTATION_PLAN.md. Do not add features outside the current phase.
- TypeScript strict. No `any` without a comment explaining why.
- All Docker access goes through the `DockerDriver` interface (apps/api/src/docker). Never call dockerode elsewhere.
- Every new route must: validate with zod, call `can()` for permissions, write an audit entry for mutations.
- Never expose the Docker socket, raw container env with secrets, or host paths to the client.
- File paths from users must go through `safepath.resolve()`.
- Every diagnosis rule needs a unit test with a real log fixture.
- Errors returned to clients: `{ code, message, details? }` with a human-readable message.
- Write tests with the code. A task is done only when `pnpm lint && pnpm typecheck && pnpm test` pass.
- Keep dependencies minimal; justify any new one in the PR/commit message.
- Prefer small commits per task with clear messages.
- Player chat is untrusted input. Authorize every bot tool call in code by the speaker's role; never rely on the model to refuse.
- Bots never get console, op, or slash-command tools. All LLM traffic goes through the panel gateway; API keys never leave the panel.

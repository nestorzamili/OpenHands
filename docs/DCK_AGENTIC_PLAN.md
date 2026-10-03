# DCK Agentic — Customization Plan (fork `dev`)

Status: **F1–F4 implemented on `dev`; F5 (MCP registration at runtime + secrets rollout) and custom image publish pending**. This doc is the build reference for turning this OpenHands Agent Canvas fork into the DCK Agentic core.

## 0. Locked decisions

1. Fork stays on branch `dev`; upstream merges are selective, no obligation to PR back to main.
2. Branding: minimal, English only (title, favicon, home header copy).
3. Homepage: DCK module cards + project lists + lifecycle actions + recent blocks.
4. `webgen/`: Next.js single-service (App Router), shadcn + Tailwind always, Prisma + better-auth only when needed.
5. Databases: one database per webgen app (`CREATE DATABASE dck_<app>` allowed); shared superuser role provisioned by operator.
6. OpenHands itself: PostgreSQL-only, `AUTOMATION_DB_URL` fail-fast, no silent SQLite fallback. Old SQLite files may be deleted (not yet in use).
7. Deploy/rebuild: executed as agent conversation (optionally wrapped as automation templates), never as direct Docker-daemon calls from the frontend.
8. Maximize built-ins: automations, skills, MCP, secrets store, Files/VSCode tabs, conversation panel. No new backend endpoints in this repo.
9. Dashboards: Canvas Extensions under `/apps` ONLY (no standalone compose, no `300x` port, no `.dck.json` per dashboard). Rationale: same-origin embedded pages, sidebar registration, install/enable UI already built in; local-backend-only constraint is acceptable for DCK. Standalone compose is reserved for `webgen/` customer apps needing their own URL + Docker lifecycle.
10. Research: reuse built-in `research-brief` + `news-digest` skills/automations; DCK `social-research` skill becomes a thin wrapper (requires `TAVILY_API_KEY`, Notion optional).
11. Web scaffolding: DCK `web-generator` skill wraps built-ins `frontend-design` + `docker` (+ `vercel` when preview deploy needed) instead of standalone prompting.
12. MCP: register custom Postgres read-only + search (Tavily/Brave) servers via `/mcp`; no builtin Postgres/PowerBI entry exists in the 79-entry catalog.

## 1. Repo boundaries

| Area | Owner repo | Notes |
|---|---|---|
| Canvas UI, homepage, branding, fail-fast launcher messaging | This fork (`dev`) | `src/`, `scripts/`, `docker/`, `helm/`, `config/`, `docs/` |
| Deployment compose, workspace content, DCK skills, per-app projects | Repo root (blended) | `docker-compose.yml`, `workspace/`, `workspace/.agents/skills/` |
| Agent Server conversation/event storage defaults | `software-agent-sdk` (upstream) | Out of scope here; this repo only passes env through and documents |
| Postgres cluster itself | `surrounding/postgresql.yaml` | Existing `postgres:17` on external `proxy` network; operator-owned credentials |

## 2. Module bases

| Module | Runtime | Docker | Detected project unit | Outputs |
|---|---|---|---|---|
| `webgen/` | Next.js fullstack (App Router + API routes), shadcn, Tailwind; Prisma + better-auth optional | Required, one compose stack per app | `webgen/<app>/` containing `docker-compose.yml` + `.dck.json` | Runnable app on `localhost:<port>` |
| `dashboards/` | Canvas Extension (`/apps`): ESM bundle + manifest v1, pages registered in sidebar; Sidecar only for heavy compute | No compose stack (lifecycle = install/enable/uninstall via `/apps` UI) | Extension name + `contributes.pages[]` (`src/types/canvas-extension.ts`) | Embedded dashboard pages inside Canvas |
| `research/` | Built-in `research-brief` + `news-digest` skills/automations; DCK `social-research` skill is a thin wrapper (needs `TAVILY_API_KEY`) | No | `research/YYYY-MM-DD_<topic>_report.md` | Markdown report with sources + timestamps |
| `analytics/` | Python (Pandas/Polars/DuckDB/SQLAlchemy) + SQL to host Postgres, charts to PNG/SVG; also Power BI / DAX / Power Query (M) / TMDL on request | No (one-shot runs) | `analytics/<analysis>.py`, `analytics/charts/` | Scripts, query results, charts, BI models, insight write-up |
| `content/` | Agent only; marketing & social content (captions/scripts, content calendars, SEO/blog, email) applying antislop copywriting | No | `content/YYYY-MM-DD_<name>.md` | Publish-ready marketing content artifacts |

Cards for `research`/`analytics`/`content` show artifact lists + `Continue in conversation`. Only `webgen` gets Docker lifecycle actions (`deploy`/`rebuild`/`stop`/`delete`/env). Dashboards are managed through the built-in `/apps` install/enable/uninstall flow, not card actions.

> **Module revision (post-F4):** the standalone `powerbi/` module was removed to
> cut the data/BI redundancy (Analytics, Power BI, and Dashboards all answered
> "show my data"). Power BI / DAX / Power Query now live inside the
> `data-analytics` skill, and a new `content/` module covers marketing/social
> content production. Final set: `webgen`, `dashboards`, `research`,
> `analytics`, `content`.

## 3. Webgen project standard

```
webgen/<app>/
├── Dockerfile                 # Next.js standalone, single service
├── docker-compose.yml         # service `app`, `ports: ["<port>:3000"]`
├── .dck.json                  # {"name": "<app>", "port": 3000, "stack": "nextjs"}
├── .env.example               # DATABASE_URL / REDIS_URL placeholders (no secrets)
├── .env                       # gitignored real values
├── README.md
├── prisma/schema.prisma       # only when DB needed
└── src/ (App Router), components/ui (shadcn)
```

Rules:

- Single service `app`; no split `frontend/`+`backend/` unless justified.
- External shared Postgres/Redis only:
  - `DATABASE_URL=postgresql://<user>:<pass>@host.docker.internal:5432/dck_<app>`
  - `REDIS_URL=redis://host.docker.internal:6379`
  - No per-project `db` container.
- Port allocation: first free integer ≥ 3000. The agent must check both `grep -r` over `webgen/*/docker-compose.yml` and live `docker ps` published ports, then record the choice in `.dck.json`. Reserved and never assigned to apps: `8000/8002` (canvas), `5432/3306/6379` (infra).
- Admin credentials are never committed. Templates carry placeholders; real values go into per-project `.env` (gitignored) and/or `/settings/secrets` (auto-attached as `LookupSecret` on conversation start).
- The `web-generator` `SKILL.md` (lives in `workspace/.agents/skills`, rewritten from the old React+Vite+FastAPI template) must be rewritten to this standard as a wrapper: reference built-in `frontend-design` (layout/styling), `docker` (containerization), and `vercel` (preview deploys when needed) instead of duplicating their guidance.
- Add a `dashboard-generator` skill only as extension-scaffolding guidance (manifest v1 + ESM bundle per `canvas-extension-api`); dashboards ship through `/apps`, not compose.

## 3b. Built-in reuse audit (do not rebuild)

- Skills catalog (`@openhands/extensions/skills`, 65 entries, 12 default-on incl. `docker`, `frontend-design`, `canvas-extension-api`, `openhands-automation`): reuse `frontend-design` + `docker` for webgen; `research-brief` (setup `/research-brief:setup`, needs Tavily + Notion MCP) + `news-digest` (setup `/news-digest:setup`, no credentials, RSS/Atom) for research; `jupyter`/`notion`/`evidence-based-citations` for analytics write-ups; `prd`/`agent-creator` for specs. DCK skills stay thin wrappers with triggers.
- Automations catalog (22 entries): reuse `research-brief-writer`, `news-digest`, plus standup/retrospective/triage families where they fit. No builtin PowerBI/dashboard-scheduled entry exists — that gap is genuinely custom (publish DCK templates for `deploy`/`rebuild` + recurring reports instead of bespoke scheduler UI).
- MCP marketplace (79 entries, no Postgres/PowerBI): nearest DB entries are `neon`/`supabase`/`mongodb`/`redis`/`clickhouse`; search entries include installable-local `tavily` (stdio `tavily-mcp` + `TAVILY_API_KEY`) and `brave-search`. Register custom Postgres read-only + Tavily/Brave via `routes/mcp.tsx` → `CustomServerEditor`; stdio probing is unavailable on cloud, but DCK deploys local-backend so this is fine.
- Plugins (`routes/skills-plugins.tsx`, marketplace runtime from agent-server) and Canvas Extensions (`routes/canvas-extensions.tsx`, ESM + Sidecar): both local-backend-only. Not used for DCK module delivery (decision: standalone compose), but remain available for agent capabilities.

## 4. PostgreSQL-only for OpenHands

Current SQLite defaults to remove (fail fast instead):

- `docker/entrypoint.sh:336-341` — `AUTOMATION_DB_URL` fallback to `sqlite+aiosqlite:///.../automation/automations.db`
- `scripts/dev-with-automation.mjs:1048` — same fallback for dev
- `scripts/dev-static.mjs:371` — same fallback for static dev
- `helm/agent-canvas/values.yaml:139` — `automationDbUrl: ""` means SQLite
- `config/defaults.json:26` — `paths.automationDb` kept only as legacy hint in error text, not an active default

New behavior:

- Entrypoint + both dev launchers exit non-zero with a actionable message when `AUTOMATION_DB_URL` is empty (expected format `postgresql+asyncpg://user:pass@host:5432/dck_agentic`).
- `docker-compose.yml` (repo root) must supply `AUTOMATION_DB_URL` pointing at a dedicated database (e.g. `dck_agentic`, created once with the admin role) reachable via the shared `proxy` network (service hostname, not `localhost`, from inside the container). Local `npm run dev` uses the host-reachable equivalent (`localhost:5432`).
- Verify `asyncpg` driver availability in the automation image on first run; do not assume.
- Delete legacy SQLite files at implementation time: `~/.openhands/automation/automations.db`, `.tmp/automation/`, plus the old `dck-agentic/openhands/config/` tree (removed with the layout consolidation). No migration (unused).
- Explicit non-goal: agent-server's own conversation/event store defaults belong to `software-agent-sdk` and are not changed here.
- Fresh PostgreSQL databases need the automation schema applied once: the backend auto-migrates SQLite only. Run `scripts/migrate-automation-db.sh` with `AUTOMATION_DB_URL` set (idempotent; installs `pg8000` in the target container, runs the bundled alembic `head`). Verified against `openhands-automation==1.15.1`.

## 5. Branding (minimal, presentational-only)

Brand: **DCK Agentic** (DCK Media & Business Consulting — "Strategy at core, formula as crown"; gold crown mark on dark). English-only per locked decision #2.

Done:
- `src/root.tsx` document title + description → driven by `PRODUCT_NAME` / `PRODUCT_TAGLINE` (no hardcoded literals).
- `src/hooks/use-app-title.ts` `APP_TITLE` → `PRODUCT_NAME`, so the browser tab title stays `DCK Agentic` (and `… | DCK Agentic` inside conversations) instead of leaking `OpenHands`.
- `public/favicon.svg` → DCK mark; `public/site.webmanifest` `name`/`short_name` → `DCK Agentic`/`DCK`.
- `src/assets/branding/dck-mark.svg` (navy rounded-square gold crown); the sidebar rail logo (`openhands-logo-button.tsx`) renders this mark in both collapsed and expanded states, adding the `PRODUCT_NAME` wordmark beside it when expanded so the mark's shape/position never jumps on toggle. `public/favicon.svg` and the portal login page use the same crown mark. Component name/testid/import binding kept for merge-safety. (`dck-logo.svg` — the older crown+wordmark stack — is retained in the repo but no longer referenced by the sidebar.)
- `electron/loading.html` splash `<title>`/`<h1>`/tagline → `DCK Agentic` + `PRODUCT_TAGLINE` copy (the "OpenHands agent server" first-launch hint stays — it names the actual backend binary).
- `src/constants/branding.ts` → `PRODUCT_NAME`/`PRODUCT_SHORT_NAME`/`PRODUCT_TAGLINE`, now the single source of truth consumed by `root.tsx`, `use-app-title.ts`, and their tests.
- Product-facing i18n values rebranded (English in all locales, keys added to `IDENTICAL_VALUE_ALLOWLIST`): `BRANDING$OPENHANDS_LOGO`, `AUTH$LOGGING_BACK_IN`, `HOME$OPENHANDS_DESCRIPTION`. Regenerated via `npm run make-i18n`; `check-translation-completeness` passes.

Deliberately NOT rebranded (technical identifiers / agent identity, changing them breaks function or merges):
- Agent kind `"openhands"` and the OpenHands agent option in `choose-agent-step.tsx` / `AgentBrandIcon` (OpenHands stays a selectable agent, not the product name).
- Backend identity logo (`backend-form-modal.tsx` `openhands-logo-white.svg`) — identifies the OpenHands backend, not the product.
- i18n namespace `"openhands"`, `@openhands/*` packages/imports, `openhands.dev` URLs, model-name formatting, telemetry event names, test fixtures/type-guards.
- Replacement PWA raster icons (`favicon-*.png`, `apple-touch-icon.png`, `android-chrome-*.png`, `mstile-150x150.png`, `safari-pinned-tab.svg`) still carry the old mark — swap when final raster art is available.
- No theme/sidebar restructuring in this phase.

## 6. Homepage composition (reuse first)

Keep the existing stack and add the DCK layer on top:

- Keep: `HomeChatLauncher`, `RecommendedAutomationsLauncher` (`variant="rail"`), `PinnedAutomationsDashboard`, `RunningAutomationsList` (`src/components/features/home/home-chat-launcher.tsx:300-304`, `src/routes/home.tsx`).
- Add: `src/dck/modules.ts` static registry (5 modules: id, workspace path, skill name, description, prompt template) + module card grid above the launcher.
- Add: per-module project list — `webgen` via `useWorkspaceFiles` (convention from §3, no new backend); `dashboards` via the built-in extensions runtime (`useCanvasExtensions` / `useCanvasExtensionsRuntime`, deep links to `/extensions/<name>/...`).
- Add: recent block composed from existing sources — `usePaginatedConversations` (recent chats) + latest automation runs (recent jobs) + workspace mtimes (recently touched projects). No new heavy queries.

Reused built-ins instead of new builds: `/automations*` routes for schedules/history, `/skills` + per-conversation skill picker, Files + `/vscode` tabs for `.env`/code editing.

Custom MCP servers to register at runtime via `/mcp` → Add custom server (local backend; stdio probing is unavailable on cloud, which DCK does not use):

- Postgres read-only: stdio command `npx -y @modelcontextprotocol/server-postgres@0.6.2`, connection URL stored in `/settings/secrets` and passed as the server's env/args, restricted to `SELECT`-only role where possible. Neither the 79-entry marketplace catalog nor the deprecated entries include self-hosted Postgres — custom is the only path.
- Search: Tavily `npx -y tavily-mcp` with `TAVILY_API_KEY` (required by `research-brief`), optionally Brave Search as fallback. Both are installable-local catalog entries.

Secrets convention: per-app `DATABASE_URL`/`REDIS_URL` and integration keys live in `/settings/secrets` (auto-attached as `LookupSecret` on conversation start) with gitignored per-project `.env` as the file-side copy. Templates (`.env.example`, skill docs) carry placeholders only, never real credentials.

## 7. New flows

### F-A. Scaffold a new webgen app

1. User opens DCK home → `webgen` card → `New project` → enters app name + toggles (needs DB? needs auth?).
2. Conversation starts with `workingDir=/projects/webgen`, skill `web-generator` active, prompt prefilled from module template (stack, port rule, external DB convention).
3. Agent scans ports (`docker ps` + compose files), picks first free ≥ 3000, scaffolds `webgen/<app>/` per §3, writes `.dck.json` + `.env.example`, asks operator for/uses admin URL to `CREATE DATABASE dck_<app>` when DB requested, writes gitignored `.env`.
4. Agent runs `docker compose up -d --build`, checks `docker compose ps` + endpoint health (`GET /`), reports `localhost:<port>`.
5. Card now lists the app with file-based status; `localhost:<port>` link recorded in `.dck.json`/README.

### F-B. Continue development

1. From module card → project row → `Continue in conversation`.
2. For `webgen`: opens/navigates to a conversation scoped to `workingDir=/projects/webgen/<app>`, relevant skill active, context preloaded (port, DB name, last status).
3. For `dashboards`: navigates to the extension page under `/extensions/<name>/...` (`src/routes/canvas-extension-page.tsx`); development/iteration happens via the extension source + reinstall through `/apps`.
4. All code/file/terminal/browser work happens in the existing conversation UI (Files, Terminal, VSCode tabs). Homepage needs no code viewer.

### F-C. Deploy / rebuild / stop / delete / env update

1. Card actions are webgen-only shortcuts that send canonical instructions into the project conversation (or a linked automation run), e.g. `docker compose up -d --build`, `docker compose logs -n 50 app`, `docker compose down`, `docker compose down -v` (with explicit confirm for `-v`).
2. Recommended: back `deploy`/`rebuild` and recurring jobs with automation templates so they get schedules + run history in the existing Automations UI (`/automations`, pinned dashboard, running list). Dashboard updates ship as extension reinstall/enable via `/apps`, not compose rebuilds.
3. `Env/config` opens the project's `.env` via Files/VSCode or the shared secret in `/settings/secrets` — no custom env editor.

### F-D. Recurring research / analytics

1. Operator creates scheduled automations (daily trend scan → `research/`, weekly EDA → `analytics/`) from templates.
2. Runs write dated artifacts (`research/YYYY-MM-DD_<topic>_report.md`, `analytics/<name>.py` + `analytics/charts/`).
3. Homepage recent blocks surface latest automation runs + newest artifacts without custom scheduler UI.

## 8. Implementation phases

- **F1 — Postgres-only fail-fast:** entrypoint, both dev launchers, helm values/docs, compose wiring, SQLite deletion, first-run `asyncpg` verification.
- **F2 — Minimal branding:** title, favicon, home header copy + i18n regeneration + completeness check.
- **F3 — Module registry + homepage cards:** `src/dck/modules.ts`, card grid, project lists via `useWorkspaceFiles`, deep links into conversations. Opening a module card seeds a per-module opening prompt as the new conversation's `query` (→ `initial_message`); each prompt contains a trigger keyword from the module's workspace skill so the DCK skill auto-activates on the first turn. Opening an existing conversation never injects a prompt. No skill id or prompt is sent as a conversation-creation parameter (skills activate from triggers, not from create payloads).
- **F4 — Webgen standard + dashboards as extensions + automation templates:** DONE in `dck/workspace/.agents/skills` (`web-generator` rewritten as `frontend-design`+`docker` wrapper with junk-free and secrets rules; `dashboard-generator` skill added; `social-research` rewrapped over `research-brief`/`news-digest`; `data-analytics` extended with MCP + scheduling notes). Deploy/rebuild and recurring jobs are created as custom automations through the built-in setup flow (the published catalog cannot be extended from this fork).
- **F5 — MCP + secrets + recent:** recent block DONE in F3. MCP servers are runtime registrations (see §10); secrets convention DONE (Secret Manager as source of truth, `.env` generated at deploy).

## 9. Verification per phase

- `npm run lint`, `npm test`, `npm run build` (and `build:lib` if library surface touched).
- `npm run check-translation-completeness` after any copy change.
- Boot checks: missing `AUTOMATION_DB_URL` exits non-zero with guidance; set URL boots against `dck_agentic`.
- E2E spot checks: scaffold → `docker compose ps` healthy → card lists app → continue-in-conversation lands in scoped dir → rebuild automation run appears in Automations UI.
- Keep `dev`-only diff small and merge upstream selectively.

## 10. Access model (mandatory key auth, internet-facing)

- Auth is **mandatory in every environment** and defaults to the username/password **login portal**. `docker-compose.yml` sets `AGENT_CANVAS_PORTAL_AUTH` (store on the persisted volume); the entrypoint runs the static server with `--portal-auth` and injects the internal session key only to logged-in users. Dev mirrors this: `npm run dev` runs with `--portal` (gate on the ingress), creating the admin at `/setup` on first run. Legacy shared-key modes remain available (`AGENT_CANVAS_PUBLIC` / `npm run dev:public` for the API-key entry screen; `npm run dev:insecure` for the no-login quick mode).
- Portal credentials are per-user accounts (first-run admin can create more). The agent-server still authenticates its own `/api` with a session key, but that key is now backend-internal (auto-generated, injected behind the login gate), not the user-facing credential. The legacy shared-key model (`OH_SESSION_API_KEYS_0`, `_1`, …) still works when portal auth is disabled: each key grants full access with no per-user identity.
- Internet-facing requires a **TLS-terminating reverse proxy** in front — the API key travels from the browser, so plain HTTP must never be exposed. The container listens on `::`; publish/proxy accordingly and terminate HTTPS at the proxy.
- Login-page integration: `ApiKeyEntryScreen` (`src/components/features/backends/api-key-entry-screen.tsx`) renders whenever the session key is missing — which, in public mode, is always until the user pastes a valid key. The same screen also recovers from a 401 from `/server_info` (rotated/invalid key).
- `AGENT_CANVAS_ALLOW_LAN_SESSION_KEY` is ignored when `AGENT_CANVAS_PUBLIC=true` (the key is never injected). It remains available only for a deliberately loopback-only, no-login local deployment — not used by DCK.
- Secrets maximization: the built-in Secret Manager (`/settings/secrets`, server-side encrypted via `OH_SECRET_KEY`) is the single source of truth for all integration keys and per-app URLs. Every conversation receives all secrets automatically as server-resolved `LookupSecret` attachments (`POST /api/conversations` `request.secrets`; resolved by agent-server at spawn, never in the browser). Agents materialize gitignored `.env` files from them at deploy time and never log values. Name pattern `[a-zA-Z][a-zA-Z0-9_]{0,63}`. Tavily lives in the MCP server config; per-app `DATABASE_URL_*`/`REDIS_URL` live in the manager. No `.env` sync code exists or is needed.
- Junk-free webgen: only `webgen/<app>/` source may touch the host volume; `.dockerignore` mandatory; no host toolchains; temp files die in containers; delete means `down -v --rmi local`; operator-level `image`/`builder prune` stays on a schedule. Enforced by the `web-generator` skill (§7 there) and `workspace/AGENTS.md`.

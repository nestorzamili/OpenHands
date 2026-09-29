# DCK Agentic — Customization Plan (fork `dev`)

Status: **F1 (Postgres-only fail-fast) + F2 (minimal branding) + F3 (module registry + homepage cards + recent) implemented on `dev`; F4–F5 pending**. This doc is the build reference for turning this OpenHands Agent Canvas fork into the DCK Agentic core.

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
| Deployment compose, workspace content, DCK skills, per-app projects | `dck-agentic` | `openhands/docker-compose.yml`, `workspace/`, `.agents/skills/` |
| Agent Server conversation/event storage defaults | `software-agent-sdk` (upstream) | Out of scope here; this repo only passes env through and documents |
| Postgres cluster itself | `surrounding/postgresql.yaml` | Existing `postgres:17` on external `proxy` network; operator-owned credentials |

## 2. Module bases

| Module | Runtime | Docker | Detected project unit | Outputs |
|---|---|---|---|---|
| `webgen/` | Next.js fullstack (App Router + API routes), shadcn, Tailwind; Prisma + better-auth optional | Required, one compose stack per app | `webgen/<app>/` containing `docker-compose.yml` + `.dck.json` | Runnable app on `localhost:<port>` |
| `dashboards/` | Canvas Extension (`/apps`): ESM bundle + manifest v1, pages registered in sidebar; Sidecar only for heavy compute | No compose stack (lifecycle = install/enable/uninstall via `/apps` UI) | Extension name + `contributes.pages[]` (`src/types/canvas-extension.ts`) | Embedded dashboard pages inside Canvas |
| `research/` | Built-in `research-brief` + `news-digest` skills/automations; DCK `social-research` skill is a thin wrapper (needs `TAVILY_API_KEY`) | No | `research/YYYY-MM-DD_<topic>_report.md` | Markdown report with sources + timestamps |
| `powerbi/` | Agent only (Star Schema, DAX, Power Query M, TMDL/`.bim`) | No | `powerbi/<model>/` | Measures, M scripts, model snippets |
| `analytics/` | Python (Pandas/Polars/DuckDB/SQLAlchemy) + SQL to host Postgres, charts to PNG/SVG | No (one-shot runs) | `analytics/<analysis>.py`, `analytics/charts/` | Scripts, query results, charts, insight write-up |

Cards for `research`/`powerbi`/`analytics` show artifact lists + `Continue in conversation`. Only `webgen` gets Docker lifecycle actions (`deploy`/`rebuild`/`stop`/`delete`/env). Dashboards are managed through the built-in `/apps` install/enable/uninstall flow, not card actions.

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
- The `web-generator` `SKILL.md` (lives in `dck-agentic`, currently the old React+Vite+FastAPI template) must be rewritten to this standard as a wrapper: reference built-in `frontend-design` (layout/styling), `docker` (containerization), and `vercel` (preview deploys when needed) instead of duplicating their guidance.
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

- Entrypoint + both dev launchers exit non-zero with a actionable message when `AUTOMATION_DB_URL` is empty (expected format `postgresql+asyncpg://user:pass@host:5432/dck_automation`).
- `dck-agentic/openhands/docker-compose.yml` must supply `AUTOMATION_DB_URL` pointing at a dedicated database (e.g. `dck_automation`, created once with the admin role) reachable via the shared `proxy` network (service hostname, not `localhost`, from inside the container). Local `npm run dev` uses the host-reachable equivalent (`localhost:5432`).
- Verify `asyncpg` driver availability in the automation image on first run; do not assume.
- Delete legacy SQLite files at implementation time: `~/.openhands/automation/automations.db`, `.tmp/automation/`, `dck-agentic/openhands/config/automation/`. No migration (unused).
- Explicit non-goal: agent-server's own conversation/event store defaults belong to `software-agent-sdk` and are not changed here.

## 5. Branding (minimal)

- `src/root.tsx:229` title `OpenHands` → `DCK Agentic`.
- `public/favicon.svg` → DCK mark.
- `src/components/features/home/home-header/home-header-title.tsx` + `HOME$*` keys in `src/i18n/translation.json`, regenerated via `npm run make-i18n`; run `npm run check-translation-completeness`.
- No theme/sidebar restructuring in this phase.

## 6. Homepage composition (reuse first)

Keep the existing stack and add the DCK layer on top:

- Keep: `HomeChatLauncher`, `RecommendedAutomationsLauncher` (`variant="rail"`), `PinnedAutomationsDashboard`, `RunningAutomationsList` (`src/components/features/home/home-chat-launcher.tsx:300-304`, `src/routes/home.tsx`).
- Add: `src/dck/modules.ts` static registry (5 modules: id, workspace path, skill name, description, prompt template) + module card grid above the launcher.
- Add: per-module project list — `webgen` via `useWorkspaceFiles` (convention from §3, no new backend); `dashboards` via the built-in extensions runtime (`useCanvasExtensions` / `useCanvasExtensionsRuntime`, deep links to `/extensions/<name>/...`).
- Add: recent block composed from existing sources — `usePaginatedConversations` (recent chats) + latest automation runs (recent jobs) + workspace mtimes (recently touched projects). No new heavy queries.

Reused built-ins instead of new builds: `/automations*` routes for schedules/history, `/skills` + per-conversation skill picker, `/mcp` custom servers (Postgres read-only, web search), `/settings/secrets` for URLs/keys, Files + `/vscode` tabs for `.env`/code editing.

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
- **F3 — Module registry + homepage cards:** `src/dck/modules.ts`, card grid, project lists via `useWorkspaceFiles`, deep links into conversations.
- **F4 — Webgen standard + dashboards as extensions + automation templates:** rewrite `web-generator` skill in `dck-agentic` as wrapper over `frontend-design`+`docker`, ship dashboards as Canvas Extensions per `canvas-extension-api` (manifest v1 + ESM bundle, Sidecar only when needed), publish `deploy`/`rebuild`/recurring-report templates (research reuses `research-brief-writer`/`news-digest`).
- **F5 — MCP + secrets + recent:** register custom Postgres read-only + Tavily/Brave MCP servers (needs `TAVILY_API_KEY`), document secrets convention, compose recent block.

## 9. Verification per phase

- `npm run lint`, `npm test`, `npm run build` (and `build:lib` if library surface touched).
- `npm run check-translation-completeness` after any copy change.
- Boot checks: missing `AUTOMATION_DB_URL` exits non-zero with guidance; set URL boots against `dck_automation`.
- E2E spot checks: scaffold → `docker compose ps` healthy → card lists app → continue-in-conversation lands in scoped dir → rebuild automation run appears in Automations UI.
- Keep `dev`-only diff small and merge upstream selectively.

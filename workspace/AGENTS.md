# DCK Agentic — Multi-Agent Workspace Guidelines

Welcome to the internal **DCK Agentic** workspace. This repository is organized into dedicated domain modules:

- `webgen/` — Full Stack Next.js web applications, landing pages, and prototypes (single-service Docker Compose).
- `research/` — Market research reports, social media trend analysis, and competitor monitoring.
- `analytics/` — Exploratory data analysis, SQL queries against host PostgreSQL, visual charts, and Power BI / DAX / Power Query modeling.
- `content/` — Marketing and social content: captions and scripts, content calendars, and SEO blog copy.

Additional conversation modules can be created, edited, and removed from the Canvas home (Modules → Manage modules); their definitions live in `.dck/modules.json`. Canvas Extension apps are installed through the built-in **Customize → Apps** flow (`/apps`) — there is no `dashboards` module.

---

## Zero Host Pollution & Production Standards (MANDATORY)

1. **Fullstack Containerization**:
   - For all web apps and backends generated in `webgen/`, always build and run them as single-service Next.js **Docker Compose** applications per the `web-generator` skill.
   - Do NOT run bare development processes or install packages directly on the host VM — no `npm`, `pip`, `node`, or `prisma` outside containers.
   - All ephemeral files, databases, and dependencies (`node_modules`, `.next`, `site-packages`) must stay inside Docker containers or image layers. Every app ships a `.dockerignore`.
   - App runtime secrets are managed per project through the Web Generator **Environment** UI and stored encrypted by the host WebGen control service. They are separate from Agent Secret Manager and are never available through `LookupSecret`; do not request, look up, print, log, or place them in prompts or workspace files. The host injects them only into the app container during an explicit lifecycle action. `.env` may contain only non-secret defaults and `APP_BASE_PATH`.
   - Honor user-requested deploy/start/restart/run/test actions autonomously; chat is an authorized entry point, not a reason to refuse or send the user to click controls. Use the authenticated `webgen_lifecycle` tool for the current project's lifecycle/status through the host control service (see the `web-generator` skill). Trusted internal agents already have owner authorization for read-write Docker access; do not request that permission again. Check actual capabilities and report unavailable routes honestly, distinguishing temporary dev preview from production. Never bypass Environment injection with raw Compose, inspect secret container environments, or write host nginx configuration. Delete uses the explicit UI action after application data is backed up. Verify `git status` shows only intended files after every task.
2. **Network & Database Connectivity**:
   - The dedicated DCK PostgreSQL cluster is the `postgres` service on the shared `dck` Docker network (not host-published). Webgen apps join the `dck` network (`external: true, name: dck`) and connect via the service name `postgres:5432` (one database per app, `dck_<app>`).
   - Other host services (e.g. the existing `redis-shared` on port 6379) are reachable from within containers via `host.docker.internal:<port>` — add `extra_hosts: ["host.docker.internal:host-gateway"]` to the app service when Redis is needed.
3. **Quality & Verification**:
   - Scaffolding does not deploy. After explicit Deploy, verify runtime status and the app under the Canvas origin at `/preview/<slug>`, including nested routes, assets, and APIs. Only Publish selects a subdomain; Unpublish restores preview. Keep one active deployment mode.
   - For all user-facing `webgen/` output (UI, layout, copy, code), apply the vendored `antislop` skills in `.agents/skills/` and pass anti-slop's Delivery Gate (PASS/FAIL report) before reporting a scaffold or deploy as done. See the `web-generator` skill §0.
   - For data scripts: ensure scripts run cleanly and output visual artifacts directly into the appropriate folder.
   - For research & BI: structure reports cleanly using GitHub-flavored Markdown.

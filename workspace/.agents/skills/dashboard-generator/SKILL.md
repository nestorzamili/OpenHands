---
name: dashboard-generator
description: Specialist for building embedded analytics dashboards as Canvas Extensions (Apps for Agent Canvas) for DCK Agentic. Use when the user asks to create, extend, validate, or install a dashboard in dashboards/.
triggers:
  - dashboard
  - dashboards
  - analytics dashboard
  - reporting ui
  - kpi
  - canvas app
---

# Dashboard Generator — Canvas Extensions Standard

Build on top of the built-in `canvas-extension-api` skill (manifest schema 1, host API 1, one self-contained browser ESM entrypoint exporting `activate(host)`). This skill defines the DCK packaging conventions it must follow here.

## 1. Package Layout (mandatory)

One independent package per dashboard inside `dashboards/<name>/`:

```text
dashboards/<name>/
├── canvas-extension.json
├── entrypoint (extension.js source or src/ + build)
├── README.md
└── package tooling as needed
```

Keep manifest names globally distinct. One declared page by default; add pages only when the dashboard genuinely needs routes. Never introduce a shared runtime or monorepo foundation across dashboards.

## 2. Architecture Decision First

Default to a browser-only app reading data through the host API and the agent-server proxy. Choose a Sidecar-backed app only when the dashboard needs scheduled computation or access the browser context cannot provide; the app page itself must then guide Sidecar setup after install. Never serve dashboards as standalone Docker Compose stacks on `300x` ports — that pattern is reserved for `webgen/` customer apps.

## 3. Validation and Install

Run the reusable static gate from `canvas-extension-api` before and after the package's own checks, then install through the portal's Apps page (`/apps`) and verify the page mounts via `/extensions/<name>/...`. A dashboard is done only when it renders inside the portal, not when its bundle merely builds.

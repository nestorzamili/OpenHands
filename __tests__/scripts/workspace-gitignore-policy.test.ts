// @vitest-environment node

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Policy: generated per-module DCK project content (webgen apps, research
 * reports, content artifacts, analytics scripts, dashboard scaffolds) must be
 * git-ignored so each project keeps its own commits/repo and never pollutes
 * this repo's history. The shared DCK infrastructure we DO track — the module
 * `.gitkeep` placeholders, the skills under `workspace/.agents`, and
 * `workspace/AGENTS.md` — must stay tracked.
 *
 * We assert the real behavior via `git check-ignore` against the committed
 * `.gitignore` rather than re-implementing glob matching.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function isIgnored(relativePath: string): boolean {
  try {
    execFileSync("git", ["check-ignore", "-q", "--", relativePath], {
      cwd: repoRoot,
      stdio: "ignore",
    });
    return true;
  } catch (error) {
    const status = (error as { status?: number }).status;
    // `git check-ignore -q` exits 1 when the path is NOT ignored.
    if (status === 1) return false;
    throw error;
  }
}

describe("workspace .gitignore policy", () => {
  const generatedProjectPaths = [
    "workspace/webgen/dck-landing/package.json",
    "workspace/webgen/shop/src/index.ts",
    "workspace/research/2026-01-01_trends_report.md",
    "workspace/analytics/eda.py",
    "workspace/content/2026-01-01_ig_captions.md",
    "workspace/dashboards/foo/manifest.json",
  ];

  it.each(generatedProjectPaths)("ignores generated project path %s", (p) => {
    expect(isIgnored(p)).toBe(true);
  });

  const trackedInfraPaths = [
    "workspace/.agents/skills/web-generator/SKILL.md",
    "workspace/.agents/skills/data-analytics/SKILL.md",
    "workspace/AGENTS.md",
    "workspace/webgen/.gitkeep",
    "workspace/research/.gitkeep",
    "workspace/content/.gitkeep",
    "workspace/analytics/.gitkeep",
    "workspace/dashboards/.gitkeep",
  ];

  it.each(trackedInfraPaths)("keeps DCK infrastructure %s tracked", (p) => {
    expect(isIgnored(p)).toBe(false);
  });
});

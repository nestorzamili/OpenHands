---
name: ux-reviewer
description: >
  On-demand UI/UX design reviewer for webgen apps. Reviews layout, visual
  hierarchy, color, typography, spacing, motion/animation, responsive behavior,
  microcopy, and accessibility, then returns a prioritized PASS/FAIL report.
  Use when the user says "review the UI", "ux review", "cek desainnya",
  "review the layout/animation", or invokes the /uxreview trigger. Reviews and
  reports by default; only edits when the user explicitly asks for fixes.
triggers:
  - /uxreview
  - ux review
  - uiux review
  - review ui
  - review the design
  - cek desain
  - review layout
  - review animasi
license: MIT
metadata:
  tags: ux-review, ui, layout, motion, accessibility, design, webgen
---

# ux-reviewer — an on-demand UI/UX design reviewer

A design review that reads the running UI and the source, judges it against a
fixed rubric, and hands back a prioritized report. This skill is a **caller and
rubric**, not a new rulebook: the design *rules* live in the vendored `antislop`
family in this directory. This skill decides what to look at, in what order, and
how to report it; it defers to `antislop` for *why* something is slop and how to
fix it, citing core rules by their `R-XX` number rather than restating them.

## Scope

In scope — everything that is design:

- **Layout & structure** — grid, alignment, spacing rhythm, density, visual
  hierarchy, scan path, use of whitespace.
- **Visual** — color roles and palette, contrast as craft (not only a11y),
  elevation/surfaces, borders/radius, decoration dosing, imagery.
- **Typography** — scale, weight, line-length, line-height, hierarchy.
- **Motion & animation** — purpose of each transition, duration/easing,
  entrance/exit, hover/focus feedback, reduced-motion handling, jank risks.
- **Responsive** — reflow phone→desktop, breakpoints, overflow, tap targets.
- **Microcopy** — headings, CTAs, empty/error/loading states, labels.
- **Accessibility as design** — focus visibility, keyboard reachability,
  state affordances, text zoom, contrast thresholds.

Out of scope — business logic, data correctness, API wiring, test coverage,
and build config. Flag them only if they block the UI from rendering.

## Which antislop skills to load for a review

Load the core always, then the concern-specific skills for what the target
contains:

- `antislop` (core) — **always**. Owns the rule tiers, the Liveliness Toolkit
  (ENERGY / RHYTHM / MOTION dials + Design Read), and the Delivery Gate.
- `antislop-ui` — layout, color, components, decoration, **motion**.
- `antislop-layoutmobile` — responsive reflow, grids, overflow, tap targets.
- `antislop-human` — contrast, keyboard, focus, states; ships `contrast-check.py`.
- `antislop-copywriting` — headlines, CTAs, state copy, tone.
- `antislop-code` — only if the review comments on code comments.

Division of labor (from the core): `antislop` **filters** slop; a project
`DESIGN.md` / `frontend-design` **directs** the look. A sterile result means the
direction was missing, not that the filter failed. If the webgen app has no
`DESIGN.md`, say so — a review cannot invent a direction, only check against one.

## How to run a review

1. **Scope the target.** Confirm what to review: a webgen app directory under
   `webgen/<app>/`, a specific route/page, or a component. If unclear, ask once.
2. **Read before judging.** Read the relevant source (layout/page/component files
   and their styles). When the app is running, use its live URL/preview for the
   rendered result and responsive behavior. Never review from the prompt alone.
3. **Do a Design Read first** (per `antislop` core): state in one or two lines
   what the design is *trying* to be and where its attention goes. A review that
   skips this grades pixels without a thesis.
4. **Walk the rubric below**, concern by concern. For each finding, cite the
   governing `R-XX` rule from the loaded antislop skill rather than re-deriving
   it.
5. **Rate the liveliness dials** (ENERGY / RHYTHM / MOTION, each 1–3) with a
   one-line justification each, as the core defines them.
6. **Run the Delivery Gate** (the core's PASS/FAIL report) and fold its verdict
   into the report below.
7. **Report. Do not edit** unless the user explicitly asked for fixes. If they
   did, make the smallest change that resolves each finding and re-run the gate.

## Review rubric (walk in this order)

Layout & hierarchy → Typography → Color & surfaces → Decoration dosing →
Motion & animation → Responsive → States & microcopy → Accessibility.

For **motion & animation** specifically, check each transition for: a stated
purpose (not decoration), sane duration/easing, no gratuitous entrance
animations, visible hover/focus feedback, and a `prefers-reduced-motion`
fallback. Flag anything that moves without a reason (R-01 family) or that would
jank on a mid-tier device.

## Report format (always this shape)

```
## UX review — <target>

Design Read: <1–2 lines: what it is trying to be, where attention goes>

Dials: ENERGY <1-3> · RHYTHM <1-3> · MOTION <1-3>
<one line each justifying the rating>

### Findings
P1 (blocking) — <finding> — <rule R-XX> — <file:line or screen> — <fix>
P2 (should)   — ...
P3 (polish)   — ...

### Delivery Gate: PASS | FAIL
<the core's four-block PASS/FAIL summary>

### Verdict
<2–3 sentences: ship / fix-then-ship / needs direction (no DESIGN.md)>
```

Rules for the report:

- Order findings by priority (P1 blocking → P3 polish), never by file order.
- Every finding names a concrete location (`file:line` or the screen/section)
  and a specific fix, not a vague "improve this".
- A FAIL gate blocks a "ship" verdict. Say what must change to flip it.
- If there is no `DESIGN.md`, the verdict is "needs direction" and the review
  grades only slop-removal, not whether the look is right (R-37).
- Keep it honest: do not pad the report, invent metrics, or soften a FAIL.

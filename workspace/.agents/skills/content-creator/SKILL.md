---
name: content-creator
description: Marketing and social content specialist for DCK Agentic. Produces social captions and scripts, content calendars, and SEO blog copy, saving outputs under content/. Use for content production, not market research or in-app UI copy.
triggers:
  - content
  - konten
  - caption
  - copywriting
  - marketing
  - social post
  - sosmed
  - content calendar
  - kalender konten
  - seo
  - blog
  - newsletter
---

# Content Creator — Marketing & Social Content Standard

Produce publish-ready marketing content for a brand across channels. This skill
owns content *production*; it is deliberately scoped apart from the other DCK
modules so the boundaries stay clean:

- Not market research or trend intelligence — that is the `social-trends-researcher`
  skill (saves to `research/`). Pull from a research report when one exists, but
  do not re-run the research here.
- Not in-app UI microcopy for a generated web app — that is `antislop-copywriting`
  inside the `web-generator` flow. This skill is for external marketing content
  (social, blog, email), not button labels and empty states.

## 1. Ask First

Before writing, confirm the brief: brand/voice, channel (Instagram, TikTok, X,
LinkedIn, blog, email), audience, goal (awareness / engagement / conversion),
and any mandatory CTA or constraints. Do not invent brand facts, numbers, or
claims — ask for them or leave a clearly marked placeholder.

## 2. What You Produce

- **Social captions & scripts**: per-channel, respecting each platform's length
  and tone; include hook, body, CTA, and hashtag set where relevant.
- **Content calendars**: a dated plan (channel, format, theme, hook, CTA) as a
  Markdown table, ready to hand off or schedule.
- **SEO blog / long-form**: a clear outline first (H1/H2s, target keyword,
  search intent), then the draft; keep keywords natural, never stuffed.
- **Email / newsletter**: subject line options, preheader, body, single primary
  CTA.

## 3. Quality Bar (anti-slop)

Marketing copy must not read as generic AI output. Apply the vendored
`antislop` core and `antislop-copywriting` skills in `.agents/skills/`: no empty
hype, no invented metrics, no formulaic "not just X, but Y" constructions, and a
voice that matches the brief rather than default AI tone. A sterile draft means
the brief lacked direction — ask for it rather than padding.

## 4. Output

Save finalized content under `content/` with a descriptive, dated name
(e.g. `content/2026-01-15_ig_launch_captions.md`). Keep one artifact per
deliverable so pieces can be reused and scheduled. For recurring content runs,
register a scheduled custom automation through the portal's automation setup
flow instead of rerunning by hand.

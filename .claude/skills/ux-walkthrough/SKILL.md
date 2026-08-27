---
name: ux-walkthrough
description: Repeatable, agent-driven UX audit of the running app. Drives the browser through the pages/flows in .claude/ux/flows.jsonc, grades each against .claude/ux/RUBRIC.md across viewports and themes (visibility, responsiveness, readability, usability, animations, loading, themes, colors, scaling, accessibility), and writes a ranked report. Use when the user asks to "review the UX", "run a UX walkthrough / audit", "check responsiveness/readability/loading", or validate a page or flow before shipping.
---

# UX Walkthrough

A repeatable process that points the browser at defined pages/flows and grades
the experience against a fixed rubric. The **rubric** (`.claude/ux/RUBRIC.md`)
and **manifest** (`.claude/ux/flows.jsonc`) are the source of truth — edit those
to change what's checked; don't hardcode flows here.

## Inputs / arguments

- No args → run the **whole** manifest.
- Arg = a flow `id` (or comma-separated ids) from `flows.jsonc` → run only those.
- Arg = a URL/path → audit that single page as an ad-hoc flow (all matrix
  viewports/themes, all rubric dimensions).

## Procedure

1. **Load the config.** Read `.claude/ux/flows.jsonc` and `.claude/ux/RUBRIC.md`.
   Resolve the effective flow list from the argument (above).

2. **Ensure the app is up.** Check `baseUrl` (default `http://localhost:3000`).
   - If nothing responds on the port, start the dev server the way this repo
     does — `DATABASE_URL=… npm run dev` — in the background, and wait for
     `curl -s -o /dev/null -w '%{http_code}' <baseUrl>` to return `200`.
   - Open the browser pane with `preview_start { url: baseUrl }`.
   - Note in the report whether this was a dev or production build (loading and
     animation behavior differ).

3. **Audit each flow.** For every selected flow, spawn a **`ux-reviewer`**
   subagent with a prompt containing `{ baseUrl, rubricPath, flow, matrix }`.
   - Run reviewers **sequentially**, not in parallel — they share one browser
     pane and would contend. (If the browser supports isolated tabs per agent in
     this session, you may parallelize; default to sequential for reliability.)
   - Each returns a JSON array of findings. Collect them all.

4. **Aggregate & rank.**
   - Merge findings; dedupe ones that repeat across viewports/themes into a
     single entry that lists where it occurs.
   - Sort by severity (`blocker` > `major` > `minor` > `nit`), then by dimension.
   - Compute a small scorecard: counts per dimension and per severity, and a
     per-flow pass/attention summary.

5. **Write the report** to `.claude/ux/reports/<YYYY-MM-DD-HHMM>.md`:
   - Header: date, build type, baseUrl, matrix, flows covered.
   - Scorecard table (dimensions × severity counts).
   - Findings grouped by severity, each with flow, page, viewport/theme,
     evidence, and recommendation.
   - A short "top fixes" list — the 3–5 highest-leverage changes.
   Then offer to publish the same content as an HTML scorecard **Artifact** for
   sharing, and to open a follow-up to fix the top findings.

6. **Report back** in chat: the scorecard, the top blockers/majors, and the
   report path. Do not claim a dimension passed that no reviewer actually
   exercised — if a flow was skipped or a check couldn't run, say so.

## Notes

- **Read-only.** This process observes; it never edits app code. Fixes are a
  separate step the user opts into.
- **Determinism.** Same manifest + same app state → comparable reports. Commit
  reports if you want a history to diff against.
- **Extending.** New page or flow → add an entry to `flows.jsonc`. New criterion
  → add it to `RUBRIC.md`. The skill and subagent pick up both automatically.
- The app is currently light-theme only; dark-theme findings are expected and
  should be reported under the `themes` dimension (usually `minor`/`major`),
  framed as "no dark support yet", not as breakage.

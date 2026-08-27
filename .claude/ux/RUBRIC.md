# UX Walkthrough Rubric

The fixed grading criteria for the `/ux-walkthrough` process. Every finding a
reviewer reports must map to exactly one **dimension** below and carry one
**severity**. Keep judgments concrete and evidence-backed (a screenshot, an
accessibility-tree excerpt, a console message, a measured value) — never a
vague "feels off."

## Severities

| Severity | Meaning | Examples |
| --- | --- | --- |
| `blocker` | Flow is broken or unusable for a real user. | Control off-screen and unreachable; text invisible on its background; page errors on load; body scrolls horizontally on mobile so content is cut off. |
| `major` | Works, but clearly hurts the experience. | Contrast below WCAG AA on body text; tap target far under 44px; no loading state so the page flashes empty; layout shift jumps the content after load. |
| `minor` | Noticeable rough edge, low user cost. | Slightly cramped spacing; inconsistent hover affordance; truncation with no tooltip. |
| `nit` | Polish / taste. | 1px misalignment; could use a subtle transition. |

A reviewer that finds nothing wrong in a dimension reports **no** finding for it
(don't invent issues to fill the rubric). "Pass" is the default.

## Dimensions

Each dimension lists what to check and the bar it must clear.

### 1. `visibility` — is everything meant to be seen actually seen?
- No element clipped, overlapped, or pushed off-screen at the target viewport.
- Sticky headers/toolbars don't cover content or the first row.
- Focused elements are not hidden behind other layers.

### 2. `responsiveness` — does the layout adapt to the viewport?
- **The page body never scrolls horizontally.** Wide content (tables, code,
  diagrams) scrolls inside its own container, not the page.
- Grids/cards reflow to the width; nothing is fixed-width past the viewport.
- Interactive targets are ≥ 44×44px on mobile (24px absolute floor).
- Toolbars/filter rows wrap instead of overflowing.

### 3. `readability` — can the text be read comfortably?
- Body text ≥ ~13px effective; nothing critical below 11px.
- Line length and line-height are comfortable; long values wrap or truncate
  with a way to recover the full value (tooltip / detail view).
- Monospace vs. prose used sensibly (ids/data mono, labels prose).

### 4. `usability` — can a user figure out and complete the task?
- Controls look interactive (affordance): buttons, links, sort headers, inputs.
- Every interactive element has a **visible focus state** and is keyboard
  reachable in a sensible tab order.
- Empty states, zero-result states, and disabled states are explained, not blank.
- **Error states** are human-readable and actionable, not a raw stack trace.
- Destructive/irreversible actions are clearly labeled (should be none in a
  read-only tool — flag any that appear).

### 5. `animations` — do transitions help rather than distract?
- State changes (hover, load-in, page change) have appropriate, quick
  (~120–250ms) transitions; nothing janky or slow.
- No infinite/attention-stealing motion.
- Honors `prefers-reduced-motion` (motion reduced/removed when set).

### 6. `loading` — what does the user see while data loads?
- A visible loading affordance (skeleton/spinner/text) — never a bare white gap.
- No **layout shift** when data arrives (reserve space).
- Stale-while-revalidate: navigating back to cached data is instant, not a
  re-flash of the loading state.
- Perceived latency is reasonable; slow calls are acknowledged.

### 7. `themes` — does the app respect the user's theme?
- If a dark theme exists: it's complete (no light-on-light / dark-on-dark),
  toggling works, and it persists.
- `prefers-color-scheme: dark` is honored, or its absence is a deliberate,
  documented single-theme choice (flag hardcoded colors that would break a
  future dark mode).
- The page paints its own background (doesn't borrow the host's).

### 8. `colors` — contrast and consistent meaning.
- Text/background contrast meets **WCAG AA (4.5:1 normal, 3:1 large)**.
- Color is not the *only* signal (state also has text/shape).
- Palette is consistent; accent/semantic colors (pk badge, links, true/false
  pills, error) mean the same thing everywhere.

### 9. `scaling` — holds up under stress.
- Browser zoom to 200% stays usable (no overlap, no lost controls).
- Tables with many columns and long cell values degrade gracefully.
- Very long strings, big numbers, deep JSON, and long lists don't break layout.

### 10. `accessibility` — semantics and assistive-tech basics.
- Landmarks present (`header`, `main`, `nav`); one `h1` per page.
- Data tables use real `th`/`scope`; sortable headers announce sort state
  (`aria-sort`).
- Inputs have labels; icon-only buttons have accessible names.
- Images/icons have alt text or are marked decorative.
- Color-independent focus indicator visible on keyboard nav.

## Finding shape

Reviewers return findings as objects with these fields:

```jsonc
{
  "dimension": "responsiveness",     // one of the 10 above
  "severity": "major",               // blocker | major | minor | nit
  "flow": "entity-list",             // flow id from flows.jsonc
  "page": "/entities/public.users",
  "viewport": "mobile",              // mobile | tablet | desktop
  "theme": "light",                  // light | dark
  "summary": "Filter row overflows the viewport instead of wrapping",
  "evidence": "At 375px the operator + value inputs push 40px past the right edge; body scrolls sideways.",
  "recommendation": "Let .filter-row wrap; stack the builder under the search box below ~480px."
}
```

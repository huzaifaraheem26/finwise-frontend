# FINWISE — Page Conversion Spec (read fully before editing)

You are converting ONE existing HTML page off Tailwind CSS onto the shared
plain-CSS design system. Follow this spec exactly.

## Hard rules
1. **Preserve ALL existing content, data, text, numbers, images, and inline
   `<script>` logic.** Do not invent or delete features. Every value, label,
   table row, chart, form field, and modal that exists must still exist.
2. **Remove ALL Tailwind.** Delete the `<script src="https://cdn.tailwindcss.com…">`
   tag, the `<script id="tailwind-config">…</script>` block, and every Tailwind
   utility class from the markup. No `class="flex gap-4 bg-primary …"` may remain.
   Do NOT reference any Tailwind color token names (primary, on-surface,
   surface-container-lowest, tertiary, secondary, error-container, etc.).
3. **No `@apply`, no inline `tailwind.config`, no CDN Tailwind anywhere.**
4. Keep the page's own real content scripts, but if any JS toggles Tailwind
   class strings (e.g. `classList.add('hidden')`, `'bg-primary'`, `'scale-95'`),
   rewire it to the shared classes / `.hidden` utility so behavior is identical.
   `.hidden` exists in theme.css. Prefer `data-*` hooks already supported by app.js
   (`data-modal-open`, `data-modal-close`, `data-dropdown`) where the page had
   equivalent behavior — but never remove working logic; adapt it.

## Required <head> (replace the old head guts, keep page-specific title)
```html
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>PAGE NAME — FINWISE</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap" rel="stylesheet"/>
<link href="assets/css/theme.css" rel="stylesheet"/>
```
Page-specific `@keyframes` or truly page-unique CSS may stay in a small `<style>`
block, but it must use the CSS variables from theme.css (var(--accent) etc.),
never Tailwind. Prefer shared classes first.

## App pages: shell is MANDATORY and IDENTICAL
Copy the sidebar + mobile-bar + topbar + footer VERBATIM from
`assets/partials.html`. Do not set `.active` by hand — app.js does it by URL.
Structure:
```
<body>
  <aside class="sidebar">…</aside>
  <div class="app-main">
    <div class="mobile-bar">…</div>
    <header class="topbar">…</header>
    <main class="page"> PAGE CONTENT </main>
    <footer class="footer">…</footer>
  </div>
  <div class="scrim" aria-hidden="true"></div>
  <script src="assets/js/app.js"></script>
</body>
```
End every page with `<script src="assets/js/app.js"></script>` before `</body>`
(after any page-specific scripts).

## Shared classes available (see theme.css for the full list)
- Layout: `.grid .cols-2 .cols-3 .cols-4`, `.row`, `.row-between`, `.col`,
  `.wrap`, `.gap-2/4/5`, `.grow`, `.center`, `.hidden`, `.text-center/right`,
  `.mt-2/4/5`, `.mb-4`
- Type: `.display .headline .title .subtitle .muted .faint .mono .eyebrow`,
  `.text-accent/success/danger/warning`
- Buttons: `.btn` + `.btn--primary/secondary/ghost/danger/block/sm/lg`
- Cards: `.card`, `.card--flat/interactive`, `.card__head`, `.stat-card`
  (`.stat-card__icon`, `.stat-card__value`), `.hover-lift`
- Icon tiles: `.tile-icon` + `--success/danger/warning`
- Badges: `.badge` + `--accent/success/danger/warning/neutral`
- Forms: `.field` (label+control), `.input .select .textarea`, `.input-group`
- Switch: `.switch` (`<label class="switch"><input type="checkbox"><span class="slider"></span></label>`)
- Progress: `.progress` > `.progress__fill` (add `data-value="70"` for animation;
  `--success/danger/warning` variants)
- Table: `.table-wrap` > `table.data` (thead th / tbody td)
- Modal: `.modal-overlay#id` > `.modal` > `.modal__head/__body/__foot`;
  open with `data-modal-open="id"`, close with `data-modal-close`
- Toast: call `showToast('msg','success'|'danger')`
- FAB: `.fab`
- Segmented control / tabs: use `.seg` > `.seg__btn` (+ `.active`) if present — if
  not defined yet, add a small page `<style>` using vars, or use `.btn` variants.
- Charts: keep existing inline SVG; swap hardcoded Tailwind hex/token strokes to
  `var(--accent)`, `var(--danger)`, `var(--success)`, `var(--warning)`,
  `var(--surface-3)` for tracks.

## Color mapping (old Tailwind token -> new)
- primary / primary-container / secondary  -> accent family (var(--accent), etc.)
- text-on-surface -> default text (--text); on-surface-variant -> .muted
- surface-container-lowest/bright -> white card (.card handles it)
- surface-container-low/high -> --surface-2 / --surface-3
- tertiary (was green, used for income/success) -> --success
- error / error-container -> --danger / --danger-bg
- Money: income/positive = .text-success, expense/negative = .text-danger

## Responsiveness
Rely on the shared grid + breakpoints. Ensure no fixed pixel widths cause
horizontal scroll. Use `.grid .cols-N` which collapse automatically. Wrap wide
tables in `.table-wrap`.

## Done = 
- Zero Tailwind anywhere (no CDN, no config, no utility classes, no token names).
- Shell identical to partials.html.
- All original data/text/scripts preserved and functional.
- Uses only theme.css classes/vars (+ minimal page-unique keyframes if needed).

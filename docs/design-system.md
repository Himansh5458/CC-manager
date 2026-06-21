# Design System — derived from Startify (Behance reference)

## Source
Startify SaaS Analytics Platform, Yurii Volot (Behance). Dark dashboard + light marketing/detail card patterns, dense metric cards, gauge/radar charts, minimal outline icons.

## Color Palette

### Core brand colors (from reference)
- Charcoal/Navy (primary dark): `#262E3B`
- Signature Yellow (accent): `#F0D400`

### Extended palette (derived, for our app's needs)
- Background dark (dashboard mode): `#1A1F29` (slightly darker than #262E3B, for depth)
- Surface dark (cards on dashboard): `#262E3B`
- Background light (detail/form screens): `#F5F6F8`
- Surface light (cards on light bg): `#FFFFFF`
- Text primary (dark mode): `#FFFFFF`
- Text secondary (dark mode): `#9CA3AF`
- Text primary (light mode): `#262E3B`
- Text secondary (light mode): `#6B7280`

### Semantic colors (for financial states — not in original reference, defined for our domain)
- Success / good utilization / achieved milestone: `#22C55E`
- Warning / approaching limit / approaching cap: `#F0D400` (reuses brand yellow — dual purpose, intentional)
- Danger / over limit / due soon: `#EF4444`
- Info / neutral data: `#3B82F6`

## Typography
- Font family: **Urbanist** (Google Fonts) — geometric sans-serif, used for all UI text
- Headings: Urbanist SemiBold/Bold
- Body: Urbanist Regular/Medium
- Numerals (financial figures): Urbanist, tabular-nums feature enabled for alignment in tables

## Component Patterns (from reference, adapted)

### Metric Card
Label (small, secondary text) + large number (primary text) + change indicator pill (colored background, small text, arrow icon). Used for: dashboard due-date cards, utilization summary, monthly spend total.

### Gauge/Dial
Semi-circular dial with tick marks, large center percentage, label below. Used for: per-card utilization, milestone cycle progress.

### Progress bar (linear)
Rounded, thin (6px height), colored fill on muted track. Used for: milestone tier progress, family cap tracker.

### Radar/Spider chart
Multi-axis comparison. Candidate use: comparing reward rates across categories for a single card, or comparing multiple cards' value across categories (stretch goal, not core MVP).

### Icon style
Outline icons, minimal, geometric (Tabler Icons matches this style closely — already available via the visualize tool's icon set, can mirror via lucide-react or @tabler/icons-react in actual app code).

## Layout Density
Dashboard = dark mode, data-dense, multiple cards per row, minimal whitespace (matches "trading terminal" density).
Forms/detail views = light mode, more generous spacing, single-column or two-column forms.

## Tailwind Implementation Notes
- Configure custom colors above as Tailwind theme extensions, not inline hex values in components
- Use CSS variables for theme values so dark/light mode sections can coexist within the same app (dashboard dark, forms light) without a global theme toggle

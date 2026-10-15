# Recount logo

Nine recorded points, three of them joined later by a rule: Recount records behavior first and
decides what it means later.

| File | Use |
|---|---|
| `recount-symbol.svg` | The mark in brand colors, on light backgrounds |
| `recount-symbol-reverse.svg` | The mark in brand colors, on dark backgrounds |
| `recount-symbol-mono.svg`, `recount-symbol-reverse-mono.svg` | One color, for print or single-color surfaces |
| `recount-symbol-currentColor.svg` | Takes the surrounding text color |
| `recount-lockup*.svg` | Mark and wordmark, same four colorways |
| `favicon.svg` | Browser tab icon; follows the system light or dark scheme |
| `app-icon.svg`, `app-icon-*.png` | Mark on an ink tile, for home screens and app stores |
| `recount-symbol-{16,32,48}.png`, `recount-lockup-1200.png` | Raster exports |

- **Colors.** Points `#14171c`, joined points `#0b6e86` (the dashboard's `--ink` and
  `--visitors`). On dark: `#eceef2` and `#5cc3d9`.
- **Smallest size.** 16 px for the mark; below that the points merge. The lockup needs at least
  16 px of cap height.
- **Clear space.** Keep one point's diameter (an eighth of the mark's width) free on every side.
- **Wordmark.** Instrument Sans at weight 600, outlined (SIL Open Font License). The name is
  lowercase in the logo and capitalized in running text.
- The dashboard draws the mark inline from `apps/web/src/ui/Logo.tsx`; keep its paths in sync.

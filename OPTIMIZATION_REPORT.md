Optimization report — 5 November 2026

Completed locally on `optimize/auto-cleanup`, starting from `947302c` with checkpoint `c244a4c`. Each step has a separate commit; the ranking edge-case correction has its own follow-up commit. This project uses npm, React 19, TypeScript, Vinext/Vite 8 and Tailwind 4, so Vue-specific instructions were adapted to the existing stack. Nothing was pushed or deployed.

Before/after measurements:

| Measurement | Before | After |
| --- | ---: | ---: |
| Production output, raw | 16,788,794 B | 16,761,629 B |
| Production output, gzip | 5,192,187 B | 5,183,548 B |
| Initial JavaScript, raw | 1,118,492 B | 1,118,443 B |
| Initial JavaScript, gzip | 337,533 B | 337,530 B |
| Largest browser chunk, raw | 1,465,568 B | 1,465,568 B |
| Largest browser chunk, gzip | 451,060 B | 451,060 B |
| Installed node_modules | 788,498,223 B | 788,498,223 B |
| Complete offline application | 7,493,504 B | 7,479,978 B |
| Maintained files, including this report | 3,839,213 B | 3,846,098 B |
| Browser bundler chunks | 165 | 165 |
| All generated JavaScript files | 416 | 416 |
| Direct dependencies, production / development | 14 / 24 | 14 / 24 |
| Locked package instances | 878 | 878 |
| Nonblank code-file lines | 99,967 | 99,981 |

Production output decreased **27,165 B raw / 8,639 B gzip**. Source/configuration excluding this report grew **278 B**; measured code-file lines grew **14**, primarily to preserve the original collaboration API while exposing a smaller browser entry and enforcing stronger compiler checks. Dependencies and assets were retained.

Gzip totals sum independently compressed files. Initial JavaScript is the existing startup dependency closure, excluding optional dynamic views; it is not a network timing measurement. Lines cover TS/JS, CSS, SQL and shell/command files, including comments/tests and excluding generated files. Raw/gzip measurements for every JavaScript file were retained locally. Largest packages remain Mermaid (122,322,316 B), workerd (89,876,083 B), and Lucide (31,224,249 B). The existing 113,894,062 B Vite cache is included in node_modules, not counted as a package. The largest chunk remains optional ELK; the largest public PNG is 8,814 B.

Changes, grouped by step:

- **0 — Setup:** created the requested branch/checkpoint, captured the baseline, and ran Knip temporarily without adding project dependencies.
- **1 — Bundle:** added a narrow lazy collaboration entry while preserving the original full Yjs API, function identities, shared-document behavior and failed-import retry. The browser collaboration chunk fell from **95,540 to 82,142 B**. Existing build defaults already provide minification, CSS splitting, modern targets and disabled source maps.
- **2 — Dependencies:** verified required packages and retained the lockfile. The dedupe dry run proposed twelve unrelated version changes with little removal, so it was not applied.
- **3 — Runtime:** reuse one collator per textual Collections sort; numeric-only/empty lists create none. Replace brainstorm decoration objects with stable sorting of a copied array. A follow-up uses `slice()` to preserve sparse holes. Exact localized/order/identity checks passed; the local 200-row sort median improved **6.190 → 0.902 ms**. This is a microbenchmark, not an end-to-end speed claim.
- **4 — TypeScript:** enabled `noUnusedLocals`, `noUnusedParameters` and `noImplicitReturns` alongside strict mode. Added an equivalent explicit final return to the account-policy hook.
- **5 — Cleanup:** removed the proven unused internal `entityTitle` helper and shared identical ID-uniqueness validation through an existing import, saving 467 source bytes. Knip, reference checks and 4,007 equivalence cases support these changes. Existing ignore rules already cover generated/private files.
- **6 — Assets/loading:** retained already compressed PNGs, referenced SVGs, WOFF2 math fonts and lazy media/renderers; no further safe asset reduction was established.
- **7 — Verification:** every step and the ranking correction passed types, zero-warning lint, backend/security checks, 45 native Node tests and production build. **25 Chromium + 4 Firefox + 4 WebKit workflows passed**, with no failures/skips. All ten Collections theme/viewport captures were inspected. Source/test fingerprints stayed unchanged during browser verification. The built worker's isolated local browser runs provide the appropriate production smoke check for this server-backed app.

Skipped or reverted:

- No complete step required reversion. The ranking copy was corrected after comparison exposed the sparse-array difference.
- Vue/Pinia APIs and vue-tsc do not apply. Existing React/hooks/accessibility ESLint and tsc checks were retained; no formatter package or style-only rewrite was added.
- No major upgrades, manual lock edits, secret-file edits, manually edited build artifacts, lossy image conversion, font-display changes, speculative preload/compression files, console stripping or altered debounce timing. These lacked verified benefit or would change behavior.
- Knip's generated-test imports, framework shims and Tailwind CSS-import findings were reviewed rather than blindly removed. No temporary analyzer dependency remains in the project. Analyzer caches and this run's disposable browser/runtime copies were cleaned up; existing archives and original browser caches were preserved.
- Firefox used a SHA256-identical temporary copy of its installed runtime for the documented local-cache launch issue. Physical-device behavior and broader end-to-end performance were not measured.

Needs manual review; left intact:

- `TaskReminder` and exported store/type compatibility surfaces with uncertain external or harness usage.
- WorkRooms' shared shelf/card/editor boundary before any further lazy splitting.
- Incompatible esbuild/lightningcss dependency copies and the existing Vite cache before future toolchain/cache cleanup.
- Dynamic CSS/theme classes and timing-sensitive effects, listeners and recovery logic before broader pruning.

Manual testing checklist:

- Sort Collections by numeric and accented/text properties in both directions; check all four layouts, project scope, keyboard controls and narrow screens.
- Edit one note from two accounts, disconnect/reconnect, check Unicode/cursor positions and recover unsaved changes.
- Rank brainstorm ideas with equal votes, toggle ranking off, and confirm original order remains intact.
- Check ordinary sign-in and registration/access-denial feedback, then review app-update recovery with pending work.

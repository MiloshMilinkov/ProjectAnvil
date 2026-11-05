# Optimization report — 5 November 2026

This review starts from commit `947302c`, after the previous optimization pass. Work is local on `optimize/auto-cleanup`; checkpoint `c244a4c` preserves the starting state. The actual stack is npm, React 19, TypeScript 5.9, Vinext/Vite 8, Tailwind 4, Better Auth, and a local Cloudflare worker. Vue-specific instructions are adapted to this stack; no framework migration is planned.

## Measurements

| Measurement | Baseline | Final |
| --- | ---: | ---: |
| Production output, raw | 16,788,794 B | Pending |
| Production output, gzip | 5,192,187 B | Pending |
| Initial JavaScript, raw | 1,118,492 B | Pending |
| Initial JavaScript, gzip | 337,533 B | Pending |
| Largest browser JavaScript chunk, raw | 1,465,568 B | Pending |
| Largest browser JavaScript chunk, gzip | 451,060 B | Pending |
| Browser / total JavaScript chunks | 166 / 416 | Pending |
| Direct dependencies, production / development | 14 / 24 | Pending |
| Locked package instances | 878 | Pending |
| Installed dependencies | 788,498,223 B | Pending |
| Nonblank code-file lines | 99,967 | Pending |
| Maintained files, including assets and documentation | 3,839,213 B | Pending |
| Complete offline application | 7,493,504 B | Pending |

Gzip is the sum of independently compressed files using Node's default gzip settings, not an assertion about HTTP compression. Initial JavaScript is the existing size reporter's startup dependency closure. Lines include comments and tests in tracked/unignored TypeScript, JavaScript, CSS, SQL, shell, and command files; generated files and dependencies are excluded. Raw/gzip sizes for every production JavaScript chunk were captured locally.

## Changes by step

- **Step 0 — setup:** created the requested branch and checkpoint, detected the actual stack, captured the baseline, and passed strict types, zero-warning lint, backend checks, 45 native Node tests, and the production build. Knip runs temporarily through npm exec without changing project dependencies.
- **Step 1 — bundle:** added a narrow lazy collaboration entry while retaining the original runtime's full API. The six Yjs members and eight helpers retain identical references; update/recovery and cursor-position checks pass. Production output decreased by 26,939 raw bytes and 8,623 gzip bytes; the complete offline application decreased by 13,434 bytes. The full type/lint/test/build chain passed.
- **Step 2 — dependencies:** verified all direct runtime packages are used and retained the dependency tree. Knip's Tailwind warning is a CSS-import false positive. The dedupe dry run proposed twelve unrelated version updates and only a small removal, so it was not applied. No package or lockfile changes were made; the complete check chain passed.
- **Step 3 — runtime:** reuse one locale-aware collator per Collections sort, constructing none for empty, singleton or numeric-only lists. Use stable native brainstorm sorting without temporary decoration objects. Exact comparison/order checks passed for 5,887 localized pairs, 202 complete sorts and 402 ranking cases. The local 200-row sort median fell from 6.190 ms to 0.902 ms; this is a microbenchmark, not a whole-screen timing claim. Combined source is 99 bytes smaller and the full check chain passed.
- **Steps 4–7:** in progress; only verified, behavior-preserving changes will be retained.

## Skipped or reverted

- Vue Router, Pinia, Vue templates, `defineAsyncComponent`, and `vue-tsc` do not apply to this React/Vinext project. Existing React, TypeScript, and framework checks are used instead.
- No major dependency upgrades, manual lockfile edits, secret-file edits, or manually edited generated output are authorized by this review.
- Vite already disables production source maps, splits CSS, targets modern supported browsers and minifies output; Vinext also minifies the server. Existing feature/renderer lazy loading and syntax chunk splitting remain. Operational console output, established preload recovery and worker response handling are preserved. Extra compression files would add offline-cache bytes without a verified local-serving benefit.

## Needs manual review

Pending completion of the static and runtime audits. Uncertain removals will be left intact.

## Manual testing checklist

The final checklist will identify the workflows actually touched. Existing local data and backups remain unchanged.

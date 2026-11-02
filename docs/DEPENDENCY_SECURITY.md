# Dependency security

Reviewed **2026-10-31**. The production dependency audit reports **zero vulnerabilities**. The full audit retains **12 moderate entries derived from one legacy linting-dependency advisory**, reviewed below; there are no high or critical findings. Audit results can change when advisories are published. Exact versions and targeted overrides are in [package.json](../package.json) and [package-lock.json](../package-lock.json).

## Current tooling advisory

[GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) describes pattern amplification in Minimatch's advanced optimizer and declares versions below 11.0.1 affected. The TypeScript parser's Minimatch 10.2.5 contained that implementation; a narrowly scoped override now selects **11.0.3**. Its consumer uses the named `minimatch()` API, retained in the patched major. Regression coverage checks representative source globs, dot files, Unicode paths, and bounded advanced-pattern expansion; full lint remains required.

ESLint and the React/accessibility plugins still require the callable CommonJS API from **Minimatch 3.1.5**. That installed legacy branch has neither `firstPhasePreProcess`, `secondPhasePreProcess`, nor the `optimizationLevel` option described in this advisory. The maintainer's [version history](https://github.com/isaacs/minimatch/blob/v11.0.3/changelog.md) places those optimizations in later majors. This source review supports treating the remaining broad-range match as inapplicable to that branch, while keeping the raw audit findings visible. These are development tools, with no app note, search, upload, or API path passing user content to the matcher.

Do not replace every legacy consumer with Minimatch 11: its exports and regular-expression APIs differ. Revisit this finding when upstream updates its affected range or releases compatible dependency changes. `security:audit` now checks **the full dependency tree**, failing at high severity; a passing threshold check does not mean the raw moderate count is zero.

## Runtime security update

The former `vinext@1.0.0-beta.5 → @vercel/og@0.8.6 → satori@0.16.0` chain inherited [GHSA-wx4j-mvgx-mqwp](https://github.com/advisories/GHSA-wx4j-mvgx-mqwp). Upgrading to [Vinext 1.3.1](https://github.com/cloudflare/vinext/releases/tag/vinext%401.3.1) removes that affected chain through its upstream `@vercel/og@1.0.3` dependency. No application route uses Satori or `ImageResponse` to render workspace input.

The update follows the framework's [declared peer requirements](https://github.com/cloudflare/vinext/blob/vinext%401.3.1/packages/vinext/package.json): React, React DOM, and React Server DOM Webpack **19.3.1**, with `@vitejs/plugin-rsc` **0.5.37**. These versions are pinned together; no incompatible transitive package was forced into the older framework. Future upgrades still need local worker, routing, installation, and data-recovery checks.

The normal launcher builds when source changes, reuses a current production build, and serves on `127.0.0.1`. Building, development, and local serving still use tooling dependencies, so a production-only audit is not the whole risk assessment. Loopback access does not prove that vulnerable tooling is harmless.

## Browser and request boundaries

The worker adds MIME sniffing protection, same-origin framing, a no-referrer policy, and restricted browser permissions while retaining same-origin audio recording. HTTPS responses receive HSTS; loopback HTTP does not. API responses are private and non-cacheable. The wrapper preserves response streams, cookies, status codes, and stricter route policies such as the attachment sandbox.

The base Content Security Policy restricts document bases, form destinations, and framing. It is not a complete script-source policy; tightening that boundary requires explicit compatibility work for streamed React rendering, diagrams, uploads, and media previews. Existing raw-HTML restrictions and attachment access checks remain necessary.

Mutation, transfer, and account handlers share a bounded stream reader. Limits are enforced while bytes arrive, including when `Content-Length` is missing or inaccurate; oversized streams are cancelled and the reader is released. Authentication additionally needs its configured rate limits and access policy. Response headers and body limits do not replace per-record permission checks.

## Application security review

- SQL values use prepared bindings, including JSON collections. Dynamic predicates are internal permission/revision checks or fixed choices; runtime input does not select SQL identifiers, expressions, or migration sources. Real SQLite regressions store quote/comment/semicolon/UNION payloads literally and verify schema, membership, and other accounts' records remain intact. This follows [OWASP's parameterization guidance](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html).
- Account, workspace, and project access is resolved on the server, independently of display names and assignment labels. Tests cover forged identity/workspace headers, restricted projects, withdrawn access, cross-session revocation, and stale permission responses. No additional bypass was found in the reviewed paths.
- Online account-policy refusals now execute after Better Auth's native database rate limiter. Denied registration and sign-in attempts consume the same limits; disallowed usernames use the native unknown-account response and password-hash work. Malformed passwords and optional sign-in fields retain native validation responses without revealing a withdrawn username. Regressions use the real library and SQLite, rather than a simulated limiter.
- Markdown does not enable raw HTML; math rendering disables trusted commands, and diagram security settings cannot be relaxed by note directives. Browser regressions exercise script/HTML/SVG, unsafe links, code highlighting, math, and diagram payloads while connected and offline.
- Upload/download checks retain origin, account/project authorization, streaming size limits, MIME restrictions, attachment sandboxing, and no-sniff headers. Malformed Unicode filename metadata is normalized before header encoding. Archive regressions include traversal, links, encrypted entries, conflicting headers, and prototype-shaped metadata.

These local source and regression checks are not an independent penetration test or proof that every vulnerability is absent. Aggregate attachment allowances now use actual object sizes and durable reservations; uploads/imports share database-backed account/workspace request and file-write limits. Review these budgets and verify hosted enforcement before online staging. Full script-source CSP compatibility, real HTTPS/proxy behavior, external email delivery, hosted load, monitoring, and recovery also remain deployment checks. The app remains local.

## Maintenance choices

Unused starter UI packages, connector-preview support, the redundant Next.js package, and two formatting wrappers have been removed. Vinext supplies the existing runtime and compatibility types. Standalone JavaScript, TypeScript, React, Hooks, and accessibility lint rules replace the Next-dependent lint parser. `fast-uri` **3.1.9** and Undici **7.30.1** remain pinned, while the Cloudflare/Vinext integration is retained.

- The legacy Drizzle loader has a targeted esbuild override. Verify schema loading when changing it; a forced Drizzle downgrade can conflict with Better Auth.
- Notes, math parsing, and Mermaid use one pinned KaTeX **0.19.0** installation. Check inline/display/fenced equations and diagram math labels after updates. Code highlighting retains the former common languages and aliases, including Arduino/ino.
- Broad framework or local-worker upgrades need a complete backup/restore rehearsal with isolated data. Follow [local setup](LOCAL_SETUP.md); preserve ordinary application data.

## Checking updates

```sh
npm run install:ci
npm run check
npm run test:browser
npm audit
npm audit --omit=dev
```

Check both audit reports and startup with isolated fixture data. Avoid `npm audit fix --force`; its proposed major/framework changes may break the supported runtime. Remove overrides when a reviewed upstream release incorporates the fix. This document records a dated review, not a permanent clean-audit guarantee.

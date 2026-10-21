# Dependency security

On October 21, 2026, the updated lockfile passed the production audit with **zero reported vulnerabilities**. The full audit still reports eight development dependency entries, all inherited from the unpatched `braces` advisory described below. Audit results can change as new advisories are published.

Reviewed **2026-10-21**. Exact dependency versions and targeted overrides are recorded in [package.json](../package.json) and [package-lock.json](../package-lock.json).

## Unpatched toolchain advisory

`braces` through **3.0.3** can exhaust the Node.js call stack when processing deeply nested brace patterns. The [GitHub advisory GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) lists **no patched release**. The npm registry still lists 3.0.3 as the latest release on the review date.

It reaches this project through development tools:

- `eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces`
- `vinext → vite-plugin-commonjs → vite-plugin-dynamic-import → fast-glob → micromatch → braces`

An audit may report the affected package and several parent packages for this single unresolved cause. The separately named `brace-expansion` package has patched overrides; those do not resolve this `braces` advisory.

ProjectAnvil's default server listens on `127.0.0.1` and stores workspace data locally. It is not publicly reachable through that address. This reduces network exposure; it does **not** establish that a development tool vulnerability cannot be exploited. The normal launcher uses the development toolchain, so development dependency findings still matter. Untrusted source files, configuration, or inputs reaching these tools require care. No exploit through normal note or task input has been established by this review.

Keep this advisory visible and review upstream releases before making the app reachable from other devices or a public network. Do not downgrade unrelated tools or substitute an incompatible glob library simply to remove the audit warning.

## Why versions are pinned

The current update keeps framework changes within compatible release lines and uses targeted overrides for vulnerable transitive packages. These cover image/media processing, WebSocket and HTTP clients, mathematical rendering, parsers, and build/check tooling.

Two overrides need particular attention during maintenance:

- The legacy Drizzle loader requires an older esbuild range. Its targeted override moves that dependency to a patched esbuild release; verify TypeScript schema loading after changing it. An audit suggestion to downgrade Drizzle can conflict with Better Auth's supported versions.
- The Markdown math plugins request an older KaTeX release line. Their overrides use a patched version; verify inline/display equations and diagram rendering after dependency updates.

The Cloudflare plugin, Wrangler, Miniflare, and Vinext versions are retained while their vulnerable transitive dependencies receive fixes. A broad upgrade can change peer requirements, worker behavior, or local storage compatibility. Treat that as a separate migration with a complete backup and restore check, following [local setup and backups](LOCAL_SETUP.md).

## Updating and checking

After reviewing a dependency change, install from the lockfile and run:

```sh
npm run install:ci
npm run check
npm audit
npm audit --omit=dev
```

Also check local startup and a built-app startup using isolated fixture data. Review both audit outputs: the production-only report omits tools used by the normal development launcher. Do not assume `npm audit fix --force` preserves the app's supported dependency combinations.

Remove an override when a reviewed upstream update includes the required fix. Recheck the unresolved advisory when a new `braces` release becomes available; this document records the review date rather than promising a permanent clean audit.

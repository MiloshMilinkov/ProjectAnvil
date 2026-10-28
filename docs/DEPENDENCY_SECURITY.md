# Dependency security

Reviewed **2026-10-28**. The current lockfile reports **zero vulnerabilities in both the full and production dependency trees**. Audit results can change when advisories are published. Exact versions and targeted overrides are in [package.json](../package.json) and [package-lock.json](../package-lock.json).

## Runtime security update

The former `vinext@1.0.0-beta.5 → @vercel/og@0.8.6 → satori@0.16.0` chain inherited [GHSA-wx4j-mvgx-mqwp](https://github.com/advisories/GHSA-wx4j-mvgx-mqwp). Upgrading to [Vinext 1.3.1](https://github.com/cloudflare/vinext/releases/tag/vinext%401.3.1) removes that affected chain through its upstream `@vercel/og@1.0.3` dependency. No application route uses Satori or `ImageResponse` to render workspace input.

The update follows the framework's [declared peer requirements](https://github.com/cloudflare/vinext/blob/vinext%401.3.1/packages/vinext/package.json): React, React DOM, and React Server DOM Webpack **19.3.1**, with `@vitejs/plugin-rsc` **0.5.37**. These versions are pinned together; no incompatible transitive package was forced into the older framework. Future upgrades still need local worker, routing, installation, and data-recovery checks.

The normal launcher builds when source changes, reuses a current production build, and serves on `127.0.0.1`. Building, development, and local serving still use tooling dependencies, so a production-only audit is not the whole risk assessment. Loopback access does not prove that vulnerable tooling is harmless.

## Browser and request boundaries

The worker adds MIME sniffing protection, same-origin framing, a no-referrer policy, and restricted browser permissions while retaining same-origin audio recording. HTTPS responses receive HSTS; loopback HTTP does not. API responses are private and non-cacheable. The wrapper preserves response streams, cookies, status codes, and stricter route policies such as the attachment sandbox.

The base Content Security Policy restricts document bases, form destinations, and framing. It is not a complete script-source policy; tightening that boundary requires explicit compatibility work for streamed React rendering, diagrams, uploads, and media previews. Existing raw-HTML restrictions and attachment access checks remain necessary.

Mutation, transfer, and account handlers share a bounded stream reader. Limits are enforced while bytes arrive, including when `Content-Length` is missing or inaccurate; oversized streams are cancelled and the reader is released. Authentication additionally needs its configured rate limits and access policy. Response headers and body limits do not replace per-record permission checks.

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

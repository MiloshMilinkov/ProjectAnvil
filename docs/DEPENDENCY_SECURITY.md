# Dependency security

Reviewed **2026-10-27**. The current lockfile reports **zero production vulnerabilities**. The full audit reports **three moderate entries**, all from the Satori toolchain chain below; no high or critical entries remain. Audit results can change when advisories are published. Exact versions and targeted overrides are in [package.json](../package.json) and [package-lock.json](../package-lock.json).

## Remaining toolchain advisory

`vinext@1.0.0-beta.5 → @vercel/og@0.8.6 → satori@0.16.0` inherits [GHSA-wx4j-mvgx-mqwp](https://github.com/advisories/GHSA-wx4j-mvgx-mqwp). Satori versions before **0.33.5** in the affected range improperly escape SVG values. The audit counts the affected package and two parents separately. No application route currently uses Satori or `ImageResponse` to render workspace input.

The audit proposes a Vinext migration to 1.3.1. This is a framework change, rather than a compatible transitive patch, and remains separate work requiring local worker, routing, installation, and data-recovery checks. Do not force a different Satori release into the existing image-generation dependency without verifying its API compatibility.

The normal launcher builds when source changes, reuses a current production build, and serves on `127.0.0.1`. Building, development, and local serving still use tooling dependencies, so a production-only audit is not the whole risk assessment. Loopback access does not prove that vulnerable tooling is harmless.

## Maintenance choices

Unused starter UI packages have been removed. Existing stylesheet and Markdown type imports are now explicit dependencies. Targeted security updates include Next/ESLint **16.4.3**, `fast-uri` **3.1.9**, and Undici **7.30.1**, while retaining the current Cloudflare/Vinext integration.

- The legacy Drizzle loader has a targeted esbuild override. Verify schema loading when changing it; a forced Drizzle downgrade can conflict with Better Auth.
- Markdown math plugins use patched KaTeX overrides. Check inline/display math and diagrams after updates.
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

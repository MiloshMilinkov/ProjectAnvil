import vinext from "vinext";
import { defineConfig, type ResolveModulePreloadDependenciesFn } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { readExecutionProfile } from "./scripts/execution-profile.mjs";
import { sites } from "./build/sites-vite-plugin";
import { fileURLToPath } from "node:url";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const managedLinux = readExecutionProfile() === "managed-linux";

const localBindingConfig = {
  main: "./build/sites-worker.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async () => {
  // Use Miniflare's local Request.cf placeholder unless fetching is requested.
  process.env.CLOUDFLARE_CF_FETCH_ENABLED ??= "false";
  process.env.WRANGLER_SEND_METRICS ??= "false";

  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.WRANGLER_REGISTRY_PATH ??= ".wrangler/dev-registry";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    environments: {
      client: {
        build: {
          modulePreload: {
            resolveDependencies: ((filename, dependencies, context) => {
              // import() loads the entry itself. Preloading that same file can
              // retain a failed resource in WebKit even after an explicit retry.
              // Keep its dependencies parallel without poisoning entry recovery.
              return context.hostType === "js"
                ? dependencies.filter((dependency) => dependency !== filename)
                : dependencies;
            }) satisfies ResolveModulePreloadDependenciesFn,
          },
          rolldownOptions: {
            output: {
              codeSplitting: {
                groups: [
                  {
                    name: "syntax-highlighting",
                    test: /[\\/]node_modules[\\/]highlight\.js[\\/]/,
                    includeDependenciesRecursively: false,
                  },
                ],
              },
            },
          },
        },
      },
    },
    server: {
      ...(managedLinux
        ? { host: "0.0.0.0", allowedHosts: ["terminal.local"] }
        : { host: "127.0.0.1", port: 5173, strictPort: true }),
      watch: {
        ...(isCodexSeatbeltSandbox
          ? { useFsEvents: false, usePolling: true }
          : {}),
        // Runtime databases, verified backups, and test copies are not source.
        ignored: [
          ".wrangler",
          "backups",
          "outputs",
          "work",
          ".sites-runtime",
        ].map(
          (folder) =>
            fileURLToPath(new URL(`./${folder}/`, import.meta.url)).replace(
              /\\/g,
              "/",
            ) + "**",
        ),
      },
    },
    plugins: [
      {
        name: "projectanvil-modern-math-fonts",
        enforce: "pre",
        transform(source: string, id: string) {
          if (!/[\\/]katex[\\/]dist[\\/]katex(?:\.min)?\.css(?:\?|$)/.test(id))
            return;
          // Trim legacy font fallbacks before Vite discovers/emits their assets.
          // All supported browsers use WOFF2; families, weights and glyphs stay intact.
          return source.replace(/src:[^;}]+/g, (declaration) => {
            const modern = declaration.match(
              /url\([^)]*\.woff2[^)]*\)\s*format\(['"]?woff2['"]?\)/,
            );
            return modern ? `src:${modern[0]}` : declaration;
          });
        },
      },
      vinext(),
      sites({ mockAuth: !managedLinux }),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        config: localBindingConfig,
      }),
    ],
  };
});

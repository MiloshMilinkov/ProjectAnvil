"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Check, Download, RefreshCw, Smartphone } from "lucide-react";
import { createAppUpdateObserver } from "../lib/app-installation-updates";
import "./app-installation.css";

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
type InstallationState = {
  availability: "checking" | "supported" | "development" | "unavailable";
  ready: boolean;
  preparing: boolean;
  installed: boolean;
  canInstall: boolean;
  updateAvailable: boolean;
  error: string;
};
type WorkerReply = { ready?: boolean; activated?: boolean; error?: string };
type Installation = InstallationState & {
  install: () => Promise<void>;
  prepare: () => Promise<void>;
  checkForUpdates: () => Promise<void>;
  restart: () => Promise<void>;
};
const InstallationContext = createContext<Installation | null>(null);
const initialState: InstallationState = {
  availability: "checking",
  ready: false,
  preparing: false,
  installed: false,
  canInstall: false,
  updateAvailable: false,
  error: "",
};

function askWorker(worker: ServiceWorker, type: string): Promise<WorkerReply> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(
      () => {
        channel.port1.close();
        reject(
          new Error(
            "The app did not respond. Keep the local server running and retry.",
          ),
        );
      },
      type === "PROJECTANVIL_PREPARE_SHELL" ? 90_000 : 10_000,
    );
    channel.port1.onmessage = (event: MessageEvent<WorkerReply>) => {
      clearTimeout(timer);
      channel.port1.close();
      if (event.data?.error) reject(new Error(event.data.error));
      else resolve(event.data || {});
    };
    worker.postMessage({ type }, [channel.port2]);
  });
}

/** Public shell installation is independent of accounts and private offline data. */
export default function AppInstallation({ children }: { children: ReactNode }) {
  const [state, setState] = useState(initialState);
  const registration = useRef<ServiceWorkerRegistration | null>(null);
  const installPrompt = useRef<InstallPrompt | null>(null);
  const setup = useRef<(() => Promise<void>) | null>(null);
  const reloadRequested = useRef(false);
  const patch = useCallback(
    (value: Partial<InstallationState>) =>
      setState((previous) => ({ ...previous, ...value })),
    [],
  );

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) {
      queueMicrotask(() => patch({ availability: "unavailable" }));
      return;
    }
    let live = true;
    let request = 0;
    const updates = createAppUpdateObserver(monitor);
    const display = matchMedia("(display-mode: standalone)");
    const installed = () =>
      patch({
        installed:
          display.matches ||
          !!(navigator as Navigator & { standalone?: boolean }).standalone,
      });
    const themeColor = () => {
      const color = getComputedStyle(document.body).backgroundColor;
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta && color && color !== "rgba(0, 0, 0, 0)")
        meta.setAttribute("content", color);
    };
    const themeObserver = new MutationObserver(themeColor);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    themeColor();
    const onInstallPrompt = (event: Event) => {
      event.preventDefault();
      installPrompt.current = event as InstallPrompt;
      patch({ canInstall: true });
    };
    const onInstalled = () => {
      installPrompt.current = null;
      patch({ installed: true, canInstall: false });
    };
    const onControllerChange = () => {
      if (reloadRequested.current) window.location.reload();
      else void readStatus();
    };
    async function readStatus() {
      const active = registration.current?.active;
      if (!active) return;
      try {
        const result = await askWorker(active, "PROJECTANVIL_SHELL_STATUS");
        if (live) patch({ ready: !!result.ready, preparing: false });
      } catch {
        if (live) patch({ preparing: false });
      }
    }
    function monitor(worker: ServiceWorker) {
      if (!live) return;
      if (worker.state === "installing") {
        patch({ preparing: true });
      } else if (worker.state === "installed") {
        patch({
          preparing: false,
          updateAvailable: !!navigator.serviceWorker.controller,
        });
      } else if (worker.state === "activated") {
        void readStatus();
      } else if (worker.state === "redundant") {
        patch({
          preparing: false,
          error:
            "Offline startup could not be prepared. Keep the local server running, then retry.",
        });
      }
    }
    function adoptRegistration(incoming: ServiceWorkerRegistration) {
      registration.current = incoming;
      patch({ updateAvailable: !!incoming.waiting });
      updates.observe(incoming);
    }
    async function connect() {
      const token = ++request;
      try {
        const response = await fetch("/app-assets.json", {
          credentials: "omit",
          cache: "no-store",
          signal: AbortSignal.timeout(15_000),
        });
        if (!live || token !== request) return;
        if (response.status === 404) {
          patch({ availability: "development", preparing: false });
          return;
        }
        if (!response.ok) throw new Error("App preparation is unavailable.");
        const manifest: unknown = await response.json();
        if (
          !manifest ||
          typeof manifest !== "object" ||
          !("mode" in manifest) ||
          manifest.mode !== "production" ||
          !("version" in manifest) ||
          typeof manifest.version !== "string" ||
          !/^[a-f0-9]{20}$/.test(manifest.version)
        )
          throw new Error(
            "Open the built ProjectAnvil app to prepare offline startup.",
          );
        if (!live || token !== request) return;
        patch({ availability: "supported", preparing: true, error: "" });
        const incoming = await navigator.serviceWorker.register(
          "/service-worker.js",
          {
            scope: "/",
            updateViaCache: "none",
          },
        );
        if (!live || token !== request) return;
        adoptRegistration(incoming);
        await readStatus();
        if (!incoming.installing && !incoming.active)
          patch({ preparing: false });
      } catch {
        if (!live || token !== request) return;
        const existing = await navigator.serviceWorker
          .getRegistration("/")
          .catch(() => undefined);
        if (!live || token !== request) return;
        if (existing?.active) {
          adoptRegistration(existing);
          patch({
            availability: "supported",
            preparing: false,
            updateAvailable: !!existing.waiting,
          });
          await readStatus();
        } else
          patch({
            availability: "unavailable",
            preparing: false,
            error:
              "Keep the local server running to prepare the app for offline startup.",
          });
      }
    }
    setup.current = connect;
    display.addEventListener("change", installed);
    window.addEventListener("beforeinstallprompt", onInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      onControllerChange,
    );
    queueMicrotask(installed);
    void connect();
    return () => {
      live = false;
      request++;
      if (setup.current === connect) setup.current = null;
      display.removeEventListener("change", installed);
      window.removeEventListener("beforeinstallprompt", onInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      themeObserver.disconnect();
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange,
      );
      updates.disconnect();
    };
  }, [patch]);

  const install = useCallback(async () => {
    const prompt = installPrompt.current;
    if (!prompt) return;
    installPrompt.current = null;
    patch({ canInstall: false });
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === "accepted") patch({ installed: true });
  }, [patch]);
  const prepare = useCallback(async () => {
    patch({ error: "", preparing: true });
    try {
      const active = registration.current?.active;
      if (!active) await setup.current?.();
      else {
        const result = await askWorker(active, "PROJECTANVIL_PREPARE_SHELL");
        patch({ ready: !!result.ready });
      }
    } finally {
      patch({ preparing: false });
    }
  }, [patch]);
  const checkForUpdates = useCallback(async () => {
    if (!registration.current) return;
    await registration.current.update();
    patch({ updateAvailable: !!registration.current.waiting });
  }, [patch]);
  const restart = useCallback(async () => {
    const waiting = registration.current?.waiting;
    if (!waiting)
      throw new Error("There is no prepared update. Check for updates again.");
    reloadRequested.current = true;
    try {
      const result = await askWorker(waiting, "PROJECTANVIL_ACTIVATE_UPDATE");
      if (!result.activated)
        throw new Error(
          "The update could not start. Retry when other app windows are closed.",
        );
    } catch (cause) {
      reloadRequested.current = false;
      throw cause;
    }
  }, []);
  const value = useMemo(
    () => ({ ...state, install, prepare, checkForUpdates, restart }),
    [state, install, prepare, checkForUpdates, restart],
  );
  return <InstallationContext value={value}>{children}</InstallationContext>;
}

export function InstallAppPanel({
  canReload,
}: {
  canReload: () => Promise<boolean>;
}) {
  const installation = useContext(InstallationContext);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  if (!installation) return null;
  const supported = installation.availability === "supported";
  async function act(action: string, callback: () => Promise<void>) {
    if (busy) return;
    setBusy(action);
    setError("");
    setNotice("");
    try {
      await callback();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "This action could not finish. Retry while the local server is running.",
      );
    } finally {
      setBusy("");
    }
  }
  return (
    <section
      className="panel settings-section app-installation"
      data-tour="install-app"
    >
      <h2>
        <Smartphone size={20} /> Install ProjectAnvil
      </h2>
      <p>
        Open ProjectAnvil in its own window from your desktop or home screen.
        The local server handles accounts and synchronization.
      </p>
      <p className="app-installation-status" role="status">
        {installation.installed && (
          <>
            <Check size={16} /> Installed on this device.{" "}
          </>
        )}
        {installation.availability === "checking"
          ? "Checking offline startup…"
          : installation.availability === "development"
            ? "Development mode. Use the normal ProjectAnvil launcher to prepare the installable app."
            : installation.preparing
              ? "Preparing public application files for offline startup…"
              : installation.ready
                ? "Application files are ready for offline startup."
                : "Offline startup has not been prepared in this browser."}
      </p>
      <div className="app-installation-actions">
        {!installation.installed && (
          <button
            className="btn btn-primary"
            disabled={!!busy || !supported || !installation.canInstall}
            onClick={() => void act("install", installation.install)}
          >
            <Download size={16} /> Install app
          </button>
        )}
        {!installation.ready && (
          <button
            className="btn"
            disabled={
              !!busy ||
              installation.preparing ||
              installation.availability === "development" ||
              installation.availability === "checking"
            }
            onClick={() => void act("prepare", installation.prepare)}
          >
            <RefreshCw size={16} /> Prepare offline startup
          </button>
        )}
        {supported && (
          <button
            className="btn"
            disabled={!!busy || installation.preparing}
            onClick={() =>
              void act("check", async () => {
                await installation.checkForUpdates();
                setNotice(
                  "Update check finished. A prepared update will appear here when it is ready.",
                );
              })
            }
          >
            <RefreshCw size={16} /> Check for updates
          </button>
        )}
        {installation.updateAvailable && (
          <button
            className="btn btn-primary"
            disabled={!!busy}
            onClick={() =>
              void act("restart", async () => {
                if (!(await canReload()))
                  throw new Error(
                    "Keep this window open until your unfinished work is saved or safely kept for recovery.",
                  );
                await installation.restart();
              })
            }
          >
            Restart to update
          </button>
        )}
      </div>
      {supported && !installation.installed && !installation.canInstall && (
        <p className="app-installation-help">
          If your browser does not offer an Install button, open its menu and
          choose Install app or Add to Home Screen. Availability depends on the
          browser.
        </p>
      )}
      <p className="app-installation-help">
        This saves public application files. Choose which private workspaces to
        keep offline in the offline settings below.
      </p>
      {installation.updateAvailable && (
        <p className="app-installation-help">
          An update is ready. Finish your work and close other ProjectAnvil
          windows before restarting.
        </p>
      )}
      {(error || installation.error) && (
        <p className="app-installation-error" role="alert">
          {error || installation.error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}

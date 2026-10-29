"use client";

import {
  Component,
  lazy,
  Suspense,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
  type RefObject,
} from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { prepareWorkspaceReload } from "../../lib/draft-store";
import { useDraftScope } from "../useRecoverableDraft";

class FeatureFailure extends Component<
  {
    children: ReactNode;
    label: string;
    onRetry: () => void;
    onReload: () => void;
    reloading: boolean;
    reloadError: string;
    reloadButton: RefObject<HTMLButtonElement | null>;
  },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="feature-load-state" role="alert">
        <h2>Could not open {this.props.label}</h2>
        <p>
          Check the local connection, then try again. Your saved work stays
          available. If retrying does not help, save your work and reload the
          app.
        </p>
        <button
          className="btn"
          disabled={this.props.reloading}
          onClick={this.props.onRetry}
        >
          <RefreshCw size={16} aria-hidden="true" />
          Retry opening
        </button>
        <button
          className="btn"
          ref={this.props.reloadButton}
          disabled={this.props.reloading}
          onClick={this.props.onReload}
        >
          <RefreshCw size={16} aria-hidden="true" />
          {this.props.reloading ? "Checking saved work…" : "Reload app"}
        </button>
        {this.props.reloadError && (
          <p className="form-error" role="status">
            {this.props.reloadError}
          </p>
        )}
      </section>
    );
  }
}

/** Retry stays in the current view; reloading is a separate, guarded choice. */
export function deferredFeature<P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>,
  label: string,
) {
  const Initial = lazy(load);
  return function DeferredFeature(props: P) {
    const scope = useDraftScope();
    const [entry, setEntry] = useState(() => ({ View: Initial, attempt: 0 }));
    const [reloading, setReloading] = useState(false);
    const [reloadError, setReloadError] = useState("");
    const reloadButton = useRef<HTMLButtonElement>(null);
    const mounted = useRef(false);
    const running = useRef(false);
    useLayoutEffect(() => {
      mounted.current = true;
      return () => {
        mounted.current = false;
      };
    }, []);
    useLayoutEffect(() => {
      if (reloadError && !reloading) reloadButton.current?.focus();
    }, [reloadError, reloading]);
    async function reload() {
      if (running.current) return;
      running.current = true;
      setReloading(true);
      setReloadError("");
      try {
        const ready = await prepareWorkspaceReload(scope);
        if (!mounted.current) return;
        if (!ready) {
          setReloadError(
            "Save, synchronize, or review unfinished work before reloading.",
          );
          return;
        }
        window.location.reload();
      } catch {
        if (mounted.current)
          setReloadError(
            "Could not check saved work. Keep this window open and try again.",
          );
      } finally {
        running.current = false;
        if (mounted.current) setReloading(false);
      }
    }
    const View = entry.View;
    return (
      <FeatureFailure
        key={entry.attempt}
        label={label}
        onReload={() => void reload()}
        reloading={reloading}
        reloadError={reloadError}
        reloadButton={reloadButton}
        onRetry={() => {
          setReloadError("");
          setEntry((current) => ({
            View: lazy(load),
            attempt: current.attempt + 1,
          }));
        }}
      >
        <Suspense
          fallback={
            <div className="feature-load-state" role="status">
              <LoaderCircle size={20} aria-hidden="true" />
              <p>Opening {label}…</p>
            </div>
          }
        >
          <View {...props} />
        </Suspense>
      </FeatureFailure>
    );
  };
}

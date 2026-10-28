"use client";

import {
  Component,
  lazy,
  Suspense,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";

class FeatureFailure extends Component<
  {
    children: ReactNode;
    label: string;
    onRetry: () => void;
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
          available.
        </p>
        <button className="btn" onClick={this.props.onRetry}>
          <RefreshCw size={16} />
          Retry opening
        </button>
      </section>
    );
  }
}

/** Optional screens share one loading/retry path; retry never reloads the app. */
export function deferredFeature<P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>,
  label: string,
) {
  const Initial = lazy(load);
  return function DeferredFeature(props: P) {
    const [entry, setEntry] = useState(() => ({ View: Initial, attempt: 0 }));
    const View = entry.View;
    return (
      <FeatureFailure
        key={entry.attempt}
        label={label}
        onRetry={() =>
          setEntry((current) => ({
            View: lazy(load),
            attempt: current.attempt + 1,
          }))
        }
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

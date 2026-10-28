import type { RefObject } from "react";
import "./entity-editors.css";

interface Feedback {
  recovered: boolean;
  storageError: string;
  error: string;
  errorRef: RefObject<HTMLDivElement | null>;
  busy: boolean;
  confirmClose: boolean;
  setConfirmClose: (value: boolean) => void;
  loadLatest: () => Promise<void>;
  keepAndClose: () => void;
  discardAndClose: () => void;
}

export function EntityEditorFeedback({
  editor: {
    recovered,
    storageError,
    error,
    errorRef,
    busy,
    confirmClose,
    setConfirmClose,
    loadLatest,
    keepAndClose,
    discardAndClose,
  },
  existing,
}: {
  editor: Feedback;
  existing: boolean;
}) {
  return (
    <>
      {recovered && (
        <p className="entity-editor-notice" role="status">
          Recovered an unsaved draft. Review it before saving.
        </p>
      )}
      {storageError && (
        <p className="form-error" role="alert">
          {storageError}
        </p>
      )}
      {error && (
        <div
          className="entity-editor-error"
          role="alert"
          tabIndex={-1}
          ref={errorRef}
        >
          <p className="form-error">{error}</p>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => void loadLatest()}
          >
            {existing ? "Load saved version" : "Check saved version"}
          </button>
        </div>
      )}
      {confirmClose && (
        <div className="entity-editor-close" role="alert">
          <p>
            These changes have not been saved.{" "}
            {storageError
              ? "A recovery copy could not be stored."
              : "You can keep a recovery copy and finish later."}
          </p>
          <div>
            <button
              type="button"
              className="btn"
              onClick={() => setConfirmClose(false)}
            >
              Keep editing
            </button>
            <button
              type="button"
              className="btn"
              disabled={!!storageError}
              onClick={keepAndClose}
            >
              Keep draft and close
            </button>
            <button
              type="button"
              className="btn danger"
              onClick={discardAndClose}
            >
              Discard changes
            </button>
          </div>
        </div>
      )}
    </>
  );
}

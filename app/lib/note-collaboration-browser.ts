import {
  Doc,
  applyUpdate,
  encodeStateAsUpdate,
  encodeStateVector,
  createRelativePositionFromTypeIndex,
  createAbsolutePositionFromRelativePosition,
} from "yjs";

// Keep the full runtime API intact while this browser entry excludes unused
// Yjs exports from the shared-editing download.
export const Y = Object.freeze({
  Doc,
  applyUpdate,
  encodeStateAsUpdate,
  encodeStateVector,
  createRelativePositionFromTypeIndex,
  createAbsolutePositionFromRelativePosition,
});

export {
  decodeDocumentUpdate,
  documentText,
  encodeDocumentUpdate,
  replaceCollaborativeText,
  serializedDocument,
  acknowledgeSharedNoteDrafts,
  mergeSharedNoteDrafts,
  sharedNoteDrafts,
} from "./note-collaboration-runtime";

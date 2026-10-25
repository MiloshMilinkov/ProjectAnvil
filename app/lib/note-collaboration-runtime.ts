// This engine is loaded by the browser only after shared editing starts.
// Eagerly evaluating it during both SSR and RSC would create two Yjs instances
// in the development worker; all live Y.Doc objects stay in this one runtime.
export * as Y from "yjs";
export {
  decodeDocumentUpdate,
  documentText,
  encodeDocumentUpdate,
  replaceCollaborativeText,
  serializedDocument,
} from "./note-collaboration";
export {
  acknowledgeSharedNoteDrafts,
  mergeSharedNoteDrafts,
  sharedNoteDrafts,
} from "./note-collaboration-drafts";

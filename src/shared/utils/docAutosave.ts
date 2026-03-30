export interface DocEditorSnapshot {
  docId: string | null;
  content: string;
}

export interface DocSaveSnapshot {
  docId: string | null;
  remoteContent: string;
  editorValue: string;
}

export const shouldSyncDocEditorFromRemote = (input: {
  previousSnapshot: DocEditorSnapshot;
  nextSnapshot: DocEditorSnapshot;
  editorValue: string;
}): boolean =>
  input.previousSnapshot.docId !== input.nextSnapshot.docId ||
  input.editorValue === input.previousSnapshot.content;

export const shouldScheduleDocAutosave = (input: {
  previousSnapshot: DocSaveSnapshot;
  nextSnapshot: DocSaveSnapshot;
}): boolean =>
  input.nextSnapshot.docId !== null &&
  input.nextSnapshot.editorValue !== input.nextSnapshot.remoteContent &&
  (input.previousSnapshot.docId !== input.nextSnapshot.docId ||
    input.previousSnapshot.remoteContent !== input.nextSnapshot.remoteContent ||
    input.previousSnapshot.editorValue !== input.nextSnapshot.editorValue);

export const isStaleDocSaveResponse = (
  requestSeq: number,
  latestRequestSeq: number | undefined,
): boolean =>
  typeof latestRequestSeq === "number" && requestSeq < latestRequestSeq;

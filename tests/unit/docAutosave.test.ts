import { describe, expect, it } from "vitest";

import {
  isStaleDocSaveResponse,
  shouldScheduleDocAutosave,
  shouldSyncDocEditorFromRemote,
} from "../../src/shared/utils/docAutosave";

describe("doc autosave helpers", () => {
  it("forces an editor sync when the active document changes", () => {
    expect(
      shouldSyncDocEditorFromRemote({
        previousSnapshot: {
          docId: "docs/old.md",
          content: "old content",
        },
        nextSnapshot: {
          docId: "docs/new.md",
          content: "new content",
        },
        editorValue: "draft edits",
      }),
    ).toBe(true);
  });

  it("skips syncing older remote content while the editor has newer local edits", () => {
    expect(
      shouldSyncDocEditorFromRemote({
        previousSnapshot: {
          docId: "docs/note.md",
          content: "server v1",
        },
        nextSnapshot: {
          docId: "docs/note.md",
          content: "server v2",
        },
        editorValue: "local v3",
      }),
    ).toBe(false);
  });

  it("accepts remote updates when the editor is still clean", () => {
    expect(
      shouldSyncDocEditorFromRemote({
        previousSnapshot: {
          docId: "docs/note.md",
          content: "server v1",
        },
        nextSnapshot: {
          docId: "docs/note.md",
          content: "server v2",
        },
        editorValue: "server v1",
      }),
    ).toBe(true);
  });

  it("does not reschedule the same autosave target on unrelated rerenders", () => {
    expect(
      shouldScheduleDocAutosave({
        previousSnapshot: {
          docId: "docs/note.md",
          remoteContent: "server v1",
          editorValue: "local v2",
        },
        nextSnapshot: {
          docId: "docs/note.md",
          remoteContent: "server v1",
          editorValue: "local v2",
        },
      }),
    ).toBe(false);
  });

  it("schedules a new autosave when the editor content changes again", () => {
    expect(
      shouldScheduleDocAutosave({
        previousSnapshot: {
          docId: "docs/note.md",
          remoteContent: "server v1",
          editorValue: "local v2",
        },
        nextSnapshot: {
          docId: "docs/note.md",
          remoteContent: "server v1",
          editorValue: "local v3",
        },
      }),
    ).toBe(true);
  });

  it("treats older save responses as stale", () => {
    expect(isStaleDocSaveResponse(2, 3)).toBe(true);
    expect(isStaleDocSaveResponse(3, 3)).toBe(false);
    expect(isStaleDocSaveResponse(4, 3)).toBe(false);
    expect(isStaleDocSaveResponse(1, undefined)).toBe(false);
  });
});

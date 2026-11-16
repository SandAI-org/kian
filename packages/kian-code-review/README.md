# Kian Review

A small VS Code extension for branch and commit review. It displays only paths and line counts until you click a file, then opens **one native, read-only diff**. It does not use the multi-diff editor, run a web server, fetch, checkout, stage, or commit.

## Use

Open Source Control (`Cmd+Shift+G`) and find **Kian Review**, or run **Kian Review: Show Review**. Toolbar actions compare branches, review a commit, refresh, and filter paths. Select a repository when prompted; with several repositories the selection is explicit.

- **Compare Branches**: choose the base and compare refs, then Branch tips (two complete revisions) or PR / merge base (ancestor to compare ref). Local/remote branches, tags and custom commit IDs are supported. Remote refs reflect your last fetch; the extension never fetches automatically.
- **Review Commit**: pick a recent commit, load older commits, or enter a revision. Initial commits compare with empty; merge commits compare with the **first parent**, not a combined diff.
- Folders start collapsed. Expand only what you need; the view toolbar also supports collapsing the file tree. This does not construct diff editors.
- Click a file to open its native diff in a preview tab. Double-click its editor tab to keep it. Hover a file row to use the copy button (repository-relative path). Right-click for absolute path or open working file. Deleted files still support path copying. A renamed file copies its new path; its tooltip also shows the old path.
- Refresh resolves refs again. The displayed comparison uses immutable hashes until refreshed, so a branch moving does not silently change an already opened diff.
- Uncommitted/untracked changes are intentionally excluded. The working file action opens the **current** checkout, which may differ from the reviewed revision.

## Language support and limits

Historical files use the built-in Git extension's `git:` documents and normal diff editor. Existing syntax highlighting and language support continue to apply; Pylance virtual-document support depends on its version/settings. Cross-file definitions may refer to the current workspace, not a complete historical environment. This extension does not promise historical semantic isolation.

Binary files use VS Code's native diff behavior; they are not decoded into a custom text viewer. Submodule entries are not expanded into a nested repository comparison. Large single-file diffs can still be expensive; this design removes the simultaneous multi-file editor workload, not all editor costs. Git operations have a 30-second timeout and 32 MiB metadata limit. Only trusted, disk-backed Git workspaces are supported. No proposed APIs are used.

## Develop and package

No runtime npm dependencies or build step. Run `node --test test/git.test.js`. `test/extension-host.js` exports a VS Code Extension Host integration runner and expects a disposable repository with main/feature branches and demo.py/added.py/removed.py fixtures. It checks lazy opening, clipboard, added/deleted sides, and unchanged Git status; run it in isolated user-data and extension directories.

Package with `vsce package --no-dependencies`; install the resulting VSIX with **Extensions: Install from VSIX…**. For SSH/Dev Containers install it **in the remote environment**, because Git and repository files live there. Reload that window if VS Code requests it.

Source lives in Kian; generated VSIX and raw test logs remain outside Git.

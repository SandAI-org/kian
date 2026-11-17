# Kian Review

A small VS Code extension for branch and commit review. It displays only paths and line counts until you click a file, then opens **one native, read-only diff**. It does not use the multi-diff editor, run a web server, fetch, checkout, stage, or commit.

## Use

Open Source Control (`Cmd+Shift+G`) and find **Kian Review**, or run **Kian Review: Show Review**. The current workspace repository is selected automatically. Repository choices are limited to Magi-family repositories, Odin and Magicore, recognized by folder name or Git remote (including renamed worktrees). Third-party dependencies such as Quack/PyTorch and the Context repository do not clutter the picker.

Four clickable rows stay above the files: **Repository**, **Mode**, **Base**, and **Compare**. Click a row or its edit icon to change only that selection; it immediately refreshes the comparison. Base/Compare pickers include branches, tags, recent commits and custom revisions. The repository selector is explicit when clicked, rather than reopening on every action.

- **Branch / PR Mode** toggles tip-to-tip and merge-base comparisons with one click. Returning from Commit Mode restores the previous branch pair and its mode.
- **Commit Mode** opens the last selected commit (initially the current Compare revision/HEAD) against its first parent without a wizard. Click the **Commit** row (or the Commit Mode toolbar button again) for a searchable list of SHA, title, author and date, with older-history pagination and custom SHA input. The row also shows the selected title. Its left/right arrows move to the previous (older) / next (newer) entry in that pinned history, disabled at either end; merge histories use topological log order, not an arbitrary child selection. Base still follows the selected commit’s first parent. Initial commits compare with empty. Selecting an explicit Base leaves first-parent mode and uses an ordinary revision comparison.
- State is remembered per repository, separately for branch and commit modes. Refresh resolves references again; an already displayed diff keeps its immutable hashes. Local remote-tracking refs reflect the last fetch; no automatic fetch occurs.
- Folders start collapsed. **Expand All Folders** and **Collapse All Folders** change only the tree, never open diffs or load code. Folder rows aggregate descendant file counts and added/deleted lines; binary entries are counted separately.
- Click a file for one native preview diff. The inline copy button now copies the **Compare-side absolute path**. Right-click retains relative-path copying and open-working-file actions.
- For linked worktrees in the same Git repository, comparisons work across their committed branches/commits. Absolute paths prefer the worktree actually checked out at the Compare revision. If no worktree matches, the current workspace path is copied with an explicit notice. A checkout can contain local edits: these paths locate files for an agent, not immutable historical content. Deleted paths need not currently exist; renamed entries copy the new path.
- Uncommitted/untracked changes, differences between arbitrary unrelated repositories, and live worktree-to-worktree dirty changes are excluded.

## Language support and limits

Historical files use the built-in Git extension's `git:` documents and normal diff editor. Existing syntax highlighting and language support continue to apply; Pylance virtual-document support depends on its version/settings. Cross-file definitions may refer to the current workspace, not a complete historical environment. This extension does not promise historical semantic isolation.

Binary files use VS Code's native diff behavior; they are not decoded into a custom text viewer. Submodule entries are not expanded into a nested repository comparison. Large single-file diffs can still be expensive; this design removes the simultaneous multi-file editor workload, not all editor costs. Git operations have a 30-second timeout and 32 MiB metadata limit. Only trusted, disk-backed Git workspaces are supported. No proposed APIs are used.

## Develop and package

No runtime npm dependencies or build step. Run `node --test test/git.test.js`. `test/extension-host.js` exports a VS Code Extension Host integration runner and uses a disposable Magi repository created with `node test/create-fixture.js` (the printed JSON identifies its root and linked feature worktree). It checks lazy opening, clipboard/worktree paths, controls/mode persistence, folder stats/folding, stale-request protection, added/deleted sides, and unchanged Git status; run it in isolated user-data and extension directories.

Run `npm run package:vsix` in this package. It uses the pinned packaging tool and writes `dist/kian-code-review-<version>.vsix`; this ignored directory is the fixed local artifact location, not Downloads. Install the resulting VSIX with **Extensions: Install from VSIX…**. For SSH/Dev Containers install it **in the remote environment**, because Git and repository files live there. Reload that window if VS Code requests it.

Source lives in Kian; generated VSIX and raw test logs remain outside Git.

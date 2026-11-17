# Kian Review

A small VS Code extension for branch and commit review. It displays only paths and line counts until you click a file, then opens **one native, read-only diff**. It does not use the multi-diff editor, run a web server, fetch, checkout, stage, or commit.

## Use

Open Source Control (`Cmd+Shift+G`) and find **Kian Review**, or run **Kian Review: Show Review**. The current workspace repository is selected automatically. Repository choices are limited to Magi-family repositories, Odin and Magicore, recognized by folder name or Git remote (including renamed worktrees). Third-party dependencies such as Quack/PyTorch and the Context repository do not clutter the picker.

The responsive workbench uses a horizontal **Repository / Mode / Base / Compare (or Commit)** toolbar. Click a selection to change only that reference; use the mode menu to switch directly. Base/Compare pickers include branches, tags, recent commits and custom revisions. Repository selection is explicit rather than reopening on every action.

On a wide bottom panel, **History** stays left, **Changed files** occupies the center, and a collapsible **Details** pane shows the target commit's full message, author, timestamp, parent hashes, actual comparison base and worktree path. Each pane scrolls independently. Narrow views stack these regions; the details toggle, scroll positions and open folders survive hiding/reopening the view. There is no separate server or browser port.

- **Branch / PR Mode** toggles tip-to-tip and merge-base comparisons with one click. Returning from Commit Mode restores the previous branch pair and its mode.
- **History** shows SHA, title, author and date with a simple trace and merge markers. Branch mode lists commits reachable from Compare but not from the actual comparison base. Click an entry to review that commit; returning to branch mode restores the previous branch pair. Commit mode shows the pinned history with the current entry highlighted. Search filters loaded entries; **Load older commits** appends another 200 entries. This is a topological list, not a complete branch graph.
- **Commit Mode** opens the last selected commit (initially the current Compare revision/HEAD) against its first parent without a wizard. The visible toolbar **← / →** buttons move to older/newer entries in that history and are disabled at either end. Click **Commit** for the searchable native picker or custom SHA input. Base follows the selected commit's first parent; initial commits compare with empty. Selecting an explicit Base leaves first-parent mode and uses an ordinary revision comparison.
- State is remembered per repository, separately for branch and commit modes. Refresh resolves references again; an already displayed diff keeps its immutable hashes. Local remote-tracking refs reflect the last fetch; no automatic fetch occurs.
- Folders start collapsed. **Expand All Folders** and **Collapse All Folders** change only the tree, never open diffs or load code. Folder rows aggregate descendant file counts and added/deleted lines; individual binary files are marked. File search filters paths and updates folder totals.
- Click a file for one native preview diff. Its three small buttons copy the **Compare-side absolute path**, copy the relative path, or open the physical working file; hover for labels. Native editor context menus remain available inside the opened diff.
- For linked worktrees in the same Git repository, comparisons work across their committed branches/commits. Absolute paths prefer the worktree actually checked out at the Compare revision. If no worktree matches, the current workspace path is copied with an explicit notice. A checkout can contain local edits: these paths locate files for an agent, not immutable historical content. Deleted paths need not currently exist; renamed entries copy the new path.
- Uncommitted/untracked changes, differences between arbitrary unrelated repositories, and live worktree-to-worktree dirty changes are excluded.

## Language support and limits

Historical files use the built-in Git extension's `git:` documents and normal diff editor. Existing syntax highlighting and language support continue to apply; Pylance virtual-document support depends on its version/settings. Cross-file definitions may refer to the current workspace, not a complete historical environment. This extension does not promise historical semantic isolation.

Binary files use VS Code's native diff behavior; they are not decoded into a custom text viewer. Submodule entries are not expanded into a nested repository comparison. Large single-file diffs can still be expensive; this design removes the simultaneous multi-file editor workload, not all editor costs. Git operations have a 30-second timeout and 32 MiB metadata limit. Only trusted, disk-backed Git workspaces are supported. No proposed APIs are used.

## Develop and package

No runtime npm dependencies or build step. Run `node --test test/git.test.js`. `test/extension-host.js` exports a VS Code Extension Host integration runner using a disposable Magi repository created with `node test/create-fixture.js` (the printed JSON identifies its root and linked feature worktree). It checks the real webview renderer, filtering/folding/detail toggle, commit selection/navigation, host message validation, lazy diff opening, clipboard/worktree paths, state restoration, stale-request protection and unchanged Git status. Its DOM probe is injected only in the isolated test webview, never packaged. Run it in isolated user-data and extension directories.

Run `npm run package:vsix` in this package. It uses the pinned packaging tool and writes `dist/kian-code-review-<version>.vsix`; this ignored directory is the fixed local artifact location, not Downloads. Install the resulting VSIX with **Extensions: Install from VSIX…**. For SSH/Dev Containers install it **in the remote environment**, because Git and repository files live there. Reload that window if VS Code requests it.

Source lives in Kian; generated VSIX and raw test logs remain outside Git.

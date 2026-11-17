# Kian Review

A VS Code workbench for branch, commit and PR review. It displays metadata until you click a file, then opens **one native, read-only diff**. It does not use the multi-diff editor, run a web server, checkout, stage or commit. Review state and private questions are saved outside the repository.

## Use

Editing a private question opens its original code revision and line, expands the native inline comment editor, and supports multiline text. Save Locally updates the existing question; Cancel Editing discards the draft. The original anchor and resolved state are preserved. Editing does not post or change comments on GitHub.

Each question shows its original creation date/time, including seconds, in the computer's local time zone. Text edits made from this version also show the latest edit time; canceling, saving unchanged text or resolving does not change it. Hover for the time zone and original UTC timestamp. Existing creation times are displayed, but past edit times are not reconstructed.

Mode labels stay compact in every language: **PR**, **Branch Diff**, and **Commit Diff**. Hover over the mode selector for the comparison rule.

Commit Diff shows the pinned history's source branch/revision in a separate line below the toolbar, with ellipsis for long names and the full name on hover. Base shows the actual parent SHA (or Empty tree for a root commit). A source label identifies the history being browsed, not a unique branch owning that commit.

Overlapping view updates are coalesced; unchanged background checks do not redraw the view. Commit details are reused while their immutable revision is unchanged. The Kian Review output channel records comparison duration and snapshots taking over 500 ms, to help distinguish Git work from view loading.

Open Source Control (`Cmd+Shift+G`) and find **Kian Review**, or run **Kian Review: Show Review**. The current workspace repository is selected automatically. Repository choices are limited to Magi-family repositories, Odin and Magicore, recognized by folder name or Git remote (including renamed worktrees). Third-party dependencies such as Quack/PyTorch and the Context repository do not clutter the picker.

The responsive workbench uses a horizontal **Repository / Mode / Base / Compare (or Commit)** toolbar. Click a selection to change only that reference; use the mode menu to switch directly. Base/Compare pickers include branches, tags, recent commits and custom revisions. Repository selection is explicit rather than reopening on every action.

On a wide bottom panel, **History** stays left, **Changed files** occupies the center, and the right pane switches between **Private questions** and commit **Details**. Both side panes can be hidden. Each region scrolls independently. Narrow views stack these regions; toggles, scroll positions and open folders survive hiding/reopening the view. There is no separate server or browser port.

- **Branch / PR Mode** toggles tip-to-tip and merge-base comparisons with one click. Returning from Commit Mode restores the previous branch pair and its mode.
- **History** shows SHA, title, author and date with a simple trace and merge markers. Branch mode lists commits reachable from Compare but not from the actual comparison base. Click an entry to review that commit; returning to branch mode restores the previous branch pair. Commit mode shows the pinned history with the current entry highlighted. Search filters loaded entries; **Load older commits** appends another 200 entries. This is a topological list, not a complete branch graph.
- **Commit Mode** opens the last selected commit (initially the current Compare revision/HEAD) against its first parent without a wizard. The visible toolbar **← / →** buttons move to older/newer entries in that history and are disabled at either end. Click **Commit** for the searchable native picker or custom SHA input. Base follows the selected commit's first parent; initial commits compare with empty. Selecting an explicit Base leaves first-parent mode and uses an ordinary revision comparison.
- State is remembered per repository, separately for branch and commit modes. Refresh resolves references again; an already displayed diff keeps its immutable hashes. Local remote-tracking refs reflect the last fetch. A connected PR's explicit Refresh can fetch missing objects without moving local branches or checking out files.
- Folders start collapsed. **Expand All Folders** and **Collapse All Folders** change only the tree, never open diffs or load code. Folder rows aggregate descendant file counts and added/deleted lines; individual binary files are marked. File search filters paths and updates folder totals.
- Click a file for one native preview diff. Its three small buttons copy the **Compare-side absolute path**, copy the relative path, or open the physical working file; hover for labels. Native editor context menus remain available inside the opened diff.
- For linked worktrees in the same Git repository, comparisons work across their committed branches/commits. Absolute paths prefer the worktree actually checked out at the Compare revision. If no worktree matches, the current workspace path is copied with an explicit notice. A checkout can contain local edits: these paths locate files for an agent, not immutable historical content. Deleted paths need not currently exist; renamed entries copy the new path.
- Uncommitted/untracked changes, differences between arbitrary unrelated repositories, and live worktree-to-worktree dirty changes are excluded.

### File filters

**Include files** and **Exclude files** accept comma-separated OR conditions; exclusions win, and a blank include matches everything. Both the new and old paths of renamed files are checked. Defaults are case insensitive:

| Input | Meaning |
| --- | --- |
| `attention, comm/` | Path contains either substring |
| `*.py, *.{cu,cpp}` | Python, CUDA or C++ files at any depth |
| `src/**` | Anything below a `src` path segment |
| `src/*.py` | Python files directly in `src` |
| Exclude `tests/**, docs/**` | Remove matching test and documentation paths |

Toggle **`.*`** to interpret both fields as regular expressions, e.g. include `(^|/)(attention|comm)/`, exclude `test_.*\.py$`. Commas outside groups are still OR separators; commas in `{1,3}`, `[a,b]` and `(a,b)` stay inside their expression. Use `\,` for a literal comma in regex mode, or quote a comma-containing filename in normal mode. This is a small glob subset (`*`, `**`, `?`, `{a,b}`), not every VS Code search feature. Invalid patterns display an error and use the last valid predicate against the current comparison. Folder totals and the reviewed lane use the same filter. Inputs and regex mode survive hiding/reopening the view; the toolbar filter action focuses Include files.

## File review and private questions

- Click the circle before a file to mark it **reviewed**. It leaves the unread tree and enters the collapsed **Reviewed files** lane; uncheck there to restore it. Acknowledgements belong to the logical repository/reference pair and comparison mode. A single-commit acknowledgement does not silently approve the full PR file.
- Review freshness compares each file's base/target Git object IDs, modes, paths and change type. A new commit that only touches other files preserves the check. A changed base or target for this file clears it and shows **Δ**. Click Δ for the target changes **Since last review**, or click the filename for the **Full comparison**. When only the base or metadata changed, use the full comparison; there is no new target text to show.
- The acknowledged target blob is cached in the extension's private storage, so the incremental baseline survives a force-push/rebase and loss of the old Git commit. Acknowledge the new version to advance that baseline. Reviewed targets, including deletions/renames, retain their exact original identities; this is a snapshot diff, not automatic attribution of which old hunks a person understood.
- In a Kian native diff, use the line gutter **+**, or select code and run **Add Private Question at Selection**. **Save Locally** creates a private prompt, not a GitHub pending comment. In the native private-comment input, **Enter saves locally** and **Shift+Enter inserts a newline**, even when suggestions are visible. Enter still completes active IME composition before saving. This binding does not affect code editors or other comment providers. The right **Private questions** tab supports opening the original anchor, editing, resolve/reopen, and showing resolved items. Questions are shared when switching between that branch review and its individual commits; anchors keep side, original revision and line range.
- **Copy prompts** copies unresolved questions as Markdown items with absolute paths, one-based line ranges, sides and revision IDs. Resolved items remain in storage but are excluded. Local resolve does not resolve a GitHub discussion. Storage is private to this VS Code user/profile on the machine running the extension; it is not automatically synced to Contexts, Git, other machines, or GitHub. Cached acknowledged blobs and notes are outside the worktree; no automatic cache deletion is performed.

## Update checks and optional GitHub comments

Visible branch reviews check local references every 30 seconds, preserve the displayed snapshot, and show a refresh banner when a reference moved. Without a connected PR this cannot detect remote pushes before a fetch. Click **PR** to connect a `github.com/.../pull/N` URL, using VS Code's GitHub sign-in. The repository is checked against local remotes. A connected visible review checks the PR head/base on GitHub; explicit Refresh fetches missing objects through existing Git credentials and updates the comparison. It does not move a local branch, reset files or poll while the view is hidden. Commit mode remains pinned rather than continuously advancing. Manually selecting different references or swapping sides disconnects the PR binding.

Private prompts are never posted automatically. **Submit to GitHub…** previews the exact note and destination and requires an explicit confirmation. A current anchor in the PR patch becomes an inline PR comment; outdated, incremental-only or out-of-patch anchors require explicit publication as a general PR comment instead. No approve/request-changes action is issued. A PR that changes during confirmation is rejected until refreshed. Failed writes retain the local question; a hidden note ID allows a subsequent attempt to find an already accepted comment after a lost response rather than duplicate it. Published receipts stay local. HTTP(S) proxy settings use VS Code `http.proxy` or standard proxy environment variables; TLS verification stays enabled. API tokens are obtained from VS Code authentication and are not saved in review JSON or command arguments.

## Language support and limits

Historical files use the built-in Git extension's `git:` documents and normal diff editor. Existing syntax highlighting and language support continue to apply; Pylance virtual-document support depends on its version/settings. Cross-file definitions may refer to the current workspace, not a complete historical environment. This extension does not promise historical semantic isolation.

Binary files use VS Code's native diff behavior; they are not decoded into a custom text viewer. Submodule entries are not expanded into a nested repository comparison. Large single-file diffs can still be expensive; this design removes the simultaneous multi-file editor workload, not all editor costs. Git operations have a 30-second timeout per attempt and 32 MiB metadata limit. A read that times out retries once; invalid revisions and other Git errors do not retry. Failures keep the previous comparison and restore the displayed mode. The Kian Review output channel records the repository, command, elapsed time, exit code/signal, timeout status and attempt count. Only trusted, disk-backed Git workspaces are supported. No proposed APIs are used.

## Develop and package

No runtime npm dependencies or build step. Run `node --test test/git.test.js`. `test/extension-host.js` exports a VS Code Extension Host integration runner using a disposable Magi repository created with `node test/create-fixture.js` (the printed JSON identifies its root and linked feature worktree). It checks the real webview renderer, filtering/folding/detail toggle, commit selection/navigation, host message validation, lazy diff opening, clipboard/worktree paths, state restoration, stale-request protection and unchanged Git status. Its DOM probe is injected only in the isolated test webview, never packaged. Run it in isolated user-data and extension directories.

Run `npm run package:vsix` in this package. It uses the pinned packaging tool and writes `dist/kian-code-review-<version>.vsix`; this ignored directory is the fixed local artifact location, not Downloads. Install the resulting VSIX with **Extensions: Install from VSIX…**. For SSH/Dev Containers install it **in the remote environment**, because Git and repository files live there. Reload that window if VS Code requests it.

Source lives in Kian; generated VSIX and raw test logs remain outside Git.

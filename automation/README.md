# Portable Kian Automation

This directory packages the GitHub-to-Feishu monitor, PR description manager, reminders, file transfer helper, QR publisher, Feishu bridge, and macOS `launchd` integration without storing private runtime data in Git.

## Private/runtime boundary

The repository contains code, templates, and placeholder-only examples. The default private home is `~/.config/kian-automation` (override with `KIAN_AUTOMATION_HOME`):

- `config/config.json`: credentials, repository list, SSH aliases, paths, and service settings; mode `600`.
- `state/`: monitor checkpoints, managed PR records, connection health, and reminder state.
- `logs/`: service output.

Never commit private configuration, state, logs, tokens, Feishu IDs, machine addresses, user names, absolute personal paths, or SSH configuration. Keep `~/.ssh/config` and private keys outside the repository. State migration is optional; omit it for a clean start.

## Information to collect on a new Mac

Ask the operator specifically for:

1. Feishu app ID, app secret, notification recipient open ID, and every allowed user's open ID.
2. GitHub repositories as `owner/repo` and a token per owner.
3. Optional summarization API key and model.
4. Which services to enable: `bridge`, `realtime`, `daily`, and `qr`, plus schedules.
5. File-transfer download directory, friendly machine names, SSH config aliases, and optional path-prefix mappings. Do not ask for passwords or private keys in chat.
6. For QR publishing: local clone directory, repository-relative target image, branch, commit message, and reminder text.
7. Whether to copy old JSON state files into the new private `state/` directory.

## Feishu and GitHub setup

In Feishu Open Platform, enable long-connection event delivery and subscribe to:

- `im.message.receive_v1`
- `card.action.trigger`

Grant the app the message receive/send permissions needed by those events, publish the app version, and add the app to the target chat where applicable.

Use a fine-grained GitHub token restricted to the configured repositories when possible. Monitoring requires repository metadata, issues, pull requests, comments, and contents read access. PR description updates additionally require pull-request write access. Classic tokens generally need `repo` for private repositories or `public_repo` for public-only access.

## Install

1. Install Node.js, Python 3, Git, rsync, and optionally pnpm.
2. Clone this repository to a stable location.
3. Run `automation/bin/install.sh`. The first run creates the private directories and copies the example only when no private config exists.
4. Edit `~/.config/kian-automation/config/config.json`, replacing the values required by each enabled service. Placeholders may remain in disabled or unused optional features. Keep QR disabled if unused. `bridge`, `realtime`, and `daily` are enabled by default in the example; QR is disabled. Summarization is optional; without an API key the monitor uses a deterministic local summary.
5. Run the installer again. It installs bridge dependencies, renders `~/Library/LaunchAgents/com.kian.{bridge,realtime,daily,qr}.plist`, validates them, and reloads enabled services. If placeholders remain, it safely renders but does not load services.
6. Run `automation/bin/doctor.sh`.

The installer preserves an existing private config. Service enablement and schedules come from `services` in that config.
Dependency installation explicitly ignores inherited desktop proxy settings, which prevents a stopped local proxy application from breaking bootstrap.

## Verify and operate

`doctor.sh` checks macOS, Node/Python, JSON validity, reports unresolved placeholder counts, config permissions, runtime directories, plist validity, launchd registration, and log presence without printing secrets. The installer validates required fields separately for each enabled service.

Manual non-sending checks can use Python compilation and Node syntax validation. Running monitor/reminder commands may send real Feishu messages. File transfer usage is:

- `python3 automation/scripts/file_transfer.py local-file example-machine:/remote/path`
- Add `--into-dir` when the destination is a directory.

Remote endpoints use private SSH config aliases. Remote-to-remote copies stage through a local temporary directory and verify files by size and SHA-256.

QR publication is explicit: `python3 automation/scripts/qr_update_publish.py /absolute/path/to/image`. It copies the image, commits if changed, clears proxy variables, pushes the configured branch, marks the reminder complete only after a successful push, and sends a receipt.

## Upgrade

Pull the new repository code, review example/schema changes without overwriting the private config, then rerun `automation/bin/install.sh` and `automation/bin/doctor.sh`. The repository can move only if the installer is rerun, because rendered plists contain the repository location. Alternatively set `KIAN_REPO_ROOT` when launching the bridge manually.

## Uninstall

Run `automation/bin/uninstall.sh`. It unloads and removes only the four managed plist files. It intentionally preserves private config, state, and logs. Delete `~/.config/kian-automation` manually only after making any desired backup.

## Optional state migration

After stopping old services, copy only required JSON checkpoints into `~/.config/kian-automation/state/`, for example monitor state, daily stamp, managed PRs, QR reminder state, or bridge connection state. Do not copy old configs or logs. Set private files to mode `600`, rerun the installer, and validate with the doctor.

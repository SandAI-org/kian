---
name: self-management
description: Manage and update the current Kian app configuration, including global app preferences and workspace settings such as model providers, shortcuts, chat channels, MCP servers, and related runtime behavior. Use when the user wants to change how Kian itself works rather than editing a project.
---

# Self Management

Use this skill when the task is to change Kian itself: app preferences, workspace path, model or provider settings, chat integrations, MCP servers, shortcuts, or other persisted settings.

## When to Use

- The user asks to modify Kian settings, preferences, integrations, or model configuration.
- The user wants to inspect why Kian is using a certain provider, model, shortcut, or chat channel setting.
- The task targets Kian's own config files rather than files inside a project workspace.

## Configuration Files

- Read [references/config-files.md](references/config-files.md) before editing so the file path, on-disk shape, and supported values match the current implementation.
- The main config lives in two places:
  - Global config: the user config directory (`~/.kian/config.json` in packaged builds, `~/.kian-dev/config.json` in dev builds).
  - Workspace settings: `<workspaceRoot>/.kian/settings.json`.
- Legacy `<workspaceRoot>/settings.json` is migration input only. Do not write to it.

## Safe Workflow

1. Locate the active config files from the existing environment instead of guessing.
2. Read the current file first and make the smallest change that satisfies the request.
3. Preserve unrelated keys, secrets, ids, and timestamps unless the user explicitly asked to rotate or remove them.
4. Keep JSON valid: no comments, no trailing commas, no partially written structures.
5. Re-read the edited file and verify the requested value is present in a supported format.
6. If `workspaceRoot` changed, tell the user a restart is usually required because many services resolve the workspace path at startup.

## Capability Boundaries

- Only promise changes that match the current implementation and schemas in [references/config-files.md](references/config-files.md).
- Do not claim that `mainSubModeEnabled` can be disabled. The current implementation always normalizes it to `true`.
- Do not invent new config sections, provider ids, shortcut actions, or MCP transport types.
- For `mcpServers`, preserve `id` and `createdAt` on edits; only update the fields the user requested and refresh `updatedAt`.
- For shortcuts, edit only the six supported actions in the current schema.
- For provider or chat-channel secrets, keep the existing secret intact if the user asked to change another field only.

## Validation Checklist

- The target file is the correct active config file.
- The JSON parses successfully after the edit.
- Arrays such as `enabledModels`, `args`, `userIds`, `serverIds`, and `channelIds` are still arrays of strings.
- Map-like fields such as `env` and `headers` remain string-to-string objects.
- Required nested objects under `shortcuts` and `chatChannels` are still present.

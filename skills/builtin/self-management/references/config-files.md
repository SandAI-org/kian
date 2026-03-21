# Config Files

Use this reference whenever you need the real on-disk shape of Kian's current configuration.

## File Discovery

- Global config path comes from `electron/main/services/workspacePaths.ts`.
- Packaged builds use `~/.kian/config.json`.
- Dev builds use `~/.kian-dev/config.json`.
- When working in a live environment, inspect both locations first and edit the one that already exists and is in use.
- `workspaceRoot` comes from the global config. If the global config is missing or invalid, the fallback is `~/KianWorkspace`.
- Workspace settings live at `<workspaceRoot>/.kian/settings.json`.
- Legacy `<workspaceRoot>/settings.json` may still exist as migration input. Never write new settings there.

## Global Config Shape

This file stores app-wide preferences. The current persisted shape is:

```json
{
  "workspaceRoot": "/absolute/path/to/workspace",
  "language": "zh-CN",
  "themeMode": "system",
  "linkOpenMode": "builtin",
  "quickGuideDismissed": false,
  "chatInputShortcutTipDismissed": false
}
```

Supported values:

- `language`: `zh-CN` | `en-US` | `ko-KR` | `ja-JP`
- `themeMode`: `system` | `light` | `dark`
- `linkOpenMode`: `builtin` | `system`

Important notes:

- `mainSubModeEnabled` exists in the DTO, but the current implementation always returns `true` and does not persist it to disk.
- Changing `workspaceRoot` usually requires restarting the app to fully apply, because many services capture the workspace path at startup.

## Workspace Settings Shape

`<workspaceRoot>/.kian/settings.json` stores runtime settings for providers, model selection, shortcuts, chat channels, and MCP servers.

Minimal valid shape:

```json
{
  "providers": [],
  "mediaProviders": [
    {
      "provider": "fal",
      "enabled": false,
      "apiKey": "",
      "customModels": [],
      "enabledModels": []
    }
  ],
  "lastSelectedModelByScope": {},
  "lastSelectedThinkingLevelByScope": {},
  "shortcuts": {
    "sendMessage": {
      "code": "Enter",
      "key": "Enter",
      "metaKey": false,
      "ctrlKey": false,
      "altKey": false,
      "shiftKey": false
    },
    "insertNewline": {
      "code": "Enter",
      "key": "Enter",
      "metaKey": false,
      "ctrlKey": false,
      "altKey": false,
      "shiftKey": true
    },
    "focusMainAgentInput": {
      "code": "KeyH",
      "key": "h",
      "metaKey": true,
      "ctrlKey": false,
      "altKey": false,
      "shiftKey": false
    },
    "openSettingsPage": {
      "code": "Comma",
      "key": ",",
      "metaKey": true,
      "ctrlKey": false,
      "altKey": false,
      "shiftKey": false
    },
    "newChatSession": {
      "code": "KeyN",
      "key": "n",
      "metaKey": true,
      "ctrlKey": false,
      "altKey": false,
      "shiftKey": false
    },
    "quickLauncher": {
      "code": "KeyK",
      "key": "k",
      "metaKey": true,
      "ctrlKey": false,
      "altKey": false,
      "shiftKey": true
    }
  },
  "mcpServers": [],
  "chatChannels": {
    "telegram": {
      "enabled": false,
      "botToken": "",
      "userIds": [],
      "lastUpdateId": 0
    },
    "discord": {
      "enabled": false,
      "botToken": "",
      "serverIds": [],
      "channelIds": []
    },
    "feishu": {
      "enabled": false,
      "userIds": [],
      "appId": "",
      "appSecret": ""
    },
    "broadcastChannels": []
  }
}
```

## Editing Rules By Section

- `providers`
  - Agent providers live here.
  - Each entry uses `provider`, `enabled`, `apiKey`, `customModels`, `enabledModels`, and optionally `displayName`, `baseUrl`, and `api`.
  - For custom providers, usable configuration requires `baseUrl`, `api`, and at least one `customModels` entry. `apiKey` may be empty for no-auth backends.
  - `enabledModels` should only contain ids that exist for that provider after normalization.

- `mediaProviders`
  - Currently only `fal` is supported.
  - If the file is missing `mediaProviders`, runtime normalization will seed a `fal` entry automatically.
  - Keep `provider: "fal"` and use string model ids in `enabledModels`.

- `lastSelectedModel` and `lastSelectedModelByScope`
  - Main scope reads `lastSelectedModelByScope.main` first, then falls back to `lastSelectedModel`.
  - If you manually change the main scope model, update both values to the same `<provider>:<modelId>` string.
  - Project scope keys use `project:<projectId>`.

- `lastSelectedThinkingLevel` and `lastSelectedThinkingLevelByScope`
  - Supported values are `low`, `medium`, and `high`.
  - If you manually change the main scope thinking level, update both the top-level field and `lastSelectedThinkingLevelByScope.main`.

- `shortcuts`
  - Only these six actions are supported: `sendMessage`, `insertNewline`, `focusMainAgentInput`, `openSettingsPage`, `newChatSession`, `quickLauncher`.
  - Each shortcut is a `KeyboardShortcutDTO` with `code`, `key`, `metaKey`, `ctrlKey`, `altKey`, and `shiftKey`.

- `chatChannels.telegram`
  - Keys: `enabled`, `botToken`, `userIds`, `lastUpdateId`.
  - Keep `lastUpdateId` non-negative.

- `chatChannels.discord`
  - Keys: `enabled`, `botToken`, `serverIds`, `channelIds`.

- `chatChannels.feishu`
  - Keys: `enabled`, `userIds`, `appId`, `appSecret`.
  - Preserve `userIds` even if the current settings UI did not ask to change them.

- `chatChannels.broadcastChannels`
  - Each entry uses string `id`, `name`, `type`, and `webhook`.
  - Supported `type` values: `feishu` | `wechat`.
  - Preserve existing ids when editing; generate a new positive integer string only for newly created entries.

- `mcpServers`
  - Each entry uses `id`, `name`, `transport`, `enabled`, `command`, `args`, `cwd`, `env`, `url`, `headers`, `createdAt`, and `updatedAt`.
  - Supported `transport` values: `stdio` | `sse` | `streamable-http`.
  - `env` and `headers` must stay as string-to-string maps.
  - When editing an existing server, keep `id` and `createdAt`; refresh `updatedAt`.

## Write Discipline

- Preserve unrelated settings whenever possible.
- Keep secret fields as plain strings; do not replace them with placeholders unless the user asked to remove them.
- Re-open the edited JSON and verify it still parses cleanly.

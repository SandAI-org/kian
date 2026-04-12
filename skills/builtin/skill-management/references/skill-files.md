# Skill Files

Use this reference when managing Skills directly on disk.

## Active Paths

- Installed Skills root: `<GlobalWorkspaceRoot>/.kian/skills/installed`
- Skills config file: `<GlobalWorkspaceRoot>/.kian/skills.json`
- Repository cache root: `<GlobalConfigDir>/cache/skill-repositories`
- Builtin Skill source root inside the app: `skills/builtin`

`<GlobalWorkspaceRoot>` comes from the active global config. In the current implementation, the internal runtime root is `<GlobalWorkspaceRoot>/.kian`.

## Repository Rules

- Only GitHub repositories are supported.
- Accept either `owner/repo` or a full GitHub URL.
- Normalize every accepted GitHub repository to `https://github.com/<owner>/<repo>`.
- Reject non-GitHub hosts.
- For inspection and installation, work from a temporary clone or a temporary extracted GitHub archive rather than editing directly inside the installed Skills directory.

## Skill Discovery

- A Skill is any directory that contains `SKILL.md`.
- Discover Skills by recursively walking directories and skipping hidden directories whose names start with `.`.
- If a directory contains `SKILL.md`, treat that directory as the Skill root and do not keep walking below it.

## Installed Directory Layout

Each installed Skill lives under:

```text
<GlobalWorkspaceRoot>/.kian/skills/installed/<sanitized-skill-name>/
  SKILL.md
  .skill.json
  ...other bundled files...
```

The installed directory name is derived from the Skill name with this sanitization:

- replace characters invalid in file names with `-`
- collapse whitespace to `-`
- collapse repeated `-`
- trim leading and trailing `-`
- fallback to `skill` if the result is empty

## `.skill.json` Schema

Each installed Skill metadata file has this shape:

```json
{
  "id": "https://github.com/owner/repo::skill-path",
  "name": "skill-name",
  "repositoryUrl": "https://github.com/owner/repo",
  "skillPath": "skill-path",
  "installedAt": "2026-03-09T00:00:00.000Z",
  "mainAgentVisible": true,
  "projectAgentVisible": true
}
```

Builtin skills use:

```json
{
  "repositoryUrl": "builtin://kian"
}
```

## Install Rules

1. Normalize the repository URL.
2. Normalize the `skillPath` to POSIX separators and reject empty paths or any path containing `.` or `..` segments.
3. Derive the Skill name from `basename(skillPath)`.
4. Resolve the target installed directory from the sanitized Skill name.
5. If the target directory already exists with a different Skill `id`, stop and tell the user to uninstall the conflicting Skill first.
6. When reinstalling the same Skill, preserve the existing `installedAt` and visibility flags.
7. Copy the source Skill directory into the installed directory, but do not copy a source `.skill.json`.
8. Write the installed `.skill.json` with the normalized repository URL, normalized `skillPath`, and resolved visibility.
9. Add the normalized repository URL to `<GlobalWorkspaceRoot>/.kian/skills.json` if it is not already present.

## Default Visibility

- Read default visibility from the source Skill's `.skill.json` when it exists.
- If the source Skill has no `.skill.json`, default both `mainAgentVisible` and `projectAgentVisible` to `true`.

## Listing Installed Skills

- Enumerate directories under `<GlobalWorkspaceRoot>/.kian/skills/installed`.
- Read `.skill.json` from each directory.
- Prefer the installed `SKILL.md` front matter or heading for the displayed title and description.
- Include visibility state from `.skill.json`.

## Enable And Disable

- Enabling or disabling a Skill means editing `mainAgentVisible` and/or `projectAgentVisible` in the installed `.skill.json`.
- Preserve the other metadata fields exactly.

## Uninstall Rules

- Locate the installed Skill by `id`.
- If `repositoryUrl` starts with `builtin://`, do not uninstall it.
- Otherwise remove the entire installed Skill directory.

## Session Behavior

- Agent sessions load explicit Skill file paths when the session starts.
- Installing, uninstalling, or toggling visibility does not hot-reload the current session.
- A new session is required to pick up the changed Skill set.

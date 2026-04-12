---
name: skill-management
description: Manage Kian's installed Skills, including installing a skill from a GitHub repository, listing installed skills, enabling or disabling visibility, and uninstalling non-builtin skills. Use this when the task is to change which Skills an agent can use.
---

# Skill Management

Use this skill when the task is to manage Skills for Kian itself rather than to change project files.

## When to Use

- The user wants to install a Skill from a GitHub repository.
- The user wants to see which Skills are already installed.
- The user wants to enable, disable, or uninstall a Skill.
- The task changes the global Skill set available to agents.

## Read First

- Read [references/skill-files.md](references/skill-files.md) before making changes so the on-disk layout and install rules match the current implementation.
- Skills are global under `<GlobalWorkspaceRoot>/.kian`, not scoped to a single project.
- Builtin skills use `builtin://kian`; they can be enabled or disabled, but they must not be uninstalled.

## Workflow

1. Inspect the installed Skills first. Do not guess from memory.
2. For GitHub installs, normalize the repository URL to `https://github.com/<owner>/<repo>`.
3. Fetch the repository into a temporary location by cloning it or downloading the GitHub archive, then inspect that temporary copy.
4. Find candidate skill directories by recursively locating `SKILL.md`.
5. If the repository contains exactly one Skill and the user did not specify a path, install that Skill directly.
6. If the repository contains multiple Skills and the target is ambiguous, list the candidates and ask the user which one to install.
7. Preserve existing `installedAt`, `mainAgentVisible`, and `projectAgentVisible` values when reinstalling the same Skill.
8. If the user asks to enable or disable a Skill only for the current agent, change only the flag for the current scope and preserve the other one.
9. If the user asks to enable or disable a Skill for all agents, update both visibility flags explicitly.
10. Never uninstall a builtin Skill.

## Scope Mapping

- In the main agent, the current-scope flag is `mainAgentVisible`.
- In a project agent, the current-scope flag is `projectAgentVisible`.
- If the user says only "enable" or "disable" without a scope, prefer changing the current-scope flag only.

## After Changes

- Skill changes are picked up by new Agent sessions.
- The current conversation keeps the Skills that were loaded when the session started.
- If the user wants the updated Skill set immediately, use the `NewSession` tool after the change.

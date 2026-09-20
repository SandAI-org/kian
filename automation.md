# Kian 自动化恢复入口

新机器或新 Agent 接手时，先阅读本文件，再阅读 `automation/README.zh-CN.md`。

## 恢复常规服务

1. 拉取 `dev_kato` 分支并保持仓库位于稳定路径。
2. 运行 `automation/bin/install.sh`；它会创建私有运行目录，但不会覆盖已有私有配置。
3. 按 `automation/README.zh-CN.md` 配置 `~/.config/kian-automation/config/config.json`。凭据、SSH 配置、机器地址、个人路径、状态和日志不得提交到 Git。
4. 再运行一次安装器，然后运行 `automation/bin/doctor.sh`。

## VS Code Dev Container 会话迁移

迁移工具属于 Kian 常规自动化：

- Copilot：`automation/scripts/migrate_vscode_copilot_sessions_macos.py`
- Codex：`automation/scripts/migrate_codex_sessions_between_containers.sh`

只支持同一台商汤或 IDG 物理服务器、同一工作目录的新旧容器迁移。

### Copilot

Copilot 历史位于 macOS 本机 VS Code `workspaceStorage`。每个工作目录单独执行：

1. 用 `--source-container`、`--target-container`、`--remote-host`、`--workspace-dir` 和 `--dry-run` 预检。
2. 正式迁移前必须完全退出 VS Code；可使用 `--wait-for-vscode-exit`。
3. 脚本备份双方 workspaceStorage，只合并会话文件和 `chat.ChatSessionStore.index`，并改写 remote authority；不覆盖整个 `state.vscdb`。
4. 多个工作目录逐个迁移，不猜 workspace ID。

### Codex

Codex 历史位于远端容器 `/root/.codex`，对同一对容器只迁移一次：

1. 在 Docker 宿主机执行脚本；可从本机通过 SSH 标准输入传入脚本。
2. 先执行 `--dry-run`，确认两个容器映射到同一宿主机目录、源有历史且目标为空。
3. 目标非空时禁止覆盖或朴素合并。若源目标 thread ID 和 rollout SHA-256 完全相同，则视为已迁移，无需重复写入。
4. 正式迁移会保留目标认证与机器配置，备份双方 `/root/.codex`，迁移 thread/session 数据并校验 SQLite 与 rollout 引用。
5. 完成后在目标容器窗口执行 Reload Window。

SSH 密码、token 和私钥必须由用户直接在交互式终端输入，禁止写入命令、日志、脚本或 Git。

## 清理单个远程 workspace 的 Codex 冲突缓存

当某个服务器上的特定 VS Code workspace 再次提示 Codex 会话“已在另一个应用中打开”时，使用：

`automation/scripts/cleanup_vscode_codex_workspace_cache.py`

1. 用户必须明确给出 SSH host alias 和远端 workspace 路径。
2. 先不带 `--apply` 运行，只读确认脚本精确匹配到一个 `workspaceStorage` 数据库及待清理条目数。
3. 让用户只关闭该 workspace 对应的 VS Code 窗口；不需要关闭其他服务器或容器窗口。
4. 带 `--apply` 运行。脚本检测数据库未被占用后自动备份，只删除该 workspace 的 `openai-codex` 索引，保留真实 Codex 数据、Copilot/本地会话和其他 workspace。
5. 数据库完整性检查通过后，让用户重新打开该 VS Code 窗口。

示例：

`python3 automation/scripts/cleanup_vscode_codex_workspace_cache.py --host B300-idg35-1 --workspace /mnt/Sandai/kato/workspace/copilot/envs --apply`

## 诊断远程 VS Code workspace 卡顿

用户在卡顿发生时指定 SSH host、workspace 路径，以及 Dev Container 名称（如适用），运行：

`python3 automation/scripts/diagnose_vscode_remote.py --host <ssh-alias> --container <container> --workspace <path>`

诊断会在一个预热后的 SSH 会话内测量数据往返延迟，并采集远端 CPU/内存与 pressure、VS Code server/extension host 进程、最近一小时异常日志，以及 workspace 所在共享存储的元数据和 8 MiB 临时文件读写/fsync。临时文件无论成功失败都会清理。输出按证据将网络、远端资源、VS Code 进程和共享存储列为主要或次要根因；没有指标越过阈值时必须报告无法归因，并建议在卡顿当下复测。

容器 workspace 必须使用 `--container` 在容器内测量；不得用宿主机路径或进程替代。该命令不会重启、杀死或修改 VS Code 进程。

## 验证

运行：

- `python3 -m unittest automation/tests/test_migrate_vscode_copilot_sessions_macos.py automation/tests/test_migrate_codex_sessions_between_containers.py`
- `python3 -m unittest automation/tests/test_cleanup_vscode_codex_workspace_cache.py`
- `python3 -m unittest automation/tests/test_diagnose_vscode_remote.py`
- `bash -n automation/scripts/migrate_codex_sessions_between_containers.sh`

完整自动化说明、安装、升级和卸载流程见 `automation/README.zh-CN.md`。

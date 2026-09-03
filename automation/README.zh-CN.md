# 可迁移 Kian 自动化套件

本目录打包 GitHub 到飞书监控、PR 描述管理、提醒、文件传输、二维码发布、飞书桥接及 macOS `launchd` 集成，Git 中不保存私有运行数据。

## 私有数据边界

仓库仅保存代码、模板和占位符示例。默认私有目录为 `~/.config/kian-automation`，可用 `KIAN_AUTOMATION_HOME` 覆盖：

- `config/config.json`：凭据、仓库列表、SSH 别名、路径和服务设置，权限为 `600`。
- `state/`：监控检查点、受管理 PR、连接健康和提醒状态。
- `logs/`：服务输出。

绝不提交私有配置、状态、日志、token、飞书 ID、机器地址、用户名、个人绝对路径或 SSH 配置。`~/.ssh/config` 和私钥必须留在仓库外。状态迁移是可选的；不迁移即从全新状态开始。

## 新 Mac 上需要逐项询问的信息

应向使用者明确询问：

1. 飞书 app ID、app secret、通知接收人的 open ID，以及所有允许操作用户的 open ID。
2. `owner/repo` 格式的 GitHub 仓库列表，以及每个 owner 对应的 token。
3. 摘要后端。推荐的 `copilot_cli` 后端使用 GitHub Copilot 订阅和 OAuth 登录，不需要单独的模型 API key。
4. 启用哪些服务：`bridge`、`realtime`、`daily`、`qr`，以及各自调度时间。
5. 文件传输默认下载目录、机器简称、SSH config 别名及可选路径前缀映射。不要在聊天中索要密码或私钥。
6. 二维码发布所需的本地仓库目录、仓库内目标图片相对路径、分支、提交信息和提醒文案。
7. 是否将旧 JSON 状态复制到新的私有 `state/` 目录。

## 飞书与 GitHub 配置

在飞书开放平台启用长连接事件投递并订阅：

- `im.message.receive_v1`
- `card.action.trigger`

为应用授予这些事件所需的消息接收和发送权限，发布应用版本，并在需要时将应用加入目标群聊。

优先使用仅限配置仓库的 fine-grained GitHub token。监控需要仓库元数据、Issue、PR、评论及 Contents 的只读权限；更新 PR 描述还需要 Pull requests 写权限。Classic token 对私有仓库通常需要 `repo`，仅公开仓库可使用 `public_repo`。

## 安装

1. 安装 Node.js、Python 3、Git、rsync，以及可选的 pnpm。若希望不使用独立 API key 仍生成高质量 PR 描述，安装官方 GitHub Copilot CLI（`npm install -g @github/copilot` 或 `brew install --cask copilot-cli`），并执行一次 `copilot login`。
2. 将本仓库克隆到稳定位置。
3. 运行 `automation/bin/install.sh`。首次运行会创建私有目录，并且只在私有配置不存在时复制示例。
4. 编辑 `~/.config/kian-automation/config/config.json`，替换每个已启用服务必需的值。已禁用或未使用的可选功能可以保留占位符。不使用二维码时保持 QR 禁用。示例默认启用 `bridge`、`realtime`、`daily`，禁用 `qr`。使用 `summarization.backend: "copilot_cli"` 时，将 `command` 设置为 `command -v copilot` 返回的绝对路径；除非需要指定受支持模型，否则保留 `model: "auto"`。OAuth 凭据只保存在本机凭据存储中，不得复制进仓库。
5. 再次运行安装脚本。它会安装桥接依赖、渲染 `~/Library/LaunchAgents/com.kian.{bridge,realtime,daily,qr}.plist`、校验并重载启用的服务。若仍有占位符，只渲染而不会加载服务。
6. 运行 `automation/bin/doctor.sh`。

安装器不会覆盖已有私有配置。服务是否启用及调度参数均来自配置中的 `services`。
依赖安装会显式忽略继承的桌面代理设置，避免本地代理应用退出后留下的失效地址阻断初始化。
标准服务成功加载后，安装器会删除其旧版前身（`com.kian.copilot-bridge`、`com.kian.github-monitor`、`com.kian.github-monitor-daily` 或 `com.kian.reminder-qr`）。这可以防止新旧监控使用各自的状态文件，对同一 GitHub 更新重复推送。

PR manager 以无工具、无仓库访问、无 MCP、无自定义指令的非交互方式调用 Copilot CLI，只传入序列化后的最终 PR diff。由于 `launchd` 不继承交互式 shell 的 `PATH`，私有配置应使用 CLI 绝对路径。换新 Mac 或 OAuth 过期后，交互执行 `copilot login`，再重新运行安装脚本。旧的 `openrouter` 后端仍可用，但必须在私有配置中显式提供 `api_key` 和模型。
PR 描述的简略版只生成 2-4 条简短、合并同类项且聚焦结果的要点；默认版和完整版在有价值时仍保留实现与验证细节。

## 验证与使用

`doctor.sh` 检查 macOS、Node/Python、JSON 有效性、报告未替换占位符数量、配置权限、运行目录、plist 有效性、launchd 注册状态和日志是否存在，且不会打印秘密。安装器会针对每个已启用服务单独校验必填字段。

可用 Python 编译和 Node 语法检查进行不发送消息的验证。直接运行监控或提醒命令可能发送真实飞书消息。文件传输示例：

- `python3 automation/scripts/file_transfer.py local-file example-machine:/remote/path`
- 目标为目录时增加 `--into-dir`。

远端地址使用私有 SSH config 别名。远端到远端会经本机临时目录中转，并对文件执行大小和 SHA-256 校验。

遇到 VS Code Remote-SSH 主机缓存过旧导致无法连接时，可将复制的输出或不完整的 `vscode-ssh-host-<hash>` 片段传给 `python3 automation/scripts/cleanup_remote_ssh_cache.py '<粘贴的输出>'`。工具接受至少 8 位十六进制哈希，只会删除标准 Remote-SSH 缓存根目录下匹配的直接子目录，并报告实际删除项。完成后重新加载 VS Code 窗口再连接。

常规 wheel 镜像同步需在私有 `wheel_sync.profiles` 中定义 profile，然后运行 `python3 automation/scripts/sync_wheels.py <profile>`。每个配置的 dist 目录必须恰好包含一个 wheel，该文件直接视为当前稳定包，并与按 dist 顺序配置的 `expected_distributions` 一一对应。不再维护开发 profile 或版本锁定。正式传输前会比较源 wheel 与每个目标同名文件的 SHA-256，未变化的包不会下载、清理或上传；只有变化的 wheel 才暂存一次并更新需要更新的目标，因此同版本同文件名的重新构建也能正确识别。新 wheel 上传并校验成功后，才会清理该目标中同 distribution 的其他版本。

二维码发布需显式执行：`python3 automation/scripts/qr_update_publish.py /absolute/path/to/image`。脚本复制图片、有变化时提交、清除代理变量、推送配置分支，仅在 push 成功后标记提醒完成并发送回执。

## 升级

拉取仓库新代码，审阅示例和配置结构变化但不要覆盖私有配置，然后重新运行 `automation/bin/install.sh` 和 `automation/bin/doctor.sh`。仓库移动后必须重跑安装器，因为渲染后的 plist 包含仓库路径。手动启动桥接器时也可设置 `KIAN_REPO_ROOT`。

## 卸载

运行 `automation/bin/uninstall.sh`。它只卸载并删除四个受管理 plist，保留私有配置、状态和日志。确认备份后，如确实需要，再手工删除 `~/.config/kian-automation`。

## 可选状态迁移

先停止旧服务，再仅将需要的 JSON 检查点复制到 `~/.config/kian-automation/state/`，例如监控状态、每日发送标记、受管理 PR、二维码提醒状态或桥接连接状态。不要复制旧配置或日志。将私有文件权限设为 `600`，重跑安装器，再用 doctor 验证。

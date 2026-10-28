# 可迁移 Kian 自动化套件

## 按需清理 Magicore 镜像

非 commit 别名默认排除。用户明确授权具体别名后，逐项传 `--allow-alias <tag>`，在私有计划中记录该项 `commit: null`、排序时间戳及盘点时的 `expected_digest`。流程从镜像核对实际 Git HEAD，不再把别名当 commit 前缀；普通十六进制 commit tags 仍保留前缀校验。别名若指向已验证项原先完全相同的 digest，可通过 `reuse_tag` 核对原/新镜像身份后复用已验证 manifest/config/layers，覆盖后仍回拉验证。扩展计划保留原有进度与回执；别名在盘点后发生变化时不强制覆盖。

固定入口 `http://127.0.0.1:8767/` 现在是统一的“后台任务”页面，`/images` 保留镜像批次详情。每次调用 `file_transfer.py` CLI 都会自动在私有 `state/background-tasks/<uuid>.json` 登记任务。下载、上传和远端到远端中转同步展示阶段、重试、字节数、rsync 速度/预计时间及校验结果。单文件必须大小/SHA-256 校验通过才完成；目录只声明 rsync 检查，不宣称做过整树 SHA-256。目录百分比标注为当前文件，不编造总体进度。页面优先展示进行中任务，支持完成/异常筛选，每 5 秒刷新，可见最近 100 条记录；进度进程消失或 PID 被复用时显示“状态待确认”，不冒充成功，底层命令仍可能运行。记录原子写入、权限 600。

其他由本地 agent 编排的长任务可以直接复用 `background_tasks.BackgroundTask`：进入上下文自动登记，使用 `task.update(stage="running", progress_percent=25)` 更新；执行并验证成功后退出才记录完成，异常记录失败/中断。没有可靠总量时只更新阶段，不虚构百分比。独立远端任务需要像镜像批次一样的只读状态适配，不能从 Mac 进程退出推断远端任务完成。部署沿用已有 `image_cleanup_dashboard` 服务/配置名，不配置远端 host/state_dir 也能展示本地任务。以后 agent 发起文件传输应走自动登记的入口，其他长任务显式接入这个公共接口；用户只需固定链接，不需要每次要求建页或记命令。

需要可点击的实时进度页时，启用 `services.image_cleanup_dashboard.enabled`，配置 `image_cleanup_dashboard.host`、远端 `state_dir`，可选本地 `port`（8767）、`poll_seconds`（15）、`language`（`zh`/`en`）。常驻 LaunchAgent `com.kian.image_cleanup_dashboard` 提供 `http://127.0.0.1:8767/`，安装、doctor、卸载均包含该服务。只读 SSH 采集经过筛选的进度、当前阶段、最近完成项、异常及时间戳；连接失败保留上次快照并明确显示离线。页面每 10 秒刷新，不提供修改批次的接口，且仅绑定 Mac loopback。Mac 睡眠/断网会使页面不可访问或数据变旧，H200 后台清理仍继续；手机上的 localhost 不能访问这台 Mac 的页面。

`automation/scripts/cleanup_magicore_images.py` 在明确选定的 Docker 宿主机上运行，参数为 `--repository <registry/project/image> --plan <私有计划.json> --state-dir <私有状态目录>`；不带 `--apply` 仅显示从旧到新的计划。每项包含十六进制 `tag`、完整 `commit`、整数 `commit_time` 和对应 Git 的 `tracked_roots`。`--unresolved <私有tags.json>` 把暂未解析的 commit tags 放在已知日期项之后，从拉取镜像内核对 Git HEAD 与根目录清单，且 HEAD 必须匹配 tag；非 commit 别名不纳入。仅在用户授权覆盖后使用 `--workers 2 --apply`。

流程删除 `/workspace` 内属于对应 Magicore commit 的根目录项、`.git`、`Megatron-LM`、`Mooncake`，对其余内容（包括 nccl-tests）做内容及权限保留校验。按用户接受的范围，旧层仍可恢复源码。发布前核对包清单/导入、运行配置、平台、原始层及只限 workspace 的文件变更；转换为 Docker V2 manifest 时不改 blob 内容。覆盖前再次核对远端原 digest，发布后拉取验证；不修改运行中容器、不向其他 registry 同步。结构不支持、存在 volume、导入变化或 tag 并发更新时记录该项失败，不强制覆盖；不代表做过 GPU 计算测试。

计划、凭据、镜像元数据、逐项回执及 `status.json`/`events.jsonl` 均放私有目录。同状态目录重跑会跳过已验证 digest，并可补做已记录发布的验证。批次锁防止同目录重复运行；SIGTERM 会等待当前 tag 处理结束后停止派发。默认剩余空间低于 200 GiB 时暂停新工作，不做全局 Docker prune。已授权批次可作为远端脱离终端的进程运行，Mac 睡眠/SSH 断开不影响它；通过私有状态查看进度。成功镜像可能仍占用本地磁盘，需要时只管理明确属于此任务的缓存。

本目录打包 GitHub 到飞书监控、PR 描述管理、提醒、文件传输、二维码发布、飞书桥接及 macOS `launchd` 集成，Git 中不保存私有运行数据。

需确认的定期提醒配置在私有 `config.json` 的 `reminders` 中。每个提醒可以独立设置日程、确认按钮文案和重复间隔；到点后会持续发送，直到授权用户点击按钮。确认状态按提醒 ID 和日期保存在 `state/ack-reminders/`，因此旧卡片不会误确认新一天。`services.reminders.poll_interval_seconds` 控制调度检查频率，单个提醒的 `repeat_interval_seconds` 控制未确认时的催办频率。

安装器会把 Python 运行脚本同步到私有目录 `~/.config/kian-automation/runtime/`，LaunchAgent 从这里执行，以避开 macOS 对 `Documents` 等用户目录的后台访问限制。代码仍以 Kian 仓库为唯一来源，每次安装都会刷新运行副本。

### 开源仓库更新

同一仓库内，必推事件（发版、符合条件的 PR 合入/关闭、持续关注项更新、已登记博客/镜像发布）排在评分筛选的 PR/Issue 早期信号前；评分项按分数从高到低排列。同分项及必推项之间保留原有顺序。同仓库的多个待发送批次先合并排序，再按卡片 25 项上限截取，夜间积压与重试同样适用；旧队列从原有早期信号标题识别分数。仓库之间的顺序与推送筛选条件不变。

`public_watch.repositories` 用于观察不由自己维护的公开仓库。它与自有仓库全量监控隔离，首次启动只建立当前基线，不倒灌历史消息。此后始终推送 Release 和合入 `integration_branches` 的 PR；未显式配置主开发分支时跟随 GitHub `default_branch`。重要 PR/Issue 结合安全、正确性/回归、破坏性 API、性能、核心硬件/编译器关键词，GitHub 标签、维护者身份、讨论与 reaction 热度评分。

单个仓库还可以配置包含 `name` 和 `feed_url` 的 `blogs`。每个 RSS/Atom feed 独立建立基线，启用时不会倒灌旧文章；后续新文章会作为带中文摘要的 Blog 事件，归入所属仓库的同一持久化飞书批次，并沿用该仓库的标题/正文排除规则。Blog 检查点与 GitHub PR/Issue 状态分开保存，每个 feed 最多保留 200 个已见条目标识。

独立研究博客放在 `public_watch.sources`，包含唯一 `id`、展示 `name`，以及 `feed_url`（RSS/Atom）或 `index_url` + 匹配文章 URL path 的 `link_pattern`。HTML 发现仅接受同站 HTTPS 且带标题的文章链接，去重后读取新文章正文生成摘要；零匹配视为错误，保留旧基线。独立来源共用每小时扫描、夜间静默、持久化合并和失败重试，但检查点单列于 `sources`，卡片显示 Research blog、不伪造 GitHub 分支。所有未被排除的新文章都推送，不套用 PR/Issue 评分等级；仍可配置 `exclude` 标题/正文规则。首次注册只建基线，不倒灌历史；同一已见 URL 的内容修订不重复通知。覆盖范围为所选官方列表/feed，不声称扫描全站历史。以后 OpenAI/DeepMind 等可在核验官方 feed/index 后显式注册为新 source。配置示例注册了 Anthropic Research。

对于没有 feed 的文档站，`web_releases` 可配置 `name`、`index_url` 和包含命名 `version` 分组（或第一个捕获分组）的正则 `link_pattern`。匹配链接会独立建立基线；索引中新出现的版本始终作为 Release 事件推送，并抓取详情页作为中文摘要上下文。它适合挂在仓库下的厂商产物，例如 NVIDIA PyTorch NGC 容器 release notes。

每个仓库的 `level` 可随时调整：`detailed` 的 PR/Issue 默认阈值为 4，`balanced` 为 8，`essential` 禁用早期信号，只保留发版和主开发分支合入。`thresholds.pr` / `thresholds.issue` 可以覆盖单库阈值。已经推送过的早期信号会继续跟踪合入、关闭或 Issue 状态变化，即使之后下调监控等级。状态保存在 `state/public-watch-state.json`。

开源仓库卡片不再放置管理按钮。用户把 GitHub PR/Issue 链接连同“持续关注”“取消关注”“加入备忘录”或“深度调研”等自然语言指令交给 agent；agent 在 `ai-agent-contexts` 中保存长期条目，并在能够访问 Kian 运行主机时，通过 `automation/scripts/manage_public_watch.py pin|unpin <url>` 同步运行时关注状态。只有明确持续关注的条目才会再次推送：PR 的 head commit 变化（包括 rebase / force-push），以及 Issue 的新增评论、标题、正文或标签变化；这些卡片的标签会加入合成的 `pinned` 标识。PR 合入/关闭或 Issue 关闭时会发送最终结果并自动结束关注。运行时 Pin 状态独立保存在 `state/public-watch-pins/<owner>/<repo>/<number>.json`，主动关注也会覆盖单库等级与噪声过滤规则。

开源仓库监控支持持久化合并投递。北京时间 `00:00–10:29` 发现的事件只写入 `state/public-watch-state.json` 的待发送队列，并由每天 `10:30` 的精确调度统一发送；发送失败时保留队列，每 5 分钟重试一次。真正的 GitHub 扫描仍保持每小时一次。白天每轮扫描产生的多个仓库事件也会合并成一张飞书卡片，同一仓库的多批事件归入同一个分区，减少连续弹窗。为遵守飞书卡片容量限制，极端积压每批最多发送 25 项，每个重试点最多发送一张卡片，其余继续留在队列。

单库 `exclude` 支持 `title_patterns`、`body_patterns`、兼容旧配置的 `text_patterns`、`label_patterns` 和 `path_patterns` 正则表达式。标题和正文规则相互独立，可避免正文仅在兼容性说明中提到某后端时误杀整个 PR。路径规则默认 `path_match: "all"`，即 PR 的全部改动文件都属于排除路径时才过滤，避免一个同时修改核心代码和特定后端的 PR 被误杀；设为 `any` 可采用更激进的过滤。自定义过滤同时作用于早期信号和主开发分支合入，但不影响 Release。PR 卡片按 title、中文摘要、合并后的英文 Signals、原文链接的顺序展示，不重复附带英文正文或 ghstack 清单。

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
PR 描述默认生成精简、聚焦结果且不限制数量的要点。每条只表达一个内聚、可独立理解的改动；不相关的改动保持分条，不为减少条数而硬塞到一起。普通文本命令和卡片按钮都使用这一标准；只有显式使用 `full` 模式时才保留更多实现与验证细节。

## 验证与使用

`doctor.sh` 检查 macOS、Node/Python、JSON 有效性、报告未替换占位符数量、配置权限、运行目录、plist 有效性、launchd 注册状态和日志是否存在，且不会打印秘密。安装器会针对每个已启用服务单独校验必填字段。

可用 Python 编译和 Node 语法检查进行不发送消息的验证。直接运行监控或提醒命令可能发送真实飞书消息。文件传输示例：

- `python3 automation/scripts/file_transfer.py local-file example-machine:/remote/path`
- 目标为目录时增加 `--into-dir`。

远端地址使用私有 SSH config 别名。远端到远端会经本机临时目录中转，并对文件执行大小和 SHA-256 校验。

如需为本地或远端仓库 workspace 初始化统一的临时目录，运行 `python3 automation/scripts/init_tmp_workspace.py example-machine:/workspace/path`。workspace 必须已经存在。命令会幂等创建 `.tmp/`，其中包含 `.tmp_cache`、`.tmp_chats`、`.tmp_configs`、`.tmp_data`、`.tmp_libs`、`.tmp_logs`、`.tmp_notes`、`.tmp_patches`、`.tmp_scripts`、`.tmp_tests` 和 `.tmp_worktrees`，并确保 `.tmp/.gitignore` 含有 `**`，防止临时内容被 Git 追踪；已有目录和文件会保留。远端路径复用文件传输服务中配置的机器简称及容器到宿主机的路径映射。

常规 Git alias 维护需在私有配置中定义 `git_alias_sync`，然后运行 `python3 automation/scripts/sync_git_aliases.py --commit-message "feat: update git aliases"`。该命令会检查 Bash 语法，可选地提交并推送源仓库，将脚本同步到所有目标并校验大小与 SHA-256。它不会执行安装脚本，而是输出本地及容器内可复制的 `bash` 命令，由用户在需要更新的容器中执行。源仓库、机器名称和远端路径都只保存在私有配置中。

遇到 VS Code Remote-SSH 主机缓存过旧导致无法连接时，可将复制的输出或不完整的 `vscode-ssh-host-<hash>` 片段传给 `python3 automation/scripts/cleanup_remote_ssh_cache.py '<粘贴的输出>'`。工具接受至少 8 位十六进制哈希，只会删除标准 Remote-SSH 缓存根目录下匹配的直接子目录，并报告实际删除项。完成后重新加载 VS Code 窗口再连接。

远程 VS Code workspace 正在卡顿时，运行 `python3 automation/scripts/diagnose_vscode_remote.py --host <ssh-alias> --workspace <path>`；Dev Container 额外传 `--container <名称>`。工具会在一个预热后的 SSH 会话内测量数据往返延迟，并采集远端 CPU/内存/pressure、VS Code server 与扩展进程、近期异常日志，以及共享存储元数据和一个自动删除的 8 MiB 读写/fsync 探针。输出会按证据排列根因；没有指标越过阈值时会明确报告无法归因，而不是猜测。

### 自动释放 Codex 遗留写锁（可选）

手动清理还会检查保留的旧前端日志会话（每份 renderer 日志最多读取 8 MiB），以找回较早的连接身份；当前活跃归属仍只取最新会话中存活的窗口。Linux 远端日志已被删除时，仍可通过扩展宿主打开的 `/proc/<pid>/fd` 句柄识别和读取。后端日志或连接证据不可读时报告 `backend_log_or_connection_unavailable`，不能静默当成 workspace 正常。

当前使用约定：自动清锁已停用。用户说“清锁”时，agent 执行 `python3 automation/scripts/codex_lock_guard.py --manual --apply`，在自动服务关闭时也能单次运行。并行扫描当前 `codex_activity_monitor.targets` workspace 登记表；未配置该表时才使用旧清锁目标，支持精确的 `thread_workspaces` 映射。仅带 `--manual` 为预览。用即时连续核对代替后台 60 秒确认等待，但保留下述空闲会话、120 秒静默、连接归属、单会话持锁及 pidfd 检查。失联或证据不足时报告并跳过，不强制结束。发出信号、候选消失均不等于界面已恢复，可能仍需切换聊天。命令由 agent 执行，用户无需记忆。

在私有配置中启用 `services.codex_lock_guard.enabled`，并在 `codex_lock_guard.targets` 中逐项配置 `id`、SSH `host`、可选 `container`、远端 `codex_home`、`server_root` 和精确的 `workspaces` 路径白名单。重新安装后，`com.kian.codex_lock_guard` 每 60 秒检查一次。目标地址和个人路径只放私有配置。macOS 负责读取本机 VS Code 日志，Linux 远端负责核对锁；SSH 必须能以 `BatchMode` 登录，密码连接只复用已有的 SSH master，不存储或输入密码。

守护程序要求全部满足以下条件：当前 Mac 的 VS Code 日志能证明旧连接已不被任何当前窗口使用，而同目标的新连接仍在使用；新后端最后一次恢复该会话失败原因为 `active writer`，且之后没有恢复成功；白名单中的精确会话锁由同一 mount namespace 的旧 extension app-server 持有；旧后端只持有这一条会话锁；会话数据库报告最后一轮已结束，rollout 至少 120 秒无变化，且没有运行中的子任务。相同证据需跨至少 60 秒的连续扫描保持一致。断网或检查失败会重置确认，恢复后重新观察。

真正操作前重新读取当前窗口连接、锁 inode、进程启动标识和任务状态，通过 Linux pidfd 只发送 `SIGTERM` 给旧后端，避免 PID 复用；不发送 `SIGKILL`，不删除锁文件，不修改数据库、聊天历史、插件或连接超时。现有后端和其他 workspace 不会因一次全局清理而被结束。缺少证据、仍执行中、多条锁共用同一后端、版本或日志格式不支持时跳过。这是保守的恢复措施，仍有状态滞后和检查/操作之间的竞态风险，不能保证零误判或覆盖所有锁定。

运行 `python3 automation/scripts/codex_lock_guard.py` 仅预览；带 `--apply` 才会积累连续观测并执行合格的释放。首次扫描不会结束进程。记录位于私有 `logs/codex-lock-guard-audit.jsonl`，连续观测位于 `state/codex-lock-guard.json`。审计中的 `skips` 说明跳过原因，`waiting_confirmation` 表示仍在等待连续确认的候选数；SSH 错误保留退出码或超时分类，不输出 SSH 凭据。旧进程或锁已被 VS Code 自行释放也会单独标记。Mac 睡眠、VS Code 未运行或 SSH 不可用时无法清理，恢复后重新检查。

此服务只自动释放锁，不是无人操作的完整 UI 恢复。Codex 在第一次恢复失败后可能停止重试；即使服务随后释放锁，锁定提示也可能一直保留。需在释放后切到另一条聊天再切回，无需关窗口。`ui_retry_may_be_needed` 提示本轮发出释放信号后可能需要这一操作，不能以 `actions` 为空直接判定没有锁定或 UI 已恢复。运行中会话、观测等待、SSH 中断均可能延长恢复时间；不保证重连后立即可用。该服务不处理 Diff/Webview 卡死。

停用时将私有开关设为 `false` 并重跑安装器，或运行 `launchctl bootout gui/$(id -u)/com.kian.codex_lock_guard` 立即停止。新电脑仍需配置 SSH、目标路径，并安装支持 pidfd 的 Linux/Python 环境；不会将本机的旧 PID 或锁状态迁移为终止依据。

套件也包含 Dev Container 会话迁移。Copilot 使用 `automation/scripts/migrate_vscode_copilot_sessions_macos.py` 在 Mac 本机按工作目录逐个合并；必须精确指定 SSH 主机和工作目录，并且只能在 VS Code 完全退出后写入。Codex 使用 `automation/scripts/migrate_codex_sessions_between_containers.sh` 在远端 Docker 宿主机按容器对迁移一次；目标必须为空，非空时安全拒绝。完整恢复步骤和安全边界见仓库根目录的 `automation.md`。

常规 wheel 镜像同步需在私有 `wheel_sync.profiles` 中定义 profile，然后运行 `python3 automation/scripts/sync_wheels.py <profile>`。每个配置的 dist 目录必须恰好包含一个 wheel，该文件直接视为当前稳定包，并与按 dist 顺序配置的 `expected_distributions` 一一对应。不再维护开发 profile 或版本锁定。正式传输前会比较源 wheel 与每个目标同名文件的 SHA-256，未变化的包不会下载、清理或上传；只有变化的 wheel 才暂存一次并更新需要更新的目标，因此同版本同文件名的重新构建也能正确识别。新 wheel 上传并校验成功后，才会清理该目标中同 distribution 的其他版本。

二维码发布需显式执行：`python3 automation/scripts/qr_update_publish.py /absolute/path/to/image`。脚本复制图片、有变化时提交、清除代理变量、推送配置分支，仅在 push 成功后标记提醒完成并发送回执。

## 升级

拉取仓库新代码，审阅示例和配置结构变化但不要覆盖私有配置，然后重新运行 `automation/bin/install.sh` 和 `automation/bin/doctor.sh`。仓库移动后必须重跑安装器，因为渲染后的 plist 包含仓库路径。手动启动桥接器时也可设置 `KIAN_REPO_ROOT`。

## 卸载

运行 `automation/bin/uninstall.sh`。它只卸载并删除四个受管理 plist，保留私有配置、状态和日志。确认备份后，如确实需要，再手工删除 `~/.config/kian-automation`。

## 可选状态迁移

先停止旧服务，再仅将需要的 JSON 检查点复制到 `~/.config/kian-automation/state/`，例如监控状态、每日发送标记、受管理 PR、二维码提醒状态或桥接连接状态。不要复制旧配置或日志。将私有文件权限设为 `600`，重跑安装器，再用 doctor 验证。

## PR 描述策略

现有 `descN` / `upN` 文本命令与卡片按钮共用按 PR 记忆的策略。自动模式下，空描述按最终 diff 整体生成；非空描述若没有匹配的 Kian 生成快照，或已被人工修改，则进入保留模式并记住该选择。缺少可靠记录的历史描述默认保留。识别依赖本地记录，不依赖中英文或文风；换电脑时需要一起迁移 automation state。

保留模式比较保存的 head 与新 head，相关 diff 直接更新原条目；只有独立的新改动才在对应原有章节补充条目，不创建 Incremental Updates 等增量专区，保留无关段落、验证／覆盖记录、TODO 和端到端对齐部分；Change scope 单独刷新。旧验证记录注明描述被观察时的 head，不宣称覆盖新增 commits。首次缺少基线时，保守地用当前 PR diff 对照已有内容；head 未变则不生成。基线分叉或增量 diff 可能截断时停止覆盖，让 agent 检查并重新建立基线。简略／完整版按钮不会绕过保留策略。

直接对服务 agent 说“#610 保留人工描述”“#610 恢复整体重构”或“#610 恢复自动识别”即可。agent 用下列命令持久化设置：

```bash
python3 automation/scripts/pr_desc_manager.py policy610 world-sim-dev/magicore preserve
# 按需将 preserve 改成 rewrite 或 auto。
```

切换策略本身不修改 GitHub；之后的按钮沿用设置。显式 rewrite 才恢复以最终 diff 整体生成。精确段落锚点会保护无关内容，但判断哪些语义应更新仍依赖配置的模型。写入前会复查 body/head，本地同一 PR 的操作会串行；GitHub 此接口不提供原子的 body/head 比较并交换，仍存在极小的外部并发窗口。

### Codex workspace 工作结束通知

启用 `services.codex_activity_monitor.enabled`，在 `codex_activity_monitor.targets` 中配置唯一 `id`、显示 `label`、SSH `host`、可选 `container`、`codex_home` 与精确 `workspaces` 白名单。重新安装后注册 `com.kian.codex_activity_monitor`；`services.codex_activity_monitor.interval_seconds` 默认 60 秒。只观察白名单中未归档、名称为 `Kato ...` 的聊天；新增 workspace、机器或容器需登记真实路径。SSH 使用 BatchMode 和已有凭据／control master。

采集器以 SQLite read-only/query-only 方式读取远端 `state_*.sqlite`、`thread_history_*.sqlite`，只取公开最终回复和明确的 turn 状态，不接管会话、不读取 reasoning、不发送指令、不清锁、不终止进程。只有最新一轮可判定为 working，忽略历史遗留的 inProgress。首次成功发现时跳过旧完成记录，并跟踪当前运行轮次；之后也能捕获两次轮询之间开始并结束的短任务。静默或失联不等于结束。completed、failed、interrupted 分别发送飞书卡片；一轮 completed 不保证整个用户目标或后台任务已成功。

持久状态与待发 outbox 位于 `state/codex-activity-monitor.json`，采用进程锁和原子写入。SSH 失败保留检查点；飞书网络或业务 API 失败保留待发消息，后续补发，不依赖出现新任务。target/thread/turn 唯一键避免常规重启重复推送，重试复用固定飞书 UUID（服务端去重窗口为 1 小时）；不能承诺超过该窗口的模糊发送／崩溃也严格 exactly-once。Mac 睡眠、断网或 SSH master 失效会推迟观察和通知，恢复后继续。本类完成通知不做夜间积压。SQLite 格式不兼容会记录 unavailable，绝不当作任务完成。

使用 `python3 automation/scripts/codex_activity_monitor.py --dry-run` 查看目标与 working 数量，不写通知检查点或发送卡片。日志为 `logs/codex-activity-monitor.log` 和 `.err.log`。关闭服务开关后重装，或执行 `launchctl bootout gui/$(id -u)/com.kian.codex_activity_monitor` 停止。卡片包含 workspace、起止时间、状态、turn ID 和最多 3,000 字的 agent 最终回复，不额外用模型编造成功结论。

每次发送或补发前，监控都会重新读取同一远端会话的用户消息序号；若已出现晚于该条 Agent 回复的用户消息，就丢弃旧待发卡片并保留去重记录，不读取用户回复正文。无法确认时延后发送；已发送消息不自动撤回，跨系统复查与发送也不是原子操作。

`codex_activity_monitor.response_grace_seconds` 默认 300：每轮结束后先留 5 分钟响应时间，再复查用户是否回复，未回复才发卡片。按默认每 60 秒检查，正常约在完成后 5–6 分钟提醒。等待状态可跨重启保留，补发不重新计时；若缺少完成时间，则持久记录首次观察时间作为缓冲期起点。

已知执行时长严格短于 60 秒的轮次不发通知，包括失败、中断以及已排队待重试的卡片。时长使用 `completed_at - started_at`，不计 5 分钟响应缓冲或断网延迟；恰好 60 秒仍可提醒。时间戳缺失或无效时不推断为短任务，沿用原有通知规则。

已有 Codex 会话的执行 cwd 与 VS Code workspace 根目录不同时，可在目标中配置 `thread_workspaces`，用精确会话 ID 映射到已登记的 workspace 路径；映射目标必须同时位于 `workspaces` 白名单。这样不会把无关执行目录登记为 workspace，也不扩大到该目录下其他会话。采集结果另保留 `session_cwd`，不修改 Codex 会话历史。

---
name: kian-automation
description: '安装、迁移、恢复、接管和维护可迁移 Kian 自动化。Use when: 用户换电脑或公司后需要重建自动化，或要求发送飞书消息、管理 launchd 服务、检查 GitHub 更新推送、处理 PR desc/up、传输文件、同步 wheel 或发布二维码。'
---

# Kian 自动化接管

使用仓库内独立脚本与 macOS `launchd`，不依赖 Kian Electron 界面常驻。

**本文件是新电脑恢复整套自动化的首要迁移文档和 Agent 执行入口。** Agent 应先完整阅读本文件，再收集本机私有信息并执行安装；不要要求用户自行拼装配置。`automation/README.zh-CN.md` 和英文 README 仅作为面向人的补充说明。

## 资产位置

- 本迁移文档：`.github/skills/kian-automation/SKILL.md`
- 补充实现说明：[automation/README.zh-CN.md](../../../automation/README.zh-CN.md)
- 自动化脚本：`automation/scripts`
- 默认私有目录：`~/.config/kian-automation`
- 私有配置：`~/.config/kian-automation/config/config.json`
- 状态与日志：`~/.config/kian-automation/state`、`~/.config/kian-automation/logs`
- LaunchAgent：`~/Library/LaunchAgents/com.kian.*.plist`
- 飞书 PR 指令桥接器：`packages/kian-copilot-bridge`
- 服务清单与故障说明：[service-inventory.md](./references/service-inventory.md)

## 新电脑迁移流程

当用户让 Agent 在新电脑恢复服务时，按以下顺序自主完成。

### 1. 获取代码

1. 克隆 Kian 仓库或进入已有 clone。
2. 获取并切换远端 `dev_kato` 分支。
3. 确认工作树状态，避免覆盖用户未提交改动。
4. 阅读本文件、补充 README 和服务清单。

### 2. 检查运行环境

仅支持 macOS `launchd`。确认以下命令可用：

- Node.js
- Python 3
- Git
- rsync
- pnpm（可选；没有时安装器使用 npm）

不要沿用旧电脑的绝对路径。仓库可以位于任意稳定目录，安装器会根据当前 clone 自动渲染路径。

### 3. 收集本机私有信息

向用户逐项询问尚无法从本机安全推断的信息：

1. 飞书 app ID、app secret、通知接收人的 open ID、允许操作机器人的用户 open ID。
2. 需要监控的 GitHub `owner/repo` 列表，以及每个 owner 对应的 token。
3. 要启用的服务：`bridge`、`realtime`、`daily`、`qr`，以及运行间隔或触发时间。
4. 摘要后端。优先使用已订阅并通过 OAuth 登录的 GitHub Copilot CLI；只有明确选择旧 `openrouter` 后端时才需要私有 API key 和模型名。
5. 文件传输的默认下载目录、机器简称、`~/.ssh/config` 别名和路径前缀映射。
6. Wheel 同步 profile 的构建源机器、dist 目录、目标机器、按镜像区分的汇总目录，以及每个 distribution 经用户确认的稳定版本号。
7. 若启用二维码服务：本地网站仓库目录、仓库内图片相对路径、分支、提交信息和提醒文案。
8. 是否迁移旧电脑的监控检查点、受管理 PR、二维码轮次和连接状态。

不得在聊天中索要 SSH 密码、私钥或恢复码。让用户直接在本机安全位置配置这些信息。不得把真实仓库列表、机器地址或个人路径写回 Git 模板。

### 4. 配置飞书和 GitHub

在飞书开放平台启用长连接事件投递并订阅：

- `im.message.receive_v1`
- `card.action.trigger`

确认应用具有对应的消息接收/发送权限、已发布可用版本，并在需要时加入目标群聊。

GitHub 优先使用仅覆盖目标仓库的 fine-grained token。监控需要仓库元数据、Issues、Pull requests、评论和 Contents 只读权限；更新 PR 描述还需要 Pull requests 写权限。私有仓库使用 classic token 时通常需要 `repo`。

### 4.1 配置 Copilot CLI 摘要后端

PR 描述默认可使用 GitHub Copilot 订阅，不需要单独的模型 API key：

1. 安装官方 CLI：`npm install -g @github/copilot`，或在 macOS 使用 `brew install --cask copilot-cli`。
2. 在交互式终端执行 `copilot login`，完成浏览器 OAuth 授权。不得复制或提交本机 OAuth 凭据。
3. 执行 `command -v copilot` 获取绝对路径，并写入私有配置的 `summarization.command`。`launchd` 不继承交互式 shell 的 `PATH`，不能只依赖命令名。
4. 私有配置使用 `backend: "copilot_cli"`、CLI 绝对路径和 `model: "auto"`。换机或登录过期时重新执行 `copilot login`。
5. 用无副作用的小提示验证 CLI 非交互模式，再测试 PR manager。PR manager 会禁用 CLI 工具、文件访问、MCP 和自定义指令，只传递最终 PR diff。
6. 如明确改用 `openrouter`，只在私有配置中保存其 `api_key` 和模型；不得写入模板、文档、日志或聊天。

### 5. 创建私有配置

1. 运行 `automation/bin/install.sh` 创建默认私有目录和配置模板。
2. 将收集到的信息写入 `~/.config/kian-automation/config/config.json`。
3. 配置文件权限必须为 `600`；私有目录权限应为 `700`。
4. 已禁用或未使用的可选功能可以保留占位符；已启用服务的必填项必须全部配置。
5. 不要把私有配置放进仓库，也不要修改 `automation/config/config.example.json` 来保存真实值。

如需使用其他私有目录，设置 `KIAN_AUTOMATION_HOME`；后续安装、诊断和手动脚本执行必须使用同一值。

### 6. 安装并加载服务

配置完成后再次运行：

- `automation/bin/install.sh`
- `automation/bin/doctor.sh`

安装器会：

- 保留已有私有配置，不会覆盖；
- 安装飞书桥接器 Node 依赖；
- 忽略失效的桌面代理设置；
- 渲染 `~/Library/LaunchAgents/com.kian.{bridge,realtime,daily,qr}.plist`；
- 标准服务成功加载后清理对应的旧 label，避免新旧任务使用独立状态重复推送；
- 校验 plist；
- 只加载配置完整且已启用的服务。

### 7. 验证恢复结果

1. `doctor.sh` 必须通过已启用服务的配置、权限、plist 和注册检查。
2. 使用 `launchctl print gui/$(id -u)/<label>` 检查服务。
3. 查看私有 `logs/` 中各服务日志，不得回显凭据。
4. 先做不产生外部副作用的语法检查；只有用户明确同意时才发送测试飞书消息或修改测试 PR。
5. 验证 bridge 能收到 `descN/upN` 文本事件和卡片事件，并立即返回 Toast。
6. 验证实时监控失败时不推进检查点，恢复后不会遗漏事件。

### 8. 可选状态迁移

先停止旧服务，只复制确实需要的 JSON 状态到新电脑私有 `state/`：

- GitHub 监控检查点；
- 每日汇总发送标记；
- 受管理 PR 状态；
- 二维码提醒轮次；
- bridge 连接告警状态。

不要迁移旧日志或旧配置。状态不是恢复服务的必要条件；不迁移时系统从空状态启动。

### 9. 升级和卸载

- 升级：拉取 `dev_kato` 最新代码，检查配置结构变化，重新运行 installer 和 doctor。仓库移动后也必须重新安装以渲染新路径。
- 卸载：运行 `automation/bin/uninstall.sh`。它只卸载受管理 plist，保留私有配置、状态和日志。

## Git 与秘密边界

允许提交：代码、无秘密模板、launchd 模板、安装/诊断脚本、文档。

禁止提交：

- 飞书、GitHub、模型 API 凭据；
- open ID、真实仓库清单和内部 URL；
- SSH host/IP、用户名、密码、私钥和恢复码；
- 本机绝对路径和公司环境路径映射；
- `config.json`、状态 JSON、日志和渲染后的 plist。

提交前执行敏感模式扫描和 `git diff --cached` 审计，但不得在报告中输出匹配到的秘密内容。若发现秘密曾进入 Git 历史，立即停止推送、报告文件位置并安排凭据轮换。

## 操作规则

1. 不在聊天、日志或新文件中输出飞书、GitHub、模型 API 凭据。
2. 发送即时飞书消息前，先确认用户明确要求发送；然后复用 `feishu_remind.py`。
3. 创建定时提醒时，优先创建独立的 `com.kian.reminder-<slug>.plist`，不要依赖已宕机的 Kian 内置 cron 调度器。
4. 一次性提醒使用 `StartCalendarInterval` 的 `Month`、`Day`、`Hour`、`Minute`；周期提醒只填写所需字段。
5. plist 写入后先执行 `plutil -lint`，再用 `launchctl bootout gui/$(id -u)/<plist>`（允许未加载）和 `launchctl bootstrap gui/$(id -u) <plist>` 重新加载。
6. 删除提醒前先 `bootout`，再删除 plist。不要删除共享脚本或凭据配置。
7. 一次性提醒调用 `one_time_reminder.py`；发送成功后由脚本原子写入私有完成标记、删除 plist 并卸载自身，避免同一月日在次年重复触发。
8. 检查服务时使用 `launchctl print gui/$(id -u)/<label>`，并查看对应日志末尾；`state = not running` 对按时唤醒型任务通常是正常状态。
9. GitHub 实时监控由 `com.kian.realtime` 执行；每日总结由 `com.kian.daily` 执行。具体启用状态和调度来自私有配置。先看日志再决定是否手动运行，避免重复推送。
10. 不把 Kian 的 `cronjob.json` 当作持续服务来源：该调度器随 Electron 主进程停止。需要长期运行的任务必须落到 `launchd` 或其他系统级调度器。
11. 修改脚本后执行静态语法检查；除非用户明确要求测试推送，否则不要通过真实发送来验证。
12. 飞书 PR 更新卡片提供默认“生成/更新描述”及“生成简略版/更新完整版”按钮，文字 `desc<号>` / `up<号>` 命令仍保留；均由 `com.kian.bridge` 独立监听并调用仓库内 `pr_desc_manager.py`，不依赖 Kian Electron 进程。按钮携带仓库名以消除同号歧义，同时到达时按钮优先。
	- 简略版只生成 2-4 条简短、合并同类项、聚焦最终结果的要点，省略非必要实现细节、次要边界情况和验证信息。
13. 对确定性不足、需要深入理解代码语义的复杂 PR desc，桥接器只做保守更新；用户可直接在 Copilot 对话中要求完整分析和重写。

## 常见请求

### 即时飞书消息

调用 `feishu_remind.py <标题> <Markdown正文>`。执行成功应输出 `SENT`。

### 新建飞书定时提醒

1. 从用户描述解析本机时区下的触发时间与重复规则。
2. 生成唯一、可读的 label 和 plist 文件名。
3. `ProgramArguments` 使用安装器发现的 Python、仓库内 `one_time_reminder.py`、label、plist 路径、带时区 ISO 触发时间、标题和正文，并设置 `KIAN_AUTOMATION_HOME`。
4. 日志写入默认私有目录下的 `logs/`。
5. 校验并 bootstrap，然后读取 `launchctl print` 确认已注册。
6. 向用户回报准确触发时间、是否重复及 label。

### GitHub 推送故障

1. 查看实时与每日 stdout/stderr 日志的最近记录。
2. 检查配置中仓库列表和 token 到期元数据，但绝不回显 token。
3. 区分 GitHub 网络/API 错误、飞书发送错误和摘要模型错误。
4. 外部摘要模型不可用时应保留本地摘要降级，不应停止事件推送。

### 飞书 PR 指令故障

1. 检查安装器实际注册的 bridge label（当前通常为 `com.kian.copilot-bridge`）及其 `launchctl` 状态；不要假定旧 label 仍有效。
2. 通过 `launchctl print gui/$(id -u)/<label>` 读取实际 `stdout path` 和 `stderr path`，再查看日志；不要假定日志一定在私有 `logs/` 目录。
3. 确认 Node 进程存在飞书 WebSocket HTTPS 连接。
4. `desc<号>` 与 `up<号>` 都必须分析当前 head 的最终 PR diff，并结合现有描述整体重构 `## DONE`；禁止逐 commit 追加或照抄 commit message。后续 commit 覆盖前序实现时，描述只反映最终净效果。
5. “简略版”只保留重构后的 `## DONE`；“完整版”在整体重构 `## DONE` 后保留或补齐仓库对应的后续章节结构。
6. 每条 DONE item 必须对重要结果、实现机制或关键词使用 Markdown `**加粗**`，同时继续用反引号标记代码符号和路径。
7. 如果 DONE item 描述的是合入其他 PR 的变更，单个来源使用 `w.r.t. the PR: <完整 PR URL>.`；多个来源必须合并为一个 `w.r.t. the PRs: <URL>, <URL>, <URL>.` 后缀。整体重构可以合并重复语义，但不得丢失仍由最终 diff 支持的关联 PR 来源。
8. 实时更新卡片保留文字回复提示，并同时生成对应按钮；排查按钮时确认 `card.action.trigger` 已在飞书开放平台订阅。
9. 处理器只使用监控配置内的仓库与对应 GitHub token，不允许任意仓库写入。

#### 卡片按钮无响应速查

1. 若文本 `descN`/`upN` 正常，GitHub、Python 和回复链路无需重复排查，重点检查 `card.action.trigger`。
2. handler 应保留脱敏的 `received card action`、解析结果布尔值和丢弃原因日志；不得记录 open ID、消息正文或凭据。
3. 点击原卡片后若没有新日志，先确认发卡 monitor 与 bridge 使用同一 App（只比较配置值或脱敏指纹），并在飞书后台确认“回调配置”使用长连接且已订阅 `card.action.trigger`。
4. 使用当前 App 新发一张无副作用诊断卡片。若点击后出现 `received card action`，订阅、长连接和回调均正常；原卡片通常是旧卡或转发副本，应改用新生成的 PR 卡片。
5. 诊断按钮使用非生产命令时，`ignored card action: invalid command` 及“按钮数据无效” Toast 是预期结果，不能误判为回调失败。
6. 真实按钮必须携带 `value: { action: "desc" | "up", pr, repo, mode? }`；成功日志应依次出现 `received card action`、`received command ... card` 和 `completed command ... card`。
7. 若进程仍在且出现 `ws client ready`，但此前已有 DNS、timeout 或 `connect failed`，同时点击没有 `received card action`，应判定为 SDK WebSocket 假在线。连接失败后只允许短暂自动重连窗口；必须观察到新的 `ws connect success` 或 `reconnect success`，否则主动退出并交给 launchd 重建整个进程，不能等待常规静默超时。
8. 若已成功执行 `descN`，后续新 push 卡片却仍显示“生成”，检查发卡 monitor 与 bridge 是否使用同一 `KIAN_AUTOMATION_HOME`。不得同时保留读取脚本目录旧 `managed-prs.json` 的遗留 monitor；monitor 与 bridge 必须共同读取私有 `state/managed-prs.json`。

### Wheel 常规同步

使用 `automation/scripts/sync_wheels.py <profile>`。Profile 位于私有配置的 `wheel_sync.profiles`，包含：

- `source_machine`：构建 wheel 的机器别名；
- `dist_dirs`：需要分别发现 wheel 的 dist 目录；
- `destination_machines`：需要同时写入的机器列表，可包含源机器；
- `target_dir`：该基础镜像专属的 wheel 汇总目录。
- `expected_distributions`：distribution 列表，与 dist 目录按顺序对应。

执行规则：

1. 用户会在构建前清理各 dist 目录；每个 dist 必须恰好存在一个 `.whl`，该文件直接视为当前稳定包。缺失或存在多个 wheel 时，在删除或传输前整体失败。
2. 每个 wheel 只下载到本机临时目录一次，再分别上传所有目标机器。
3. 变化 wheel 上传并校验成功后，按 distribution 名清除目标目录中除当前文件外的其他版本，确保每个 distribution 只保留一个稳定 wheel。
4. 下载和每次上传均执行文件大小与 SHA-256 校验，完成后清理本机临时目录。
5. 不再维护版本锁定或开发 profile；个人测试包从其他位置单独安装，不得写入 `pkg_whls`。
6. 切换基础镜像时必须选择对应 profile，禁止混用不同镜像的汇总目录。
7. 正式同步前比较源 wheel 与每个目标同名文件的 SHA-256。未变化的 distribution 不下载、不清理、不上传；只有内容或文件名变化的 wheel 才暂存一次并更新需要更新的目标。同名重新构建也必须通过摘要变化识别。新 wheel 上传并校验成功后才清理同 distribution 的其他版本，禁止先删后传。

### 私有状态

所有状态仅保存在默认私有目录的 `state/` 中。迁移旧状态是可选操作；不得把旧配置、日志或凭据复制进仓库。
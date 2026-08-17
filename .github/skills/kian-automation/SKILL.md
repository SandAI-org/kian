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
4. 可选摘要模型的 API key 和模型名；不配置时使用本地确定性摘要。
5. 文件传输的默认下载目录、机器简称、`~/.ssh/config` 别名和路径前缀映射。
6. Wheel 同步 profile 的构建源机器、dist 目录、目标机器和按镜像区分的汇总目录。
7. 若启用二维码服务：本地网站仓库目录、仓库内图片相对路径、分支、提交信息和提醒文案。
8. 是否迁移旧电脑的监控检查点、受管理 PR、二维码轮次和连接状态。

不得在聊天中索要 SSH 密码、私钥或恢复码。让用户直接在本机安全位置配置这些信息。不得把真实仓库列表、机器地址或个人路径写回 Git 模板。

### 4. 配置飞书和 GitHub

在飞书开放平台启用长连接事件投递并订阅：

- `im.message.receive_v1`
- `card.action.trigger`

确认应用具有对应的消息接收/发送权限、已发布可用版本，并在需要时加入目标群聊。

GitHub 优先使用仅覆盖目标仓库的 fine-grained token。监控需要仓库元数据、Issues、Pull requests、评论和 Contents 只读权限；更新 PR 描述还需要 Pull requests 写权限。私有仓库使用 classic token 时通常需要 `repo`。

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
7. 检查服务时使用 `launchctl print gui/$(id -u)/<label>`，并查看对应日志末尾；`state = not running` 对按时唤醒型任务通常是正常状态。
8. GitHub 实时监控由 `com.kian.realtime` 执行；每日总结由 `com.kian.daily` 执行。具体启用状态和调度来自私有配置。先看日志再决定是否手动运行，避免重复推送。
9. 不把 Kian 的 `cronjob.json` 当作持续服务来源：该调度器随 Electron 主进程停止。需要长期运行的任务必须落到 `launchd` 或其他系统级调度器。
10. 修改脚本后执行静态语法检查；除非用户明确要求测试推送，否则不要通过真实发送来验证。
11. 飞书 PR 更新卡片提供默认“生成/更新描述”及“生成简略版/更新完整版”按钮，文字 `desc<号>` / `up<号>` 命令仍保留；均由 `com.kian.bridge` 独立监听并调用仓库内 `pr_desc_manager.py`，不依赖 Kian Electron 进程。按钮携带仓库名以消除同号歧义，同时到达时按钮优先。
12. 对确定性不足、需要深入理解代码语义的复杂 PR desc，桥接器只做保守更新；用户可直接在 Copilot 对话中要求完整分析和重写。

## 常见请求

### 即时飞书消息

调用 `feishu_remind.py <标题> <Markdown正文>`。执行成功应输出 `SENT`。

### 新建飞书定时提醒

1. 从用户描述解析本机时区下的触发时间与重复规则。
2. 生成唯一、可读的 label 和 plist 文件名。
3. `ProgramArguments` 使用安装器发现的 Python、仓库内 `feishu_remind.py`、标题、正文，并设置 `KIAN_AUTOMATION_HOME`。
4. 日志写入默认私有目录下的 `logs/`。
5. 校验并 bootstrap，然后读取 `launchctl print` 确认已注册。
6. 向用户回报准确触发时间、是否重复及 label。

### GitHub 推送故障

1. 查看实时与每日 stdout/stderr 日志的最近记录。
2. 检查配置中仓库列表和 token 到期元数据，但绝不回显 token。
3. 区分 GitHub 网络/API 错误、飞书发送错误和摘要模型错误。
4. 外部摘要模型不可用时应保留本地摘要降级，不应停止事件推送。

### 飞书 PR 指令故障

1. 检查 `com.kian.bridge` 的 `launchctl` 状态。
2. 查看私有 `logs/bridge.log` 与 `logs/bridge.err.log`。
3. 确认 Node 进程存在飞书 WebSocket HTTPS 连接。
4. `desc<号>` 用于首次生成；`up<号>` 用于已管理 PR 的增量更新，会按 GitHub 顺序把尚未处理的普通 commit 或关联 PR 逐条追加到 `## DONE`，并记录 commit SHA 防止重复。
5. “生成简略版”只生成 `## DONE` 和 commit 要点；“更新完整版”保留已有内容并补齐仓库对应的完整章节结构，再执行增量更新。
6. 实时更新卡片保留文字回复提示，并同时生成对应按钮；排查按钮时确认 `card.action.trigger` 已在飞书开放平台订阅。
7. 处理器只使用监控配置内的仓库与对应 GitHub token，不允许任意仓库写入。

### Wheel 常规同步

使用 `automation/scripts/sync_wheels.py <profile>`。Profile 位于私有配置的 `wheel_sync.profiles`，包含：

- `source_machine`：构建 wheel 的机器别名；
- `dist_dirs`：需要分别发现 wheel 的 dist 目录；
- `destination_machines`：需要同时写入的机器列表，可包含源机器；
- `target_dir`：该基础镜像专属的 wheel 汇总目录。

执行规则：

1. 每个 dist 目录选择修改时间最新的一个 `.whl`；任一目录没有 wheel 时，在传输前整体失败。
2. 每个 wheel 只下载到本机临时目录一次，再分别上传所有目标机器。
3. 下载和每次上传均执行文件大小与 SHA-256 校验，完成后清理本机临时目录。
4. 不使用固定 wheel 版本名，不把机器别名、内部目录或旧目标硬编码进仓库脚本。
5. 切换基础镜像时必须选择对应 profile，禁止混用不同镜像的汇总目录。

### 私有状态

所有状态仅保存在默认私有目录的 `state/` 中。迁移旧状态是可选操作；不得把旧配置、日志或凭据复制进仓库。
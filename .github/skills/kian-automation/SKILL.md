---
name: kian-automation
description: '接管和维护可迁移 Kian 自动化。Use when: 用户要求发送飞书消息、管理自动化 launchd 服务、检查 GitHub 更新推送、处理 PR desc/up、传输文件或发布二维码。'
---

# Kian 自动化接管

使用仓库内独立脚本与 macOS `launchd`，不依赖 Kian Electron 界面常驻。

## 资产位置

- 安装、配置、迁移与卸载：[automation/README.zh-CN.md](../../../automation/README.zh-CN.md)
- 自动化脚本：`automation/scripts`
- 默认私有目录：`~/.config/kian-automation`
- 私有配置：`~/.config/kian-automation/config/config.json`
- 状态与日志：`~/.config/kian-automation/state`、`~/.config/kian-automation/logs`
- LaunchAgent：`~/Library/LaunchAgents/com.kian.*.plist`
- 飞书 PR 指令桥接器：`packages/kian-copilot-bridge`
- 服务清单与故障说明：[service-inventory.md](./references/service-inventory.md)

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

### 私有状态

所有状态仅保存在默认私有目录的 `state/` 中。迁移旧状态是可选操作；不得把旧配置、日志或凭据复制进仓库。
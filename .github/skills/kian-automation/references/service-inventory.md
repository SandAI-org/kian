# Kian 服务接管清单

更新日期：2026-08-15

## 架构结论

- Kian 是 Electron + React 对话界面，Agent 后端基于 `pi-ai` / `pi-coding-agent`。
- Kian 内置 cron 每 15 秒轮询 `cronjob.json`，命中后创建隐藏 Agent 会话执行自然语言任务；它依赖 Electron 主进程，应用宕机后不会调度。
- 关键服务已迁移为仓库内独立 Python 脚本 + macOS LaunchAgent，因此无需恢复 Kian UI 即可继续运行。
- 飞书 PR 描述按钮和 `desc/up` 文字命令入站能力已迁移到独立 Node.js WebSocket 桥接器，Kian 桌面应用可以关闭。
- 完整的新机安装、秘密边界和迁移说明见 [automation/README.zh-CN.md](../../../../automation/README.zh-CN.md)。

## 当前系统服务

| Label | 默认触发规则 | 功能 |
| --- | --- | --- |
| `com.kian.realtime` | 每 300 秒，可配置 | 多仓库 GitHub 动态推送飞书 |
| `com.kian.bridge` | 常驻、自动重连 | 接收飞书卡片按钮或 `descN/upN` 并更新 PR 描述 |
| `com.kian.daily` | 每天 10:00，可配置 | 仓库每日总结 |
| `com.kian.qr` | 默认禁用；启用后每天 12:00，可配置 | 微信群二维码滚动轮次提醒 |

## GitHub 监控范围

监控仓库只来自私有 `config/config.json` 的 `github.repos`，仓库清单不得硬编码在 skill 中。实时事件包括评论、PR review 评论、新 PR、新 commit、PR 合并/关闭、Issue 新建/关闭；每日任务汇总最近 24 小时 PR 与 Issue。

## 复用入口

- 飞书消息：`feishu_remind.py`
- GitHub 实时/每日监控：`github_monitor.py realtime|daily`
- 二维码周期提醒：`qr_reminder.py`
- 私有配置：`~/.config/kian-automation/config/config.json`
- 运行状态：`~/.config/kian-automation/state`
- PR 描述命令处理：`pr_desc_manager.py`
- 飞书入站桥接：源码仓库 `packages/kian-copilot-bridge`

实时推送卡片会保留“回复 `descN/upN`”提示，并为未管理 PR 提供“生成描述/生成简略版”，为已管理 PR 提供“更新描述/更新完整版”。简略版只含 `## DONE` 与 commit 要点；完整版会保留内容并补齐完整章节结构。按钮 value 包含 `action`、PR 号、仓库名和可选模式，能精确处理不同仓库中的同号 PR；按钮与文字命令短时间冲突时按钮优先。

`upN` 与两个更新按钮都会按 commit 顺序处理尚未写入描述的新 commit：普通 commit 追加标题要点，带 `(#N)` 的 squash commit 优先展开成关联 PR 摘要；已处理 SHA 保存在 `managed-prs.json` 中以保证幂等。

## 已知风险

- 凭据集中在默认私有目录的配置 JSON 中，禁止提交版本库或复制进 skill/memory。
- 历史日志出现过网络 DNS/超时，脚本会重试且失败时不推进检查时间。
- 外部摘要模型曾持续返回 403；监控已改为失败时本地摘要降级。
- 多个提醒共用 stdout/stderr 日志，定位单个任务时需结合时间和 LaunchAgent label。
- 桥接器当前只接管明确的 `descN/upN` 命令；任意自然语言飞书对话仍不等同于当前交互式 Copilot 会话。
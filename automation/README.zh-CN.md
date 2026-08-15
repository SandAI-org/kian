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
3. 可选的摘要 API key 和模型。
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

1. 安装 Node.js、Python 3、Git、rsync，以及可选的 pnpm。
2. 将本仓库克隆到稳定位置。
3. 运行 `automation/bin/install.sh`。首次运行会创建私有目录，并且只在私有配置不存在时复制示例。
4. 编辑 `~/.config/kian-automation/config/config.json`，替换每个已启用服务必需的值。已禁用或未使用的可选功能可以保留占位符。不使用二维码时保持 QR 禁用。示例默认启用 `bridge`、`realtime`、`daily`，禁用 `qr`。摘要服务是可选项；不配置 API key 时监控会使用确定性的本地摘要。
5. 再次运行安装脚本。它会安装桥接依赖、渲染 `~/Library/LaunchAgents/com.kian.{bridge,realtime,daily,qr}.plist`、校验并重载启用的服务。若仍有占位符，只渲染而不会加载服务。
6. 运行 `automation/bin/doctor.sh`。

安装器不会覆盖已有私有配置。服务是否启用及调度参数均来自配置中的 `services`。
依赖安装会显式忽略继承的桌面代理设置，避免本地代理应用退出后留下的失效地址阻断初始化。

## 验证与使用

`doctor.sh` 检查 macOS、Node/Python、JSON 有效性、报告未替换占位符数量、配置权限、运行目录、plist 有效性、launchd 注册状态和日志是否存在，且不会打印秘密。安装器会针对每个已启用服务单独校验必填字段。

可用 Python 编译和 Node 语法检查进行不发送消息的验证。直接运行监控或提醒命令可能发送真实飞书消息。文件传输示例：

- `python3 automation/scripts/file_transfer.py local-file example-machine:/remote/path`
- 目标为目录时增加 `--into-dir`。

远端地址使用私有 SSH config 别名。远端到远端会经本机临时目录中转，并对文件执行大小和 SHA-256 校验。

二维码发布需显式执行：`python3 automation/scripts/qr_update_publish.py /absolute/path/to/image`。脚本复制图片、有变化时提交、清除代理变量、推送配置分支，仅在 push 成功后标记提醒完成并发送回执。

## 升级

拉取仓库新代码，审阅示例和配置结构变化但不要覆盖私有配置，然后重新运行 `automation/bin/install.sh` 和 `automation/bin/doctor.sh`。仓库移动后必须重跑安装器，因为渲染后的 plist 包含仓库路径。手动启动桥接器时也可设置 `KIAN_REPO_ROOT`。

## 卸载

运行 `automation/bin/uninstall.sh`。它只卸载并删除四个受管理 plist，保留私有配置、状态和日志。确认备份后，如确实需要，再手工删除 `~/.config/kian-automation`。

## 可选状态迁移

先停止旧服务，再仅将需要的 JSON 检查点复制到 `~/.config/kian-automation/state/`，例如监控状态、每日发送标记、受管理 PR、二维码提醒状态或桥接连接状态。不要复制旧配置或日志。将私有文件权限设为 `600`，重跑安装器，再用 doctor 验证。

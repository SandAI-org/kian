# Kian Review

轻量 VS Code 分支／提交审阅扩展。先只展示文件路径和增删统计，点击文件时才打开**一个原生只读 diff**。不用多文件长页面、不启动网页服务、不 fetch／checkout／stage／commit。

## 使用

打开源代码管理（`Cmd+Shift+G`），找到 **Kian Review**；也可以从命令面板运行 **Kian Review：显示代码审阅**。默认自动选当前workspace仓库，只列Magi系列、Odin和Magicore；按目录名或Git remote识别，改名的worktree也支持，Quack/PyTorch/Contexts等不进入列表。

文件树顶部固定四个可点击控制行：**仓库、模式、Base、Compare**。点击某一行或旁边编辑按钮，只更换这一项并立即刷新。左右版本下拉包含分支、标签、近期commit和自定义版本，不重走整套向导；只有主动点仓库行才重新选仓库。

- **分支／PR模式**按钮一键在两个顶端版本和共同祖先口径之间切换。从单提交模式返回时恢复之前的分支对及口径。
- **单提交模式**直接使用上次所选commit（首次为当前Compare／HEAD），与第一父提交比较。点Compare另选提交；初始提交与空版本比较。主动选择Base会离开自动第一父提交模式，变成普通两版本比较。
- 每个仓库分别记忆分支与提交模式。刷新才重新解析引用，已打开的diff固定到hash；远程分支以最近fetch为准，不自动联网。
- 文件夹默认折叠。工具栏**全部展开文件夹／全部折叠文件夹**只操作树，不打开diff或加载源码。目录显示全部后代文件数和增删行汇总，二进制文件另计。
- 点击文件打开一个原生预览diff。文件行的复制按钮改为**对比侧绝对路径**；右键仍可复制相对路径、打开实体文件。
- 同一Git仓库的linked worktree可通过各自分支／commit比较已提交内容。绝对路径优先指向Compare版本实际所在worktree；无匹配worktree时复制当前工作区路径并明确提示。worktree本身可能带未提交改动，路径用于帮agent定位文件，不代表它等于不可变历史源码。删除路径可能已不存在；重命名复制新路径。
- 不比较未提交／未跟踪内容，不比较不共享Git对象的任意两个独立仓库，也不比较两个worktree的脏工作区。

## 语言支持与边界

历史文件复用 Git 内置扩展的 `git:` 文档和原生 diff。继续沿用语法高亮及现有语言支持；Pylance 虚拟文档能力取决于版本／设置，跨文件跳转可能使用当前工作区，不能保证历史语义环境隔离。

二进制沿用 VS Code 原生 diff 行为，不转为自定义文本；子模块不递归展开比较。单个超大文件仍可能慢，这里减少的是同时创建多个 diff 的负担。Git 操作超时30秒、元数据上限32MiB。只支持受信任且实际落盘的 Git workspace；不使用实验接口。

## 开发与打包

无运行时 npm 依赖、无编译步骤。执行 `node --test test/git.test.js`。`node test/create-fixture.js` 创建临时Magi仓库及linked feature worktree，输出JSON包含路径。`test/extension-host.js` 提供Extension Host测试入口，核对按需打开、worktree路径／剪贴板、模式记忆／独立控制、目录统计／折叠、过期请求防护、新增／删除空侧及Git状态不变；在独立user-data／extensions目录运行。

在本包执行 `npm run package:vsix`，使用固定版本的打包工具，产物统一写入 `dist/kian-code-review-<version>.vsix`。这是 Git 忽略的固定本地产物目录，不再放 Downloads。通过“扩展：从 VSIX 安装”安装。SSH／Dev Container 必须安装在远程环境，Git 与文件读取才会发生在对应机器；若提示 Reload，只重载该窗口。

源码在 Kian 维护；VSIX 和原始测试日志不入 Git。

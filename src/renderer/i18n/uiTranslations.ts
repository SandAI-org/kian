import type { AppLanguage } from "@shared/i18n";

type PatternTranslation = {
  pattern: RegExp;
  render: (...matches: string[]) => string;
};

const EN_US_EXACT: Record<string, string> = {
  "Kian - AI 短剧创作": "Kian - AI Short Drama Creation",
  "智能体": "Agents",
  "设置": "Settings",
  "MCP 服务": "MCP Services",
  "后台任务": "Background Tasks",
  "定时任务": "Scheduled Tasks",
  "技能": "Skills",
  "文档": "Docs",
  "音视频创作": "Media Creation",
  "素材": "Assets",
  "应用": "App",
  "主 Agent": "Main Agent",
  "打开主智能体": "Open main agent",
  "重启升级到新版本": "Restart to upgrade",
  "新版本": "New",
  "通用": "General",
  "快捷键": "Shortcuts",
  "语言模型": "Language Models",
  "音视频模型": "Media Models",
  "渠道": "Channels",
  "广播渠道": "Broadcast Channels",
  "关于": "About",
  "数据存放目录": "Data Directory",
  "修改后需要重启应用才能生效。默认：~/KianWorkspace":
    "Restart the app after changing this. Default: ~/KianWorkspace",
  "数据存放目录不能为空": "Data directory is required",
  "打开链接的方式": "Open Links With",
  "选择应用内打开，或交给系统默认浏览器处理。":
    "Choose the built-in browser or your system default browser.",
  "内置浏览器": "Built-in Browser",
  "系统默认浏览器": "System Browser",
  "语言": "Language",
  "选择界面显示语言。": "Choose the UI language.",
  "中文": "Chinese",
  "英文": "English",
  "韩文": "Korean",
  "日文": "Japanese",
  "点击输入框后按下新的组合键即可录制，按":
    "Click the input and press the new shortcut combination. Press",
  "退出录制。": "to stop recording.",
  "正在加载快捷键配置...": "Loading shortcut settings...",
  "发送消息": "Send Message",
  "聚焦消息发送窗口时触发发送。":
    "Send when the message input is focused.",
  "输入换行": "Insert Newline",
  "聚焦消息发送窗口时插入换行。":
    "Insert a newline when the message input is focused.",
  "聚焦主 Agent 输入框": "Focus Main Agent Input",
  "任意页面下跳转并聚焦主 Agent 输入框。":
    "Jump to and focus the main agent input from any page.",
  "打开设置页面": "Open Settings",
  "任意页面下跳转到设置页面。":
    "Jump to the settings page from any page.",
  "新建对话": "New Chat",
  "新建当前智能体的对话": "Create a new chat for the current agent",
  "恢复默认": "Reset",
  "按下快捷键组合": "Press shortcut",
  "录制中": "Recording",
  "点击后录制": "Click to record",
  "配置保存中": "Saving settings",
  "配置已经保存": "Settings saved",
  "当前已是最新版本": "You already have the latest version",
  "新版本已下载完成，可以安装":
    "The new version has been downloaded and is ready to install",
  "发现新版本，正在下载": "New version found, downloading",
  "检查更新失败": "Failed to check for updates",
  "安装更新失败": "Failed to install update",
  "正在检查更新": "Checking for updates",
  "发现新版本": "New version available",
  "正在下载更新": "Downloading update",
  "正在校验更新包": "Verifying update package",
  "更新已下载，可安装": "Update downloaded, ready to install",
  "更新失败": "Update failed",
  "未检查更新": "Not checked",
  "无匹配模型": "No matching models",
  "暂无可用模型": "No models available",
  "搜索模型": "Search models",
  "请选择": "Please select",
  "保存修改": "Save Changes",
  "加载中...": "Loading...",
  "复制": "Copy",
  "已复制": "Copied",
  "删除": "Delete",
  "关闭": "Close",
  "开启": "Enable",
  "暂停": "Pause",
  "已暂停": "Paused",
  "运行中": "Running",
  "已启用": "Enabled",
  "未启用": "Disabled",
  "已停用": "Disabled",
  "还没有任务": "No tasks yet",
  "任务详情加载失败": "Failed to load task details",
  "请刷新后重试，或检查任务是否已被删除":
    "Refresh and try again, or check whether the task has been deleted",
  "暂无任务详情": "No task details",
  "选择任务查看日志": "Select a task to view logs",
  "创建并启动任务后，这里会展示运行状态与 stdout.log":
    "Once a task is created and started, its status and stdout.log will appear here",
  "从左侧选择一个任务，这里会实时显示执行输出":
    "Select a task on the left to see live output here",
  "点击任务可查看 stdout.log": "Click a task to view stdout.log",
  "启动": "Start",
  "停止": "Stop",
  "启动任务失败": "Failed to start task",
  "停止任务失败": "Failed to stop task",
  "删除任务失败": "Failed to delete task",
  "添加 MCP 服务": "Add MCP Service",
  "编辑 MCP 服务": "Edit MCP Service",
  "还没有 MCP 服务，点击右上角按钮添加":
    "No MCP services yet. Click the button in the top right to add one",
  "服务名称": "Service Name",
  "请输入服务名称": "Enter a service name",
  "服务地址": "Service Path",
  "启动命令": "Command",
  "请输入启动命令": "Enter a startup command",
  "命令参数": "Arguments",
  "工作目录": "Working Directory",
  "可选，例如：/Users/lei/Projects/vivid":
    "Optional, for example: /Users/lei/Projects/vivid",
  "环境变量": "Environment Variables",
  "每行一个，格式 KEY=VALUE": "One per line, in KEY=VALUE format",
  "服务 URL": "Service URL",
  "请输入服务 URL": "Enter a service URL",
  "请求头": "Headers",
  "标准输入输出": "stdio",
  "添加服务": "Add Service",
  "表单校验失败": "Form validation failed",
  "切换 MCP 状态失败": "Failed to toggle MCP service",
  "工具": "Tools",
  "更新时间": "Updated",
  "仓库添加成功": "Repository added",
  "添加仓库失败": "Failed to add repository",
  "安装": "Install",
  "安装失败": "Install failed",
  "已安装": "Installed",
  "卸载技能失败": "Failed to uninstall skill",
  "同步仓库元信息失败": "Failed to sync repository metadata",
  "请输入仓库地址": "Enter a repository URL",
  "暂无已安装技能，请先从仓库安装":
    "No skills installed yet. Install one from a repository first",
  "暂无描述": "No description",
  "Agent 已删除": "Agent deleted",
  "创建失败": "Create failed",
  "删除失败": "Delete failed",
  "应用预览": "App Preview",
  "打开目录": "Open Folder",
  "刷新": "Refresh",
  "独立窗口展示": "Open in Window",
  "打开目录失败": "Failed to open folder",
  "打开全局预览失败": "Failed to open standalone preview",
  "素材加载中...": "Loading assets...",
  "暂无素材": "No assets yet",
  "所有的音视频素材都将汇聚于此，可以试试直接给我说 “生成一张漂亮的落日照片“":
    "All image, audio, and video assets will appear here. Try asking me to generate a beautiful sunset photo.",
  "点击使用系统预览打开": "Click to open with the system preview",
  "素材路径不可用，无法打开系统预览":
    "The asset path is unavailable and cannot be opened in the system preview",
  "打开系统预览失败": "Failed to open the system preview",
  "图片": "Image",
  "视频": "Video",
  "音频": "Audio",
  "对话列表": "Chat List",
  "展开对话列表": "Expand chat list",
  "折叠对话列表": "Collapse chat list",
  "文件列表": "File List",
  "展开文件列表": "Expand file list",
  "折叠文件列表": "Collapse file list",
  "对话历史": "Chat History",
  "修改对话名称失败": "Failed to rename chat",
  "删除对话": "Delete chat",
  "删除对话失败": "Failed to delete chat",
  "发送失败": "Failed to send",
  "打断失败": "Failed to interrupt",
  "当前环境无法读取文件路径":
    "File paths cannot be read in the current environment",
  "添加文件": "Add file",
  "有什么吩咐...": "What would you like me to do?",
  "继续发送消息修正我的行为...":
    "Keep sending messages to correct my behavior...",
  "点击在 Finder 中查看": "Click to reveal in Finder",
  "代码块": "Code",
  "未知 Mermaid 渲染错误": "Unknown Mermaid render error",
  "流式输出失败": "Streaming output failed",
  "引导自动配置": "Guided Setup",
  "手动配置": "Manual Setup",
  "已向 Kian 发送自动配置请求":
    "Automatic setup request sent to Kian",
  "自动配置请求发送失败":
    "Failed to send the automatic setup request",
  "执行时间：": "Run time:",
  "切换状态失败": "Failed to toggle status",
  "点击卡片可切换状态": "Click a card to toggle its status",
  "文件": "Files",
  "新文件.md": "New File.md",
  "新文件夹": "New Folder",
  "已生成副本": "Duplicate created",
  "复制文件失败": "Failed to duplicate file",
  "文件已删除": "File deleted",
  "删除文件失败": "Failed to delete file",
  "文件夹已删除": "Folder deleted",
  "删除文件夹失败": "Failed to delete folder",
  "创建文件失败": "Failed to create file",
  "创建文件夹失败": "Failed to create folder",
  "重命名文件失败": "Failed to rename file",
  "自动保存失败": "Auto-save failed",
  "企业微信": "WeCom",
  "飞书": "Feishu",
  "允许用户 user_id": "Allowed user_id",
  "多个 user_id 使用换行、空格或逗号分隔。":
    "Separate multiple user_id values with new lines, spaces, or commas.",
  "允许服务器 ID": "Allowed Server IDs",
  "允许频道 ID": "Allowed Channel IDs",
  "服务器 ID 必须为纯数字": "Server IDs must be numeric",
  "频道 ID 必须为纯数字": "Channel IDs must be numeric",
  "启用 Telegram 前请先输入 Bot Token":
    "Enter a Bot Token before enabling Telegram",
  "启用 Telegram 前请先填写 user_id":
    "Enter at least one user_id before enabling Telegram",
  "启用 Discord 前请先输入 Bot Token":
    "Enter a Bot Token before enabling Discord",
  "启用 Discord 前请先填写允许服务器 ID":
    "Enter at least one server ID before enabling Discord",
  "启用 Discord 前请先填写允许频道 ID":
    "Enter at least one channel ID before enabling Discord",
  "飞书应用 AppID": "Feishu App ID",
  "飞书应用 AppSecret": "Feishu App Secret",
  "启用飞书前请先输入 AppID":
    "Enter an App ID before enabling Feishu",
  "启用飞书前请先输入 AppSecret":
    "Enter an App Secret before enabling Feishu",
  "渠道名称": "Channel Name",
  "聊天": "Chat",
  "刚刚": "Just now",
};

const KO_KR_EXACT: Record<string, string> = {
  "Kian - AI 短剧创作": "Kian - AI 숏드라마 제작",
  "智能体": "에이전트",
  "设置": "설정",
  "MCP 服务": "MCP 서비스",
  "后台任务": "백그라운드 작업",
  "定时任务": "예약 작업",
  "技能": "스킬",
  "文档": "문서",
  "音视频创作": "오디오/비디오 제작",
  "素材": "소재",
  "应用": "앱",
  "主 Agent": "메인 에이전트",
  "打开主智能体": "메인 에이전트 열기",
  "重启升级到新版本": "다시 시작하여 업데이트",
  "新版本": "새 버전",
  "通用": "일반",
  "快捷键": "단축키",
  "语言模型": "언어 모델",
  "音视频模型": "오디오/비디오 모델",
  "渠道": "채널",
  "广播渠道": "브로드캐스트 채널",
  "关于": "정보",
  "数据存放目录": "데이터 디렉터리",
  "修改后需要重启应用才能生效。默认：~/KianWorkspace":
    "변경 후 앱을 다시 시작해야 적용됩니다. 기본값: ~/KianWorkspace",
  "数据存放目录不能为空": "데이터 디렉터리를 입력하세요",
  "打开链接的方式": "링크 열기 방식",
  "选择应用内打开，或交给系统默认浏览器处理。":
    "앱 내 브라우저 또는 시스템 기본 브라우저를 선택하세요.",
  "内置浏览器": "내장 브라우저",
  "系统默认浏览器": "시스템 브라우저",
  "语言": "언어",
  "选择界面显示语言。": "UI 언어를 선택하세요.",
  "中文": "중국어",
  "英文": "영어",
  "韩文": "한국어",
  "日文": "일본어",
  "正在加载快捷键配置...": "단축키 설정 불러오는 중...",
  "发送消息": "메시지 보내기",
  "输入换行": "줄바꿈 입력",
  "聚焦主 Agent 输入框": "메인 에이전트 입력창 포커스",
  "打开设置页面": "설정 열기",
  "新建对话": "새 대화",
  "恢复默认": "기본값 복원",
  "按下快捷键组合": "단축키 입력",
  "录制中": "기록 중",
  "点击后录制": "클릭 후 기록",
  "配置保存中": "설정 저장 중",
  "配置已经保存": "설정이 저장됨",
  "当前已是最新版本": "이미 최신 버전입니다",
  "新版本已下载完成，可以安装":
    "새 버전 다운로드 완료, 설치할 수 있습니다",
  "发现新版本，正在下载": "새 버전을 찾았습니다. 다운로드 중입니다",
  "检查更新失败": "업데이트 확인 실패",
  "安装更新失败": "업데이트 설치 실패",
  "正在检查更新": "업데이트 확인 중",
  "发现新版本": "새 버전 발견",
  "正在下载更新": "업데이트 다운로드 중",
  "正在校验更新包": "업데이트 패키지 검증 중",
  "更新已下载，可安装": "업데이트 다운로드 완료, 설치 가능",
  "更新失败": "업데이트 실패",
  "未检查更新": "업데이트 확인 안 함",
  "无匹配模型": "일치하는 모델 없음",
  "暂无可用模型": "사용 가능한 모델 없음",
  "搜索模型": "모델 검색",
  "请选择": "선택하세요",
  "加载中...": "불러오는 중...",
  "复制": "복사",
  "已复制": "복사됨",
  "删除": "삭제",
  "关闭": "닫기",
  "开启": "사용",
  "暂停": "일시 중지",
  "已暂停": "일시 중지됨",
  "运行中": "실행 중",
  "已启用": "활성화됨",
  "未启用": "비활성화됨",
  "已停用": "비활성화됨",
  "还没有任务": "아직 작업이 없습니다",
  "任务详情加载失败": "작업 상세를 불러오지 못했습니다",
  "暂无任务详情": "작업 상세 없음",
  "选择任务查看日志": "작업을 선택해 로그 보기",
  "启动": "시작",
  "停止": "중지",
  "添加 MCP 服务": "MCP 서비스 추가",
  "编辑 MCP 服务": "MCP 서비스 편집",
  "服务名称": "서비스 이름",
  "启动命令": "실행 명령",
  "命令参数": "명령 인자",
  "工作目录": "작업 디렉터리",
  "环境变量": "환경 변수",
  "服务 URL": "서비스 URL",
  "请求头": "헤더",
  "添加服务": "서비스 추가",
  "表单校验失败": "양식 검증 실패",
  "切换 MCP 状态失败": "MCP 상태 전환 실패",
  "工具": "도구",
  "更新时间": "업데이트 시각",
  "仓库添加成功": "저장소 추가 완료",
  "添加仓库失败": "저장소 추가 실패",
  "安装": "설치",
  "安装失败": "설치 실패",
  "已安装": "설치됨",
  "卸载技能失败": "스킬 제거 실패",
  "同步仓库元信息失败": "저장소 메타데이터 동기화 실패",
  "请输入仓库地址": "저장소 주소를 입력하세요",
  "暂无已安装技能，请先从仓库安装":
    "설치된 스킬이 없습니다. 먼저 저장소에서 설치하세요",
  "暂无描述": "설명 없음",
  "应用预览": "앱 미리보기",
  "打开目录": "폴더 열기",
  "刷新": "새로고침",
  "独立窗口展示": "별도 창으로 열기",
  "素材加载中...": "소재 불러오는 중...",
  "暂无素材": "아직 소재가 없습니다",
  "对话列表": "대화 목록",
  "文件列表": "파일 목록",
  "对话历史": "대화 기록",
  "发送失败": "전송 실패",
  "打断失败": "중단 실패",
  "添加文件": "파일 추가",
  "有什么吩咐...": "무엇을 도와드릴까요?",
  "继续发送消息修正我的行为...": "계속 메시지를 보내 제 동작을 수정해 주세요...",
  "代码块": "코드",
  "引导自动配置": "가이드 자동 설정",
  "手动配置": "수동 설정",
  "执行时间：": "실행 시간:",
  "文件": "파일",
  "新文件.md": "새 파일.md",
  "新文件夹": "새 폴더",
  "自动保存失败": "자동 저장 실패",
  "飞书": "Feishu",
  "企业微信": "WeCom",
  "聊天": "채팅",
  "刚刚": "방금",
};

const JA_JP_EXACT: Record<string, string> = {
  "Kian - AI 短剧创作": "Kian - AI短編ドラマ制作",
  "智能体": "エージェント",
  "设置": "設定",
  "MCP 服务": "MCP サービス",
  "后台任务": "バックグラウンドタスク",
  "定时任务": "定期タスク",
  "技能": "スキル",
  "文档": "ドキュメント",
  "音视频创作": "音声・動画制作",
  "素材": "アセット",
  "应用": "アプリ",
  "主 Agent": "メインエージェント",
  "打开主智能体": "メインエージェントを開く",
  "重启升级到新版本": "再起動して更新",
  "新版本": "新規",
  "通用": "一般",
  "快捷键": "ショートカット",
  "语言模型": "言語モデル",
  "音视频模型": "音声・動画モデル",
  "渠道": "チャネル",
  "广播渠道": "配信チャネル",
  "关于": "情報",
  "数据存放目录": "データ保存先",
  "修改后需要重启应用才能生效。默认：~/KianWorkspace":
    "変更後はアプリの再起動が必要です。デフォルト: ~/KianWorkspace",
  "数据存放目录不能为空": "データ保存先は必須です",
  "打开链接的方式": "リンクの開き方",
  "选择应用内打开，或交给系统默认浏览器处理。":
    "アプリ内ブラウザまたはシステム既定のブラウザを選択します。",
  "内置浏览器": "内蔵ブラウザ",
  "系统默认浏览器": "システムブラウザ",
  "语言": "言語",
  "选择界面显示语言。": "UI 言語を選択します。",
  "中文": "中国語",
  "英文": "英語",
  "韩文": "韓国語",
  "日文": "日本語",
  "正在加载快捷键配置...": "ショートカット設定を読み込み中...",
  "发送消息": "メッセージ送信",
  "输入换行": "改行入力",
  "聚焦主 Agent 输入框": "メインエージェント入力欄にフォーカス",
  "打开设置页面": "設定を開く",
  "新建对话": "新しい会話",
  "恢复默认": "初期値に戻す",
  "按下快捷键组合": "ショートカットを入力",
  "录制中": "記録中",
  "点击后录制": "クリックして記録",
  "配置保存中": "設定を保存中",
  "配置已经保存": "設定を保存しました",
  "当前已是最新版本": "すでに最新バージョンです",
  "新版本已下载完成，可以安装":
    "新しいバージョンのダウンロードが完了し、インストールできます",
  "发现新版本，正在下载": "新しいバージョンを検出しました。ダウンロード中です",
  "检查更新失败": "更新の確認に失敗しました",
  "安装更新失败": "更新のインストールに失敗しました",
  "正在检查更新": "更新を確認中",
  "发现新版本": "新しいバージョンがあります",
  "正在下载更新": "更新をダウンロード中",
  "正在校验更新包": "更新パッケージを検証中",
  "更新已下载，可安装": "更新をダウンロード済み、インストール可能",
  "更新失败": "更新に失敗しました",
  "未检查更新": "未確認",
  "无匹配模型": "一致するモデルがありません",
  "暂无可用模型": "利用可能なモデルがありません",
  "搜索模型": "モデルを検索",
  "请选择": "選択してください",
  "加载中...": "読み込み中...",
  "复制": "コピー",
  "已复制": "コピーしました",
  "删除": "削除",
  "关闭": "閉じる",
  "开启": "有効化",
  "暂停": "一時停止",
  "已暂停": "一時停止中",
  "运行中": "実行中",
  "已启用": "有効",
  "未启用": "無効",
  "已停用": "無効",
  "还没有任务": "まだタスクはありません",
  "任务详情加载失败": "タスク詳細の読み込みに失敗しました",
  "暂无任务详情": "タスク詳細はありません",
  "选择任务查看日志": "タスクを選択してログを表示",
  "启动": "開始",
  "停止": "停止",
  "添加 MCP 服务": "MCP サービスを追加",
  "编辑 MCP 服务": "MCP サービスを編集",
  "服务名称": "サービス名",
  "启动命令": "起動コマンド",
  "命令参数": "コマンド引数",
  "工作目录": "作業ディレクトリ",
  "环境变量": "環境変数",
  "服务 URL": "サービス URL",
  "请求头": "ヘッダー",
  "添加服务": "サービスを追加",
  "表单校验失败": "フォーム検証に失敗しました",
  "切换 MCP 状态失败": "MCP 状態の切り替えに失敗しました",
  "工具": "ツール",
  "更新时间": "更新時刻",
  "仓库添加成功": "リポジトリを追加しました",
  "添加仓库失败": "リポジトリの追加に失敗しました",
  "安装": "インストール",
  "安装失败": "インストールに失敗しました",
  "已安装": "インストール済み",
  "卸载技能失败": "スキルのアンインストールに失敗しました",
  "同步仓库元信息失败": "リポジトリメタデータの同期に失敗しました",
  "请输入仓库地址": "リポジトリ URL を入力してください",
  "暂无已安装技能，请先从仓库安装":
    "インストール済みのスキルはありません。先にリポジトリからインストールしてください",
  "暂无描述": "説明なし",
  "应用预览": "アプリプレビュー",
  "打开目录": "フォルダを開く",
  "刷新": "更新",
  "独立窗口展示": "別ウィンドウで開く",
  "素材加载中...": "アセットを読み込み中...",
  "暂无素材": "まだアセットはありません",
  "对话列表": "会話一覧",
  "文件列表": "ファイル一覧",
  "对话历史": "会話履歴",
  "发送失败": "送信に失敗しました",
  "打断失败": "中断に失敗しました",
  "添加文件": "ファイルを追加",
  "有什么吩咐...": "何をしましょうか？",
  "继续发送消息修正我的行为...": "続けてメッセージを送り、私の動作を修正してください...",
  "代码块": "コード",
  "引导自动配置": "ガイド付き自動設定",
  "手动配置": "手動設定",
  "执行时间：": "実行時間:",
  "文件": "ファイル",
  "新文件.md": "新規ファイル.md",
  "新文件夹": "新規フォルダ",
  "自动保存失败": "自動保存に失敗しました",
  "飞书": "Feishu",
  "企业微信": "WeCom",
  "聊天": "チャット",
  "刚刚": "たった今",
};

const EXACT_TRANSLATIONS: Record<AppLanguage, Record<string, string>> = {
  "zh-CN": {},
  "en-US": EN_US_EXACT,
  "ko-KR": KO_KR_EXACT,
  "ja-JP": JA_JP_EXACT,
};

const EXTRA_EXACT_TRANSLATIONS: Record<AppLanguage, Record<string, string>> = {
  "zh-CN": {},
  "en-US": {
    "# 新文档\n\n在这里记录你的音视频创作笔记。\n":
      "# New Document\n\nWrite your audio and video creation notes here.\n",
    "# 新文档\n\n在这里记录你的音视频创作笔记。":
      "# New Document\n\nWrite your audio and video creation notes here.",
    "Agent 名称保存失败": "Failed to save agent name",
    "AI 生成": "AI Generated",
    "Angular 应用": "Angular App",
    "HTTP 类型必须提供 URL": "HTTP transport requires a URL",
    "ID 必须为正整数": "ID must be a positive integer",
    "MCP 服务 ID 无效": "Invalid MCP service ID",
    "Next.js 应用": "Next.js App",
    "Nuxt 应用": "Nuxt App",
    "React 应用": "React App",
    "stdio 类型必须提供命令": "stdio transport requires a command",
    "Svelte 应用": "Svelte App",
    "URL 必须是合法的 http/https 地址":
      "URL must be a valid http/https address",
    "user_id 必须为纯数字": "user_id must be numeric",
    "Vue 应用": "Vue App",
    "Web 应用": "Web App",
    "Webhook 必须为合法的 https URL":
      "Webhook must be a valid https URL",
    "中文 (简体)": "Chinese (Simplified)",
    "主 Agent 委派回执": "Main Agent Delegation Receipt",
    "任务 ID 不能为空": "Task ID is required",
    "任务 ID 格式不正确": "Invalid task ID format",
    "任务 ID 过长": "Task ID is too long",
    "会话：": "Session:",
    "例如：/Users/lei/Projects": "Example: /Users/lei/Projects",
    "例如：Figma MCP / Browser MCP": "Example: Figma MCP / Browser MCP",
    "例如：https://example.com/mcp": "Example: https://example.com/mcp",
    "例如：npx -y @modelcontextprotocol/server-filesystem":
      "Example: npx -y @modelcontextprotocol/server-filesystem",
    "保存失败": "Save failed",
    "停止运行中的任务失败，已取消退出。":
      "Failed to stop running tasks. Quit was canceled.",
    "凭证长度至少 10 位": "Credential must be at least 10 characters",
    "创建中...": "Creating...",
    "取消": "Cancel",
    "启用": "Active",
    "启用 Provider 时必须设置 API Key":
      "API key is required when enabling a provider",
    "启用模型": "Enabled Models",
    "在聊天里触发命令执行后，任务会自动出现在这里":
      "Tasks will appear here automatically after a command is executed in chat",
    "失败": "Failed",
    "委派编号：": "Delegation ID:",
    "对话": "Chat",
    "展开": "Expand",
    "工具输出": "Tool Output",
    "已完成": "Completed",
    "已自动保存": "Auto-saved",
    "已设置": "Configured",
    "应用页面加载失败": "Failed to load app page",
    "建议补充氛围音效": "Suggested ambient sound effects",
    "建议过场 B-roll": "Suggested transition B-roll",
    "开发环境页面加载失败": "Failed to load development page",
    "当前仓库未解析到技能（未找到 SKILL.md）":
      "No skill was found in the current repository (SKILL.md not found)",
    "仓库地址不能为空": "Repository URL cannot be empty",
    "仓库地址格式不正确": "Repository URL format is invalid",
    "当前仅支持 GitHub 仓库": "Only GitHub repositories are supported",
    "仓库地址需包含 owner/repo":
      "Repository URL must include owner/repo",
    "技能路径不能为空": "Skill path cannot be empty",
    "技能路径不合法": "Skill path is invalid",
    "未检测到 tar 命令，无法解压技能仓库归档":
      "Tar was not found, so the skill repository archive cannot be extracted",
    "未检测到 git 命令，无法通过仓库缓存安装技能":
      "Git was not found, so the skill cannot be installed from the repository cache",
    "未找到技能目录，无法安装该技能":
      "Skill directory was not found, so the skill cannot be installed",
    "技能路径不是目录，无法安装该技能":
      "Skill path is not a directory, so the skill cannot be installed",
    "未找到 SKILL.md，无法安装该技能":
      "SKILL.md was not found, so the skill cannot be installed",
    "快捷键提示关闭状态保存失败":
      "Failed to save shortcut tip dismissal state",
    "思考等级": "Reasoning Level",
    "所有文件": "All Files",
    "打开链接失败": "Failed to open link",
    "搜索素材": "Search assets",
    "支持的文件": "Supported Files",
    "支持逗号或换行分隔": "Comma or newline separated",
    "文件为空": "File is empty",
    "新对话": "New Chat",
    "新建": "New",
    "新建 Agent": "New Agent",
    "新文件": "New File",
    "无法在 Finder 中打开文件": "Unable to reveal file in Finder",
    "日本語": "Japanese",
    "暂无 Prompt": "No prompt yet",
    "暂无摘要": "No summary available",
    "暂无对话": "No chats yet",
    "暂无文件": "No files yet",
    "暂无输出": "No output yet",
    "元信息更新中或暂不可用":
      "Metadata is updating or temporarily unavailable",
    "更新 MCP 服务失败": "Failed to update MCP service",
    "更新技能可见性失败": "Failed to update skill visibility",
    "加载仓库技能失败": "Failed to load repository skills",
    "服务地址": "Service Address",
    "已安装技能": "Installed Skills",
    "技能仓库": "Skill Repositories",
    "仓库技能": "Repository Skills",
    "内置": "Built-in",
    "卸载": "Uninstall",
    "未知 Agent": "Unknown Agent",
    "未知状态": "Unknown Status",
    "未设置": "Not Set",
    "未配置 URL": "URL not configured",
    "未配置命令": "Command not configured",
    "双击修改对话名称": "Double-click to rename chat",
    "不再提示": "Don't show again",
    "上次构建：": "Last build:",
    "命令：": "Command:",
    "子智能体 回报": "Sub-agent Report",
    "已停止": "Stopped",
    "已启用的服务会在下一轮 Agent 对话时自动注入运行时":
      "Enabled services are automatically injected into the next Agent conversation",
    "在 Finder 中查看": "Reveal in Finder",
    "在对话中描述你想要的应用，构建后将在此预览":
      "Describe the app you want in chat. It will be previewed here after the build finishes.",
    "展示全部": "Show all",
    "来自 Agent ": "From Agent ",
    "来自主 Agent 的委派": "Delegation from Main Agent",
    "主智能体": "Main Agent",
    "模块：": "Module:",
    "正在努力工作中": "Working on it",
    "正在加载文本预览...": "Loading text preview...",
    "消息内容或附件至少填写一项":
      "Either a message or at least one attachment is required",
    "视频场景": "Video Scenes",
    "查看详情": "View details",
    "有什么可以帮你的吗？": "How can I help?",
    "暂无内容": "No content",
    "暂无定时任务": "No scheduled tasks",
    "等待应用构建": "Waiting for build",
    "输入参数": "Input",
    "执行结果": "Result",
    "备注": "Notes",
    "换行。": "for newline.",
    "发送，": "to send,",
    "还没有分镜场景": "No storyboard scenes yet",
    "点击任务可查看 stdout.log": "Click a task to view stdout.log",
    "在右侧描述剧情和风格，AI 会自动生成场景与镜头。":
      "Describe the plot and style on the right. AI will generate scenes and shots automatically.",
    "添加": "Add",
    "添加仓库": "Add Repository",
    "添加 MCP 服务失败": "Failed to add MCP service",
    "状态：": "Status:",
    "子智能体": "Sub Agent",
    "用户": "User",
    "界面加载失败": "Interface Failed to Load",
    "留空表示保持当前凭证不变":
      "Leave empty to keep the current credential unchanged",
    "相对路径必须提供 projectId":
      "A projectId is required when using a relative path",
    "知道了": "OK",
    "确认退出 Kian": "Quit Kian?",
    "视图": "View",
    "窗口": "Window",
    "编辑": "Edit",
    "编辑模式": "Edit Mode",
    "缺少待编辑的 MCP 服务": "No MCP service selected for editing",
    "自动保存中...": "Auto-saving...",
    "至少传入一个更新字段": "At least one field must be provided for update",
    "请先选择仓库": "Select a repository first",
    "重试": "Retry",
    "请帮我安装 Claude Code（命令：curl -fsSL https://claude.ai/install.sh | bash），安装后请验证 claude --version，并告诉我下一步如何开始使用。":
      "Please help me install Claude Code (command: curl -fsSL https://claude.ai/install.sh | bash). After installation, verify claude --version and tell me what to do next.",
    "请帮我完成 Kian 的渠道配置准备：先判断我更适合 Telegram、Discord 还是飞书；给出最短配置步骤；最后引导我在设置-渠道中完成必填项并启用。":
      "Please help me prepare Kian channel setup: first decide whether Telegram, Discord, or Feishu fits me best; then give me the shortest setup steps; finally guide me to complete the required fields and enable it in Settings > Channels.",
    "请帮我检查并安装 Node.js 与 pnpm。优先使用 nvm 安装 Node.js 24，再执行 corepack enable pnpm。完成后请验证 node -v 和 pnpm -v，并把执行结果发给我。":
      "Please help me check and install Node.js and pnpm. Prefer installing Node.js 24 with nvm, then run corepack enable pnpm. After that, verify node -v and pnpm -v, and send me the results.",
    "请至少启用一个模型": "Enable at least one model",
    "路径超出 Agent 工作区目录范围":
      "The path is outside the agent workspace",
    "输入 GitHub 仓库地址，例如 https://github.com/owner/repo":
      "Enter a GitHub repository URL, for example https://github.com/owner/repo",
    "输入多个服务器 ID，每个 ID 按回车生成标签。":
      "Enter multiple server IDs and press Enter after each one to create a tag.",
    "输入多个频道 ID，每个 ID 按回车生成标签。":
      "Enter multiple channel IDs and press Enter after each one to create a tag.",
    "输入文件名称": "Enter file name",
    "输入文件夹名称": "Enter folder name",
    "输入服务器 ID 后按回车": "Press Enter after entering a server ID",
    "输入频道 ID 后按回车": "Press Enter after entering a channel ID",
    "退出后会立即停止这些任务及其子进程。":
      "Quitting will immediately stop these tasks and their child processes.",
    "退出失败": "Quit Failed",
    "退出并停止任务": "Quit and Stop Tasks",
    "选择要发送的文件": "Choose Files to Send",
    "重命名": "Rename",
    "重命名文件夹失败": "Failed to rename folder",
    "阅读模式": "Read Mode",
    "隐藏手动配置": "Hide Manual Setup",
    "预览失败": "Preview failed",
    "同步元信息": "Sync Metadata",
    "管理已安装的技能，可控制主 Agent / 子智能体的可见性，并卸载不需要的技能（内置技能不可卸载）。":
      "Manage installed skills, control visibility for the Main Agent and sub agents, and uninstall skills you no longer need (built-in skills cannot be removed).",
    "内置仓库来自仓库目录 skills/repositories.json。你也可以添加自定义 GitHub 仓库。":
      "Built-in repositories come from skills/repositories.json. You can also add custom GitHub repositories.",
    "可以试试让 Kian 来帮你修改或者创建文档":
      "Try asking Kian to edit or create a document for you",
    "选择 Provider 标签页来切换接入方式，配置对应的 API Key 并启用模型。":
      "Switch Provider tabs to choose an integration, configure the corresponding API key, and enable models.",
    "当前支持 fal Provider。你可以配置 fal API Key，并启用可用于生图/生视频的模型。":
      "fal is currently supported. You can configure the fal API key and enable image and video generation models.",
    "所有渠道消息统一发送到主 Agent，子智能体 聊天仍可在桌面端查看。":
      "All channel messages are sent to the Main Agent. Sub-agent chats can still be viewed on desktop.",
    "所有的音视频素材都将汇聚于此，可以试试直接给我说 “生成一张漂亮的落日照片“":
      "All image, audio, and video assets will appear here. Try asking me to generate a beautiful sunset photo.",
    "Telegram 接入方式指引": "Telegram Setup Guide",
    "1. 在 Telegram 中通过 BotFather 创建 Bot，并获取 Bot Token。":
      "1. In Telegram, create a bot with BotFather and get the Bot Token.",
    "2. 给 Bot 发送消息，获取自己的 user_id（纯数字）。":
      "2. Send a message to the bot to get your user_id (digits only).",
    "3. 配置允许与 Bot 对话的 user_id 列表。":
      "3. Configure the list of user_id values allowed to talk to the bot.",
    "Discord 接入方式指引": "Discord Setup Guide",
    "1. 在 Discord Developer Portal 创建应用并添加 Bot，复制 Bot Token。":
      "1. Create an app in the Discord Developer Portal, add a bot, and copy the Bot Token.",
    "2. 将 Bot 邀请进目标服务器并授予可读取/发送消息权限。":
      "2. Invite the bot into the target server and grant read/send message permissions.",
    "3. 配置允许接入的服务器 ID 与频道 ID。":
      "3. Configure the allowed server IDs and channel IDs.",
    "飞书接入方式指引": "Feishu Setup Guide",
    "1. 在飞书开发者后台创建应用，获取 app_id 与 app_secret。":
      "1. Create an app in the Feishu developer console and get the app_id and app_secret.",
    "2. 在配置中分别填写 AppID 与 AppSecret。":
      "2. Fill in the AppID and AppSecret in the configuration.",
    "3. 事件与回调使用长链接接受事件，添加 im.message.receive_v1 事件。":
      "3. Use long connections for events and callbacks, and add the im.message.receive_v1 event.",
    "4. 添加 im:message 和 im:resource 权限。":
      "4. Add the im:message and im:resource permissions.",
    "5. 成员管理中只添加自己（自己使用确保安全，同时可以免审核发布）。":
      "5. In member management, add only yourself for safer personal use and review-free publishing.",
    "新增渠道": "Add Channel",
    "使用哪个渠道广播消息，Kian 说了算。":
      "Kian decides which channel to use for broadcasting.",
    "正在加载广播渠道...": "Loading broadcast channels...",
    "还没有广播渠道，点击“新增渠道”开始配置。":
      "No broadcast channels yet. Click “Add Channel” to start configuring.",
    "如何获取飞书群机器人 Webhook":
      "How to get a Feishu group bot webhook",
    "1. 打开目标飞书群，点击右上角”设置”。":
      "1. Open the target Feishu group and click “Settings” in the top right.",
    "2. 进入”群机器人”，添加”自定义机器人”。":
      "2. Enter “Group Bots” and add a “Custom Bot”.",
    "3. 按提示设置机器人名称与安全策略（如关键词或签名）。":
      "3. Follow the prompts to set the bot name and security policy, such as keywords or signatures.",
    "4. 创建完成后复制 Webhook 地址，粘贴到上方渠道配置中。":
      "4. After creation, copy the webhook URL and paste it into the channel configuration above.",
    "如何获取企业微信群机器人 Webhook":
      "How to get a WeCom group bot webhook",
    "1. 打开企业微信桌面端，进入目标群聊。":
      "1. Open the WeCom desktop app and enter the target group chat.",
    "2. 右键群聊，选择”添加群机器人”，点击”新创建一个机器人”。":
      "2. Right-click the group chat, choose “Add Group Bot”, and click “Create a New Bot”.",
    "3. 设置机器人名称和头像，点击”添加”。":
      "3. Set the bot name and avatar, then click “Add”.",
    "当前版本": "Current Version",
    "检查更新": "Check for Updates",
    "最新版本：": "Latest Version:",
    "安装更新": "Install Update",
    "未安装": "Not Installed",
    "快速引导": "Quick Start",
    "完成基础环境后，你就可以把开发和协作任务交给 Kian。":
      "Once the basic environment is ready, you can hand development and collaboration tasks to Kian.",
    "重新检测": "Recheck",
    "主 Agent 入口": "Main Agent Entry",
    "主 Agent 会负责接待你，并在需要时把任务委派给对应的子智能体。":
      "The Main Agent greets you first and delegates tasks to the appropriate sub-agent when needed.",
    "打开主 Agent": "Open Main Agent",
    "前往 Agent 列表": "Go to Agent List",
    "Node.js 与 pnpm": "Node.js and pnpm",
    "启用后，你可以使用应用模块开发前端应用，也可以快速构建各类小应用和小游戏。":
      "Once enabled, you can build frontend apps in the App module and quickly create small apps and games.",
    "检测中": "Checking",
    "让 Kian 自动配置": "Let Kian Configure It",
    "打开 Node.js 下载页": "Open Node.js Download Page",
    "启用后，你可以把编程任务直接委托给 Kian，由它在对应 Agent 工作区中执行并反馈结果。":
      "Once enabled, you can delegate coding tasks directly to Kian, which will execute them in the corresponding agent workspace and report back.",
    "打开 Claude Code 文档": "Open Claude Code Docs",
    "渠道配置": "Channel Setup",
    "启用后，你可以在手机端通过 IM 聊天工具远程控制 Kian。":
      "Once enabled, you can remotely control Kian from your phone through an IM chat tool.",
    "已配置": "Configured",
    "未配置": "Not Configured",
    "图像生成（高质量文生图），适合角色设定图、海报风格镜头和高细节概念图。":
      "Image generation (high-quality text-to-image), suited for character design sheets, poster-style shots, and detailed concept art.",
    "图像生成（通用高质量），适合分镜草图到精修图的迭代。":
      "Image generation (general high quality), suited for iterating from storyboard sketches to polished images.",
    "图像生成（快速低延迟），适合前期创意探索与快速出图。":
      "Image generation (fast low latency), suited for early ideation and rapid image output.",
    "图像生成与编辑（Google Nano Banana），适合通用创意出图和快速图像改写。":
      "Image generation and editing (Google Nano Banana), suited for general creative image generation and quick image rewrites.",
    "图像编辑（Google Nano Banana Edit），支持多图输入进行重绘、替换和局部编辑。":
      "Image editing (Google Nano Banana Edit), supports multi-image input for repainting, replacement, and local edits.",
    "图像生成与编辑（Google Nano Banana Pro），支持 1K/2K/4K，适合高质量输出。":
      "Image generation and editing (Google Nano Banana Pro), supports 1K/2K/4K and is suited for high-quality output.",
    "图像编辑（Google Nano Banana Pro Edit），支持多图输入与 1K/2K/4K 输出。":
      "Image editing (Google Nano Banana Pro Edit), supports multi-image input and 1K/2K/4K output.",
    "视频生成（图生视频，轻量版），适合预演动画、分镜动态化和快速样片。":
      "Video generation (image-to-video, lite), suited for previs animation, animating storyboards, and quick sample clips.",
    "视频生成（图生视频，质量优先），适合关键镜头和更平滑动作生成。":
      "Video generation (image-to-video, quality-first), suited for key shots and smoother motion generation.",
    "视频生成（图生视频，v1.5 Pro），支持更丰富动态、720p/1080p 与可选生成音频。":
      "Video generation (image-to-video, v1.5 Pro), supports richer motion, 720p/1080p, and optional audio generation.",
    "Kling 视频生音频。": "Kling video-to-audio.",
    "Google Lyria 2 音乐生成。": "Google Lyria 2 music generation.",
    "한국어": "Korean",
  },
  "ko-KR": {
    "# 新文档\n\n在这里记录你的音视频创作笔记。\n":
      "# 새 문서\n\n여기에 오디오/비디오 제작 노트를 기록하세요.\n",
    "# 新文档\n\n在这里记录你的音视频创作笔记。":
      "# 새 문서\n\n여기에 오디오/비디오 제작 노트를 기록하세요.",
    "Agent 名称保存失败": "에이전트 이름 저장 실패",
    "Agent 已删除": "에이전트를 삭제했습니다",
    "AI 生成": "AI 생성",
    "Angular 应用": "Angular 앱",
    "HTTP 类型必须提供 URL": "HTTP 유형에는 URL이 필요합니다",
    "ID 必须为正整数": "ID는 양의 정수여야 합니다",
    "MCP 服务 ID 无效": "MCP 서비스 ID가 올바르지 않습니다",
    "Next.js 应用": "Next.js 앱",
    "Nuxt 应用": "Nuxt 앱",
    "React 应用": "React 앱",
    "stdio 类型必须提供命令": "stdio 유형에는 명령어가 필요합니다",
    "Svelte 应用": "Svelte 앱",
    "URL 必须是合法的 http/https 地址":
      "URL은 올바른 http/https 주소여야 합니다",
    "user_id 必须为纯数字": "user_id는 숫자만 입력해야 합니다",
    "Vue 应用": "Vue 앱",
    "Web 应用": "웹 앱",
    "Webhook 必须为合法的 https URL":
      "Webhook은 올바른 https URL이어야 합니다",
    "中文 (简体)": "중국어(간체)",
    "主 Agent 委派回执": "메인 에이전트 위임 영수증",
    "从左侧选择一个任务，这里会实时显示执行输出":
      "왼쪽에서 작업을 선택하면 여기에서 실행 출력을 실시간으로 볼 수 있습니다",
    "任务 ID 不能为空": "작업 ID는 비워 둘 수 없습니다",
    "任务 ID 格式不正确": "작업 ID 형식이 올바르지 않습니다",
    "任务 ID 过长": "작업 ID가 너무 깁니다",
    "任意页面下跳转到设置页面。":
      "어느 페이지에서나 설정 페이지로 이동합니다.",
    "任意页面下跳转并聚焦主 Agent 输入框。":
      "어느 페이지에서나 메인 에이전트 입력창으로 이동해 포커스합니다.",
    "会话：": "세션:",
    "例如：/Users/lei/Projects": "예: /Users/lei/Projects",
    "例如：Figma MCP / Browser MCP":
      "예: Figma MCP / Browser MCP",
    "例如：https://example.com/mcp":
      "예: https://example.com/mcp",
    "例如：npx -y @modelcontextprotocol/server-filesystem":
      "예: npx -y @modelcontextprotocol/server-filesystem",
    "保存修改": "변경 사항 저장",
    "保存失败": "저장 실패",
    "修改对话名称失败": "대화 이름 변경 실패",
    "停止任务失败": "작업 중지 실패",
    "停止运行中的任务失败，已取消退出。":
      "실행 중인 작업을 중지하지 못해 종료를 취소했습니다.",
    "允许服务器 ID": "허용된 서버 ID",
    "允许用户 user_id": "허용된 user_id",
    "允许频道 ID": "허용된 채널 ID",
    "凭证长度至少 10 位": "자격 증명은 10자 이상이어야 합니다",
    "切换状态失败": "상태 전환 실패",
    "创建中...": "생성 중...",
    "创建失败": "생성 실패",
    "创建并启动任务后，这里会展示运行状态与 stdout.log":
      "작업을 생성하고 시작하면 여기에 상태와 stdout.log가 표시됩니다",
    "创建文件失败": "파일 생성 실패",
    "创建文件夹失败": "폴더 생성 실패",
    "删除任务失败": "작업 삭제 실패",
    "删除失败": "삭제 실패",
    "删除对话": "대화 삭제",
    "删除对话失败": "대화 삭제 실패",
    "删除文件失败": "파일 삭제 실패",
    "删除文件夹失败": "폴더 삭제 실패",
    "加载仓库技能失败": "저장소 스킬을 불러오지 못했습니다",
    "双击修改对话名称": "대화 이름을 변경하려면 더블클릭",
    "不再提示": "다시 보지 않기",
    "取消": "취소",
    "可选，例如：/Users/lei/Projects/vivid":
      "선택 사항, 예: /Users/lei/Projects/vivid",
    "启动任务失败": "작업 시작 실패",
    "启用": "활성",
    "启用 Discord 前请先填写允许服务器 ID":
      "Discord를 활성화하기 전에 허용된 서버 ID를 입력하세요",
    "启用 Discord 前请先填写允许频道 ID":
      "Discord를 활성화하기 전에 허용된 채널 ID를 입력하세요",
    "启用 Discord 前请先输入 Bot Token":
      "Discord를 활성화하기 전에 Bot Token을 입력하세요",
    "启用 Provider 时必须设置 API Key":
      "Provider를 활성화하려면 API Key를 설정해야 합니다",
    "启用 Telegram 前请先填写 user_id":
      "Telegram을 활성화하기 전에 user_id를 입력하세요",
    "启用 Telegram 前请先输入 Bot Token":
      "Telegram을 활성화하기 전에 Bot Token을 입력하세요",
    "启用模型": "활성화된 모델",
    "启用飞书前请先输入 AppID":
      "Feishu를 활성화하기 전에 AppID를 입력하세요",
    "启用飞书前请先输入 AppSecret":
      "Feishu를 활성화하기 전에 AppSecret을 입력하세요",
    "图片": "이미지",
    "在聊天里触发命令执行后，任务会自动出现在这里":
      "채팅에서 명령 실행이 시작되면 작업이 여기에 자동으로 표시됩니다",
    "复制文件失败": "파일 복제 실패",
    "多个 user_id 使用换行、空格或逗号分隔。":
      "여러 user_id는 줄바꿈, 공백 또는 쉼표로 구분하세요.",
    "失败": "실패",
    "委派编号：": "위임 번호:",
    "对话": "대화",
    "展开": "펼치기",
    "展开对话列表": "대화 목록 펼치기",
    "展开文件列表": "파일 목록 펼치기",
    "工具输出": "도구 출력",
    "已向 Kian 发送自动配置请求":
      "Kian에 자동 설정 요청을 보냈습니다",
    "已完成": "완료됨",
    "已生成副本": "복사본이 생성되었습니다",
    "已自动保存": "자동 저장됨",
    "已设置": "설정됨",
    "应用页面加载失败": "앱 페이지를 불러오지 못했습니다",
    "建议补充氛围音效": "분위기 음향 효과를 추가하는 것을 추천합니다",
    "建议过场 B-roll": "전환용 B-roll을 추천합니다",
    "开发环境页面加载失败": "개발 환경 페이지를 불러오지 못했습니다",
    "当前仓库未解析到技能（未找到 SKILL.md）":
      "현재 저장소에서 스킬을 찾지 못했습니다(SKill.md 없음)",
    "仓库地址不能为空": "저장소 주소는 비워 둘 수 없습니다",
    "仓库地址格式不正确": "저장소 주소 형식이 올바르지 않습니다",
    "当前仅支持 GitHub 仓库": "현재는 GitHub 저장소만 지원합니다",
    "仓库地址需包含 owner/repo":
      "저장소 주소에는 owner/repo가 포함되어야 합니다",
    "技能路径不能为空": "스킬 경로는 비워 둘 수 없습니다",
    "技能路径不合法": "스킬 경로가 올바르지 않습니다",
    "未检测到 tar 命令，无法解压技能仓库归档":
      "tar 명령을 찾을 수 없어 스킬 저장소 아카이브를 압축 해제할 수 없습니다",
    "未检测到 git 命令，无法通过仓库缓存安装技能":
      "git 명령을 찾을 수 없어 저장소 캐시에서 스킬을 설치할 수 없습니다",
    "未找到技能目录，无法安装该技能":
      "스킬 디렉터리를 찾을 수 없어 스킬을 설치할 수 없습니다",
    "技能路径不是目录，无法安装该技能":
      "스킬 경로가 디렉터리가 아니어서 스킬을 설치할 수 없습니다",
    "未找到 SKILL.md，无法安装该技能":
      "SKILL.md를 찾을 수 없어 스킬을 설치할 수 없습니다",
    "当前环境无法读取文件路径": "현재 환경에서는 파일 경로를 읽을 수 없습니다",
    "已安装技能": "설치된 스킬",
    "快捷键提示关闭状态保存失败":
      "단축키 안내 닫힘 상태를 저장하지 못했습니다",
    "思考等级": "사고 수준",
    "所有文件": "모든 파일",
    "打开全局预览失败": "독립 미리보기를 열지 못했습니다",
    "打开目录失败": "폴더를 열지 못했습니다",
    "打开系统预览失败": "시스템 미리보기를 열지 못했습니다",
    "打开链接失败": "링크를 열지 못했습니다",
    "折叠对话列表": "대화 목록 접기",
    "折叠文件列表": "파일 목록 접기",
    "搜索素材": "소재 검색",
    "支持的文件": "지원되는 파일",
    "支持逗号或换行分隔": "쉼표 또는 줄바꿈으로 구분 가능",
    "文件为空": "파일이 비어 있습니다",
    "文件夹已删除": "폴더가 삭제되었습니다",
    "文件已删除": "파일이 삭제되었습니다",
    "暂无对话": "대화가 없습니다",
    "暂无文件": "파일이 없습니다",
    "新对话": "새 대화",
    "新建": "새로 만들기",
    "新建 Agent": "새 에이전트",
    "新建当前智能体的对话": "현재 에이전트의 새 대화를 만듭니다",
    "新文件": "새 파일",
    "无法在 Finder 中打开文件":
      "Finder에서 파일을 열 수 없습니다",
    "日本語": "일본어",
    "暂无 Prompt": "프롬프트가 없습니다",
    "暂无摘要": "요약이 없습니다",
    "暂无输出": "출력이 없습니다",
    "更新 MCP 服务失败": "MCP 서비스 업데이트 실패",
    "更新技能可见性失败": "스킬 표시 상태 업데이트 실패",
    "服务器 ID 必须为纯数字": "서버 ID는 숫자만 입력해야 합니다",
    "服务地址": "서비스 주소",
    "未知 Agent": "알 수 없는 에이전트",
    "未知 Mermaid 渲染错误": "알 수 없는 Mermaid 렌더링 오류",
    "未知状态": "알 수 없는 상태",
    "未设置": "설정되지 않음",
    "未配置 URL": "URL 미설정",
    "未配置命令": "명령어 미설정",
    "来自 Agent ": "에이전트에서 ",
    "来自主 Agent 的委派": "메인 에이전트의 위임",
    "标准输入输出": "표준 입출력",
    "主智能体": "메인 에이전트",
    "命令：": "명령:",
    "模块：": "모듈:",
    "子智能体 回报": "하위 에이전트 보고",
    "已停止": "중지됨",
    "已启用的服务会在下一轮 Agent 对话时自动注入运行时":
      "활성화된 서비스는 다음 Agent 대화 때 자동으로 런타임에 주입됩니다",
    "在 Finder 中查看": "Finder에서 보기",
    "在右侧描述剧情和风格，AI 会自动生成场景与镜头。":
      "오른쪽에서 줄거리와 스타일을 설명하면 AI가 장면과 숏을 자동으로 생성합니다.",
    "在对话中描述你想要的应用，构建后将在此预览":
      "대화에서 원하는 앱을 설명하세요. 빌드가 끝나면 여기에서 미리볼 수 있습니다.",
    "展示全部": "전체 보기",
    "正在努力工作中": "작업 중",
    "正在加载文本预览...": "텍스트 미리보기를 불러오는 중...",
    "每行一个，格式 KEY=VALUE": "한 줄에 하나씩, 형식은 KEY=VALUE",
    "元信息更新中或暂不可用":
      "메타데이터를 업데이트 중이거나 아직 사용할 수 없습니다",
    "流式输出失败": "스트리밍 출력 실패",
    "消息内容或附件至少填写一项":
      "메시지 내용 또는 첨부파일 중 하나는 반드시 입력해야 합니다",
    "视频场景": "비디오 장면",
    "查看详情": "자세히 보기",
    "有什么可以帮你的吗？": "무엇을 도와드릴까요?",
    "暂无内容": "내용이 없습니다",
    "暂无定时任务": "예약 작업이 없습니다",
    "等待应用构建": "앱 빌드를 기다리는 중",
    "输入参数": "입력 인수",
    "执行结果": "실행 결과",
    "备注": "메모",
    "换行。": "줄바꿈.",
    "发送，": "전송,",
    "还没有分镜场景": "스토리보드 장면이 없습니다",
    "点击任务可查看 stdout.log": "작업을 클릭하면 stdout.log를 볼 수 있습니다",
    "点击卡片可切换状态": "카드를 클릭하면 상태를 전환할 수 있습니다",
    "点击在 Finder 中查看": "클릭하여 Finder에서 보기",
    "添加": "추가",
    "添加仓库": "저장소 추가",
    "添加 MCP 服务失败": "MCP 서비스 추가 실패",
    "渠道名称": "채널 이름",
    "点击使用系统预览打开": "클릭하여 시스템 미리보기로 열기",
    "状态：": "상태:",
    "子智能体": "하위 에이전트",
    "用户": "사용자",
    "界面加载失败": "화면을 불러오지 못했습니다",
    "留空表示保持当前凭证不变":
      "비워 두면 현재 자격 증명을 유지합니다",
    "相对路径必须提供 projectId":
      "상대 경로를 사용할 때는 projectId가 필요합니다",
    "知道了": "확인",
    "确认退出 Kian": "Kian을 종료할까요?",
    "视图": "보기",
    "视频": "비디오",
    "窗口": "창",
    "素材路径不可用，无法打开系统预览":
      "소재 경로를 사용할 수 없어 시스템 미리보기를 열 수 없습니다",
    "编辑": "편집",
    "编辑模式": "편집 모드",
    "缺少待编辑的 MCP 服务":
      "편집할 MCP 서비스가 선택되지 않았습니다",
    "聚焦消息发送窗口时插入换行。":
      "메시지 입력창에 포커스가 있을 때 줄바꿈을 입력합니다.",
    "聚焦消息发送窗口时触发发送。":
      "메시지 입력창에 포커스가 있을 때 전송합니다.",
    "自动保存中...": "자동 저장 중...",
    "自动配置请求发送失败": "자동 설정 요청 전송 실패",
    "至少传入一个更新字段":
      "업데이트할 필드를 하나 이상 전달해야 합니다",
    "请先选择仓库": "먼저 저장소를 선택하세요",
    "请刷新后重试，或检查任务是否已被删除":
      "새로고침 후 다시 시도하거나 작업이 삭제되었는지 확인하세요",
    "请帮我安装 Claude Code（命令：curl -fsSL https://claude.ai/install.sh | bash），安装后请验证 claude --version，并告诉我下一步如何开始使用。":
      "Claude Code를 설치해 주세요(명령: curl -fsSL https://claude.ai/install.sh | bash). 설치 후 claude --version을 확인하고 다음 사용 방법을 알려 주세요.",
    "请帮我完成 Kian 的渠道配置准备：先判断我更适合 Telegram、Discord 还是飞书；给出最短配置步骤；最后引导我在设置-渠道中完成必填项并启用。":
      "Kian 채널 설정 준비를 도와주세요. 먼저 Telegram, Discord, Feishu 중 무엇이 더 적합한지 판단하고, 가장 짧은 설정 절차를 제시한 뒤, 설정 > 채널에서 필수 항목을 입력하고 활성화하도록 안내해 주세요.",
    "请帮我检查并安装 Node.js 与 pnpm。优先使用 nvm 安装 Node.js 24，再执行 corepack enable pnpm。完成后请验证 node -v 和 pnpm -v，并把执行结果发给我。":
      "Node.js와 pnpm 설치를 확인하고 도와주세요. 우선 nvm으로 Node.js 24를 설치한 뒤 corepack enable pnpm을 실행해 주세요. 완료 후 node -v와 pnpm -v를 확인하고 결과를 보내 주세요.",
    "请至少启用一个模型": "모델을 하나 이상 활성화하세요",
    "请输入启动命令": "시작 명령을 입력하세요",
    "请输入服务 URL": "서비스 URL을 입력하세요",
    "请输入服务名称": "서비스 이름을 입력하세요",
    "路径超出 Agent 工作区目录范围":
      "경로가 에이전트 작업공간 범위를 벗어났습니다",
    "输入 GitHub 仓库地址，例如 https://github.com/owner/repo":
      "GitHub 저장소 주소를 입력하세요. 예: https://github.com/owner/repo",
    "输入多个服务器 ID，每个 ID 按回车生成标签。":
      "여러 서버 ID를 입력하고 각 ID 뒤에 Enter를 눌러 태그를 만드세요.",
    "输入多个频道 ID，每个 ID 按回车生成标签。":
      "여러 채널 ID를 입력하고 각 ID 뒤에 Enter를 눌러 태그를 만드세요.",
    "输入文件名称": "파일 이름 입력",
    "输入文件夹名称": "폴더 이름 입력",
    "输入服务器 ID 后按回车": "서버 ID 입력 후 Enter",
    "输入频道 ID 后按回车": "채널 ID 입력 후 Enter",
    "内置": "내장",
    "卸载": "제거",
    "还没有 MCP 服务，点击右上角按钮添加":
      "아직 MCP 서비스가 없습니다. 오른쪽 위 버튼을 눌러 추가하세요",
    "退出后会立即停止这些任务及其子进程。":
      "종료하면 이 작업들과 하위 프로세스가 즉시 중지됩니다.",
    "退出失败": "종료 실패",
    "退出并停止任务": "종료 후 작업 중지",
    "选择要发送的文件": "보낼 파일 선택",
    "重命名": "이름 바꾸기",
    "重命名文件失败": "파일 이름 변경 실패",
    "重命名文件夹失败": "폴더 이름 변경 실패",
    "阅读模式": "읽기 모드",
    "隐藏手动配置": "수동 설정 숨기기",
    "音频": "오디오",
    "预览失败": "미리보기 실패",
    "频道 ID 必须为纯数字": "채널 ID는 숫자만 입력해야 합니다",
    "飞书应用 AppID": "Feishu 앱 AppID",
    "飞书应用 AppSecret": "Feishu 앱 AppSecret",
    "技能仓库": "스킬 저장소",
    "仓库技能": "저장소 스킬",
    "同步元信息": "메타데이터 동기화",
    "重试": "다시 시도",
    "管理已安装的技能，可控制主 Agent / 子智能体的可见性，并卸载不需要的技能（内置技能不可卸载）。":
      "설치된 스킬을 관리하고, 메인 에이전트와 하위 에이전트의 표시 여부를 제어하며, 필요 없는 스킬을 제거할 수 있습니다(내장 스킬은 제거할 수 없습니다).",
    "内置仓库来自仓库目录 skills/repositories.json。你也可以添加自定义 GitHub 仓库。":
      "내장 저장소는 skills/repositories.json에서 로드됩니다. 사용자 지정 GitHub 저장소도 추가할 수 있습니다.",
    "可以试试让 Kian 来帮你修改或者创建文档":
      "Kian에게 문서를 수정하거나 새로 만들어 달라고 요청해 보세요",
    "点击输入框后按下新的组合键即可录制，按":
      "입력 칸을 클릭한 뒤 새 조합 키를 누르면 녹화가 시작됩니다. ",
    "退出录制。": "를 눌러 녹화를 종료합니다.",
    "选择 Provider 标签页来切换接入方式，配置对应的 API Key 并启用模型。":
      "Provider 탭을 전환해 연동 방식을 선택하고, 해당 API Key를 설정한 뒤 모델을 활성화하세요.",
    "当前支持 fal Provider。你可以配置 fal API Key，并启用可用于生图/生视频的模型。":
      "현재는 fal Provider를 지원합니다. fal API Key를 설정하고 이미지/비디오 생성에 사용할 모델을 활성화할 수 있습니다.",
    "所有渠道消息统一发送到主 Agent，子智能体 聊天仍可在桌面端查看。":
      "모든 채널 메시지는 메인 에이전트로 통합 전송되며, 하위 에이전트 채팅은 데스크톱에서 계속 확인할 수 있습니다.",
    "所有的音视频素材都将汇聚于此，可以试试直接给我说 “生成一张漂亮的落日照片“":
      "모든 이미지, 오디오, 비디오 소재가 여기에 모입니다. \"아름다운 석양 사진 한 장 만들어줘\"라고 바로 말해 보세요.",
    "Telegram 接入方式指引": "Telegram 연동 가이드",
    "1. 在 Telegram 中通过 BotFather 创建 Bot，并获取 Bot Token。":
      "1. Telegram에서 BotFather로 봇을 만들고 Bot Token을 받으세요.",
    "2. 给 Bot 发送消息，获取自己的 user_id（纯数字）。":
      "2. 봇에게 메시지를 보내 자신의 user_id(숫자만)를 확인하세요.",
    "3. 配置允许与 Bot 对话的 user_id 列表。":
      "3. 봇과 대화할 수 있는 user_id 목록을 설정하세요.",
    "Discord 接入方式指引": "Discord 연동 가이드",
    "1. 在 Discord Developer Portal 创建应用并添加 Bot，复制 Bot Token。":
      "1. Discord Developer Portal에서 앱을 만들고 봇을 추가한 뒤 Bot Token을 복사하세요.",
    "2. 将 Bot 邀请进目标服务器并授予可读取/发送消息权限。":
      "2. 봇을 대상 서버에 초대하고 메시지 읽기/전송 권한을 부여하세요.",
    "3. 配置允许接入的服务器 ID 与频道 ID。":
      "3. 허용할 서버 ID와 채널 ID를 설정하세요.",
    "飞书接入方式指引": "Feishu 연동 가이드",
    "1. 在飞书开发者后台创建应用，获取 app_id 与 app_secret。":
      "1. Feishu 개발자 콘솔에서 앱을 만들고 app_id와 app_secret을 받으세요.",
    "2. 在配置中分别填写 AppID 与 AppSecret。":
      "2. 설정에서 AppID와 AppSecret을 각각 입력하세요.",
    "3. 事件与回调使用长链接接受事件，添加 im.message.receive_v1 事件。":
      "3. 이벤트 및 콜백은 장기 연결로 수신하고 im.message.receive_v1 이벤트를 추가하세요.",
    "4. 添加 im:message 和 im:resource 权限。":
      "4. im:message와 im:resource 권한을 추가하세요.",
    "5. 成员管理中只添加自己（自己使用确保安全，同时可以免审核发布）。":
      "5. 멤버 관리에는 본인만 추가하세요. 개인 사용 시 더 안전하고 심사 없이 배포할 수 있습니다.",
    "新增渠道": "채널 추가",
    "使用哪个渠道广播消息，Kian 说了算。":
      "어떤 채널로 방송 메시지를 보낼지는 Kian이 결정합니다.",
    "正在加载广播渠道...": "브로드캐스트 채널을 불러오는 중...",
    "还没有广播渠道，点击“新增渠道”开始配置。":
      "아직 브로드캐스트 채널이 없습니다. “채널 추가”를 눌러 설정을 시작하세요.",
    "如何获取飞书群机器人 Webhook":
      "Feishu 그룹 봇 Webhook 가져오기",
    "1. 打开目标飞书群，点击右上角”设置”。":
      "1. 대상 Feishu 그룹을 열고 오른쪽 상단의 “설정”을 클릭하세요.",
    "2. 进入”群机器人”，添加”自定义机器人”。":
      "2. “그룹 봇”으로 들어가 “사용자 지정 봇”을 추가하세요.",
    "3. 按提示设置机器人名称与安全策略（如关键词或签名）。":
      "3. 안내에 따라 봇 이름과 보안 정책(예: 키워드 또는 서명)을 설정하세요.",
    "4. 创建完成后复制 Webhook 地址，粘贴到上方渠道配置中。":
      "4. 생성이 끝나면 Webhook 주소를 복사해 위 채널 설정에 붙여 넣으세요.",
    "如何获取企业微信群机器人 Webhook":
      "WeCom 그룹 봇 Webhook 가져오기",
    "1. 打开企业微信桌面端，进入目标群聊。":
      "1. WeCom 데스크톱 앱을 열고 대상 그룹 채팅으로 들어가세요.",
    "2. 右键群聊，选择”添加群机器人”，点击”新创建一个机器人”。":
      "2. 그룹 채팅을 우클릭해 “그룹 봇 추가”를 선택한 뒤 “새 봇 만들기”를 클릭하세요.",
    "3. 设置机器人名称和头像，点击”添加”。":
      "3. 봇 이름과 아바타를 설정한 뒤 “추가”를 클릭하세요.",
    "当前版本": "현재 버전",
    "检查更新": "업데이트 확인",
    "最新版本：": "최신 버전:",
    "安装更新": "업데이트 설치",
    "未安装": "설치되지 않음",
    "快速引导": "빠른 가이드",
    "完成基础环境后，你就可以把开发和协作任务交给 Kian。":
      "기본 환경이 준비되면 개발과 협업 작업을 Kian에게 맡길 수 있습니다.",
    "重新检测": "다시 검사",
    "主 Agent 入口": "메인 에이전트 입구",
    "主 Agent 会负责接待你，并在需要时把任务委派给对应的子智能体。":
      "메인 에이전트가 먼저 응대하고, 필요할 때 적절한 하위 에이전트에게 작업을 위임합니다.",
    "打开主 Agent": "메인 에이전트 열기",
    "前往 Agent 列表": "에이전트 목록으로 이동",
    "Node.js 与 pnpm": "Node.js 및 pnpm",
    "启用后，你可以使用应用模块开发前端应用，也可以快速构建各类小应用和小游戏。":
      "활성화하면 앱 모듈로 프론트엔드 앱을 개발하거나 다양한 소형 앱과 미니게임을 빠르게 만들 수 있습니다.",
    "检测中": "확인 중",
    "让 Kian 自动配置": "Kian에게 자동 설정 맡기기",
    "打开 Node.js 下载页": "Node.js 다운로드 페이지 열기",
    "启用后，你可以把编程任务直接委托给 Kian，由它在对应 Agent 工作区中执行并反馈结果。":
      "활성화하면 프로그래밍 작업을 Kian에게 직접 위임할 수 있고, 해당 에이전트 작업공간에서 실행한 뒤 결과를 알려 줍니다.",
    "打开 Claude Code 文档": "Claude Code 문서 열기",
    "渠道配置": "채널 설정",
    "启用后，你可以在手机端通过 IM 聊天工具远程控制 Kian。":
      "활성화하면 휴대폰에서 IM 채팅 도구를 통해 Kian을 원격으로 제어할 수 있습니다.",
    "已配置": "설정됨",
    "未配置": "미설정",
    "图像生成（高质量文生图），适合角色设定图、海报风格镜头和高细节概念图。":
      "이미지 생성(고품질 텍스트-투-이미지), 캐릭터 설정화, 포스터 스타일 샷, 고디테일 콘셉트 아트에 적합합니다.",
    "图像生成（通用高质量），适合分镜草图到精修图的迭代。":
      "이미지 생성(범용 고품질), 스토리보드 스케치부터 완성 이미지까지 반복 작업에 적합합니다.",
    "图像生成（快速低延迟），适合前期创意探索与快速出图。":
      "이미지 생성(빠른 저지연), 초기 아이디어 탐색과 빠른 이미지 생성에 적합합니다.",
    "图像生成与编辑（Google Nano Banana），适合通用创意出图和快速图像改写。":
      "이미지 생성 및 편집(Google Nano Banana), 범용 크리에이티브 이미지 생성과 빠른 이미지 리라이트에 적합합니다.",
    "图像编辑（Google Nano Banana Edit），支持多图输入进行重绘、替换和局部编辑。":
      "이미지 편집(Google Nano Banana Edit), 여러 이미지를 입력해 리페인팅, 교체, 부분 편집을 지원합니다.",
    "图像生成与编辑（Google Nano Banana Pro），支持 1K/2K/4K，适合高质量输出。":
      "이미지 생성 및 편집(Google Nano Banana Pro), 1K/2K/4K를 지원하며 고품질 출력에 적합합니다.",
    "图像编辑（Google Nano Banana Pro Edit），支持多图输入与 1K/2K/4K 输出。":
      "이미지 편집(Google Nano Banana Pro Edit), 여러 이미지 입력과 1K/2K/4K 출력을 지원합니다.",
    "视频生成（图生视频，轻量版），适合预演动画、分镜动态化和快速样片。":
      "비디오 생성(이미지-투-비디오, 라이트), 프리비즈 애니메이션, 스토리보드 동적화, 빠른 샘플 제작에 적합합니다.",
    "视频生成（图生视频，质量优先），适合关键镜头和更平滑动作生成。":
      "비디오 생성(이미지-투-비디오, 품질 우선), 핵심 샷과 더 부드러운 모션 생성에 적합합니다.",
    "视频生成（图生视频，v1.5 Pro），支持更丰富动态、720p/1080p 与可选生成音频。":
      "비디오 생성(이미지-투-비디오, v1.5 Pro), 더 풍부한 동작, 720p/1080p, 선택적 오디오 생성을 지원합니다.",
    "Kling 视频生音频。": "Kling 비디오-투-오디오.",
    "Google Lyria 2 音乐生成。": "Google Lyria 2 음악 생성.",
  },
  "ja-JP": {
    "# 新文档\n\n在这里记录你的音视频创作笔记。\n":
      "# 新しいドキュメント\n\nここに音声・動画制作のメモを記録します。\n",
    "# 新文档\n\n在这里记录你的音视频创作笔记。":
      "# 新しいドキュメント\n\nここに音声・動画制作のメモを記録します。",
    "Agent 名称保存失败": "エージェント名の保存に失敗しました",
    "Agent 已删除": "エージェントを削除しました",
    "AI 生成": "AI生成",
    "Angular 应用": "Angular アプリ",
    "HTTP 类型必须提供 URL": "HTTP タイプには URL が必要です",
    "ID 必须为正整数": "ID は正の整数でなければなりません",
    "MCP 服务 ID 无效": "MCP サービス ID が無効です",
    "Next.js 应用": "Next.js アプリ",
    "Nuxt 应用": "Nuxt アプリ",
    "React 应用": "React アプリ",
    "stdio 类型必须提供命令": "stdio タイプにはコマンドが必要です",
    "Svelte 应用": "Svelte アプリ",
    "URL 必须是合法的 http/https 地址":
      "URL は有効な http/https アドレスである必要があります",
    "user_id 必须为纯数字": "user_id は数字のみで入力してください",
    "Vue 应用": "Vue アプリ",
    "Web 应用": "Web アプリ",
    "Webhook 必须为合法的 https URL":
      "Webhook は有効な https URL である必要があります",
    "中文 (简体)": "中国語（簡体）",
    "主 Agent 委派回执": "メインエージェント委譲受領書",
    "从左侧选择一个任务，这里会实时显示执行输出":
      "左側でタスクを選択すると、ここに実行出力がリアルタイムで表示されます",
    "任务 ID 不能为空": "タスク ID は必須です",
    "任务 ID 格式不正确": "タスク ID の形式が正しくありません",
    "任务 ID 过长": "タスク ID が長すぎます",
    "任意页面下跳转到设置页面。":
      "どのページからでも設定ページへ移動します。",
    "任意页面下跳转并聚焦主 Agent 输入框。":
      "どのページからでもメインエージェント入力欄へ移動してフォーカスします。",
    "会话：": "セッション:",
    "例如：/Users/lei/Projects": "例: /Users/lei/Projects",
    "例如：Figma MCP / Browser MCP": "例: Figma MCP / Browser MCP",
    "例如：https://example.com/mcp": "例: https://example.com/mcp",
    "例如：npx -y @modelcontextprotocol/server-filesystem":
      "例: npx -y @modelcontextprotocol/server-filesystem",
    "保存修改": "変更を保存",
    "保存失败": "保存に失敗しました",
    "修改对话名称失败": "会話名の変更に失敗しました",
    "停止任务失败": "タスクの停止に失敗しました",
    "停止运行中的任务失败，已取消退出。":
      "実行中のタスクを停止できなかったため、終了を取り消しました。",
    "允许服务器 ID": "許可するサーバー ID",
    "允许用户 user_id": "許可する user_id",
    "允许频道 ID": "許可するチャンネル ID",
    "凭证长度至少 10 位": "資格情報は 10 文字以上必要です",
    "切换状态失败": "状態の切り替えに失敗しました",
    "创建中...": "作成中...",
    "创建失败": "作成に失敗しました",
    "创建并启动任务后，这里会展示运行状态与 stdout.log":
      "タスクを作成して開始すると、ここに状態と stdout.log が表示されます",
    "创建文件失败": "ファイルの作成に失敗しました",
    "创建文件夹失败": "フォルダの作成に失敗しました",
    "删除任务失败": "タスクの削除に失敗しました",
    "删除失败": "削除に失敗しました",
    "删除对话": "会話を削除",
    "删除对话失败": "会話の削除に失敗しました",
    "删除文件失败": "ファイルの削除に失敗しました",
    "删除文件夹失败": "フォルダの削除に失敗しました",
    "加载仓库技能失败": "リポジトリのスキル読み込みに失敗しました",
    "双击修改对话名称": "ダブルクリックで会話名を変更",
    "不再提示": "今後表示しない",
    "取消": "キャンセル",
    "可选，例如：/Users/lei/Projects/vivid":
      "任意、例: /Users/lei/Projects/vivid",
    "启动任务失败": "タスクの開始に失敗しました",
    "启用": "有効",
    "启用 Discord 前请先填写允许服务器 ID":
      "Discord を有効にする前に許可するサーバー ID を入力してください",
    "启用 Discord 前请先填写允许频道 ID":
      "Discord を有効にする前に許可するチャンネル ID を入力してください",
    "启用 Discord 前请先输入 Bot Token":
      "Discord を有効にする前に Bot Token を入力してください",
    "启用 Provider 时必须设置 API Key":
      "Provider を有効にする場合は API Key が必要です",
    "启用 Telegram 前请先填写 user_id":
      "Telegram を有効にする前に user_id を入力してください",
    "启用 Telegram 前请先输入 Bot Token":
      "Telegram を有効にする前に Bot Token を入力してください",
    "启用模型": "有効なモデル",
    "启用飞书前请先输入 AppID":
      "Feishu を有効にする前に AppID を入力してください",
    "启用飞书前请先输入 AppSecret":
      "Feishu を有効にする前に AppSecret を入力してください",
    "图片": "画像",
    "在聊天里触发命令执行后，任务会自动出现在这里":
      "チャットでコマンド実行が開始されると、タスクがここに自動表示されます",
    "复制文件失败": "ファイルの複製に失敗しました",
    "多个 user_id 使用换行、空格或逗号分隔。":
      "複数の user_id は改行、空白、またはカンマで区切ってください。",
    "失败": "失敗",
    "委派编号：": "委譲番号:",
    "对话": "会話",
    "展开": "展開",
    "展开对话列表": "会話一覧を展開",
    "展开文件列表": "ファイル一覧を展開",
    "工具输出": "ツール出力",
    "已向 Kian 发送自动配置请求":
      "Kian に自動設定リクエストを送信しました",
    "已完成": "完了",
    "已生成副本": "複製を作成しました",
    "已自动保存": "自動保存済み",
    "已设置": "設定済み",
    "应用页面加载失败": "アプリページの読み込みに失敗しました",
    "建议补充氛围音效": "雰囲気用の効果音を追加することをおすすめします",
    "建议过场 B-roll": "場面転換用の B-roll をおすすめします",
    "开发环境页面加载失败": "開発環境ページの読み込みに失敗しました",
    "当前仓库未解析到技能（未找到 SKILL.md）":
      "現在のリポジトリからスキルを解析できませんでした（SKILL.md が見つかりません）",
    "仓库地址不能为空": "リポジトリ URL は空にできません",
    "仓库地址格式不正确": "リポジトリ URL の形式が正しくありません",
    "当前仅支持 GitHub 仓库":
      "現在は GitHub リポジトリのみサポートしています",
    "仓库地址需包含 owner/repo":
      "リポジトリ URL には owner/repo を含める必要があります",
    "技能路径不能为空": "スキルパスは空にできません",
    "技能路径不合法": "スキルパスが不正です",
    "未检测到 tar 命令，无法解压技能仓库归档":
      "tar コマンドが見つからないため、スキルリポジトリアーカイブを展開できません",
    "未检测到 git 命令，无法通过仓库缓存安装技能":
      "git コマンドが見つからないため、リポジトリキャッシュからスキルをインストールできません",
    "未找到技能目录，无法安装该技能":
      "スキルディレクトリが見つからないため、スキルをインストールできません",
    "技能路径不是目录，无法安装该技能":
      "スキルパスがディレクトリではないため、スキルをインストールできません",
    "未找到 SKILL.md，无法安装该技能":
      "SKILL.md が見つからないため、スキルをインストールできません",
    "当前环境无法读取文件路径":
      "現在の環境ではファイルパスを読み取れません",
    "已安装技能": "インストール済みスキル",
    "快捷键提示关闭状态保存失败":
      "ショートカット案内の閉じた状態を保存できませんでした",
    "思考等级": "思考レベル",
    "所有文件": "すべてのファイル",
    "打开全局预览失败": "独立プレビューを開けませんでした",
    "打开目录失败": "フォルダを開けませんでした",
    "打开系统预览失败": "システムプレビューを開けませんでした",
    "打开链接失败": "リンクを開けませんでした",
    "折叠对话列表": "会話一覧を折りたたむ",
    "折叠文件列表": "ファイル一覧を折りたたむ",
    "搜索素材": "アセットを検索",
    "支持的文件": "対応ファイル",
    "支持逗号或换行分隔": "カンマまたは改行で区切れます",
    "文件为空": "ファイルは空です",
    "文件夹已删除": "フォルダを削除しました",
    "文件已删除": "ファイルを削除しました",
    "暂无对话": "会話はまだありません",
    "暂无文件": "ファイルはまだありません",
    "新对话": "新しい会話",
    "新建": "新規作成",
    "新建 Agent": "新しいエージェント",
    "新建当前智能体的对话": "現在のエージェントの新しい会話を作成します",
    "新文件": "新しいファイル",
    "停止": "停止",
    "无法在 Finder 中打开文件":
      "Finder でファイルを表示できません",
    "日本語": "日本語",
    "暂无 Prompt": "Prompt はまだありません",
    "暂无摘要": "要約はありません",
    "暂无输出": "出力はありません",
    "更新 MCP 服务失败": "MCP サービスの更新に失敗しました",
    "更新技能可见性失败": "スキル表示状態の更新に失敗しました",
    "服务器 ID 必须为纯数字": "サーバー ID は数字のみで入力してください",
    "服务地址": "サービスアドレス",
    "未知 Agent": "不明なエージェント",
    "未知 Mermaid 渲染错误": "不明な Mermaid レンダリングエラー",
    "未知状态": "不明な状態",
    "未设置": "未設定",
    "未配置 URL": "URL 未設定",
    "未配置命令": "コマンド未設定",
    "来自 Agent ": "エージェントから ",
    "来自主 Agent 的委派": "メインエージェントからの委譲",
    "标准输入输出": "標準入出力",
    "主智能体": "メインエージェント",
    "命令：": "コマンド:",
    "模块：": "モジュール:",
    "子智能体 回报": "サブエージェント報告",
    "已停止": "停止済み",
    "已启用的服务会在下一轮 Agent 对话时自动注入运行时":
      "有効化されたサービスは次回の Agent 会話時に自動でランタイムへ注入されます",
    "在 Finder 中查看": "Finder で表示",
    "在右侧描述剧情和风格，AI 会自动生成场景与镜头。":
      "右側で物語とスタイルを説明すると、AI がシーンとカットを自動生成します。",
    "在对话中描述你想要的应用，构建后将在此预览":
      "チャットで作りたいアプリを説明してください。ビルド後にここでプレビューできます。",
    "展示全部": "すべて表示",
    "正在努力工作中": "作業中",
    "正在加载文本预览...": "テキストプレビューを読み込み中...",
    "每行一个，格式 KEY=VALUE": "1 行に 1 つ、形式は KEY=VALUE",
    "元信息更新中或暂不可用":
      "メタデータを更新中か、一時的に利用できません",
    "流式输出失败": "ストリーミング出力に失敗しました",
    "消息内容或附件至少填写一项":
      "メッセージ内容または添付ファイルのいずれかを入力してください",
    "视频场景": "動画シーン",
    "查看详情": "詳細を見る",
    "有什么可以帮你的吗？": "何をお手伝いできますか？",
    "暂无内容": "内容はありません",
    "暂无定时任务": "定期タスクはありません",
    "等待应用构建": "アプリのビルド待ち",
    "输入参数": "入力引数",
    "执行结果": "実行結果",
    "备注": "メモ",
    "换行。": "で改行。",
    "发送，": "で送信,",
    "还没有分镜场景": "絵コンテのシーンはまだありません",
    "点击任务可查看 stdout.log": "タスクをクリックすると stdout.log を表示できます",
    "点击卡片可切换状态": "カードをクリックすると状態を切り替えられます",
    "点击在 Finder 中查看": "クリックして Finder で表示",
    "添加": "追加",
    "添加仓库": "リポジトリを追加",
    "添加 MCP 服务失败": "MCP サービスの追加に失敗しました",
    "渠道名称": "チャネル名",
    "点击使用系统预览打开":
      "クリックしてシステムプレビューで開く",
    "状态：": "状態:",
    "子智能体": "サブエージェント",
    "用户": "ユーザー",
    "界面加载失败": "画面の読み込みに失敗しました",
    "留空表示保持当前凭证不变":
      "空欄のままにすると現在の資格情報を維持します",
    "相对路径必须提供 projectId":
      "相対パスを使う場合は projectId が必要です",
    "知道了": "了解",
    "确认退出 Kian": "Kian を終了しますか？",
    "视图": "表示",
    "视频": "動画",
    "窗口": "ウィンドウ",
    "素材路径不可用，无法打开系统预览":
      "アセットのパスが利用できないため、システムプレビューを開けません",
    "编辑": "編集",
    "编辑模式": "編集モード",
    "缺少待编辑的 MCP 服务":
      "編集する MCP サービスが選択されていません",
    "聚焦消息发送窗口时插入换行。":
      "メッセージ入力欄にフォーカスがあるときに改行を挿入します。",
    "聚焦消息发送窗口时触发发送。":
      "メッセージ入力欄にフォーカスがあるときに送信します。",
    "自动保存中...": "自動保存中...",
    "自动配置请求发送失败": "自動設定リクエストの送信に失敗しました",
    "至少传入一个更新字段":
      "更新するフィールドを少なくとも 1 つ指定してください",
    "请先选择仓库": "先にリポジトリを選択してください",
    "请刷新后重试，或检查任务是否已被删除":
      "再読み込みしてもう一度試すか、タスクが削除されていないか確認してください",
    "请帮我安装 Claude Code（命令：curl -fsSL https://claude.ai/install.sh | bash），安装后请验证 claude --version，并告诉我下一步如何开始使用。":
      "Claude Code をインストールしてください（コマンド: curl -fsSL https://claude.ai/install.sh | bash）。インストール後、claude --version を確認し、次にどう使い始めればよいか教えてください。",
    "请帮我完成 Kian 的渠道配置准备：先判断我更适合 Telegram、Discord 还是飞书；给出最短配置步骤；最后引导我在设置-渠道中完成必填项并启用。":
      "Kian のチャネル設定準備を手伝ってください。まず Telegram、Discord、Feishu のどれが適しているか判断し、最短の設定手順を示し、最後に設定 > チャネルで必須項目を入力して有効化するよう案内してください。",
    "请帮我检查并安装 Node.js 与 pnpm。优先使用 nvm 安装 Node.js 24，再执行 corepack enable pnpm。完成后请验证 node -v 和 pnpm -v，并把执行结果发给我。":
      "Node.js と pnpm の確認とインストールを手伝ってください。まず nvm で Node.js 24 をインストールし、その後 corepack enable pnpm を実行してください。完了したら node -v と pnpm -v を確認し、結果を送ってください。",
    "请至少启用一个模型": "少なくとも 1 つのモデルを有効化してください",
    "请输入启动命令": "起動コマンドを入力してください",
    "请输入服务 URL": "サービス URL を入力してください",
    "请输入服务名称": "サービス名を入力してください",
    "路径超出 Agent 工作区目录范围":
      "パスがエージェントのワークスペース範囲外です",
    "输入 GitHub 仓库地址，例如 https://github.com/owner/repo":
      "GitHub リポジトリ URL を入力してください。例: https://github.com/owner/repo",
    "输入多个服务器 ID，每个 ID 按回车生成标签。":
      "複数のサーバー ID を入力し、各 ID の後で Enter を押してタグを作成します。",
    "输入多个频道 ID，每个 ID 按回车生成标签。":
      "複数のチャンネル ID を入力し、各 ID の後で Enter を押してタグを作成します。",
    "输入文件名称": "ファイル名を入力",
    "输入文件夹名称": "フォルダ名を入力",
    "输入服务器 ID 后按回车": "サーバー ID を入力して Enter",
    "输入频道 ID 后按回车": "チャンネル ID を入力して Enter",
    "内置": "内蔵",
    "卸载": "アンインストール",
    "还没有 MCP 服务，点击右上角按钮添加":
      "まだ MCP サービスがありません。右上のボタンから追加してください",
    "退出后会立即停止这些任务及其子进程。":
      "終了すると、これらのタスクと子プロセスはただちに停止します。",
    "退出失败": "終了に失敗しました",
    "退出并停止任务": "終了してタスクを停止",
    "选择要发送的文件": "送信するファイルを選択",
    "重命名": "名前を変更",
    "重命名文件失败": "ファイル名の変更に失敗しました",
    "重命名文件夹失败": "フォルダ名の変更に失敗しました",
    "阅读模式": "閲覧モード",
    "隐藏手动配置": "手動設定を隠す",
    "音频": "音声",
    "预览失败": "プレビューに失敗しました",
    "频道 ID 必须为纯数字": "チャンネル ID は数字のみで入力してください",
    "飞书应用 AppID": "Feishu アプリ AppID",
    "飞书应用 AppSecret": "Feishu アプリ AppSecret",
    "技能仓库": "スキルリポジトリ",
    "仓库技能": "リポジトリスキル",
    "同步元信息": "メタデータを同期",
    "重试": "再試行",
    "管理已安装的技能，可控制主 Agent / 子智能体的可见性，并卸载不需要的技能（内置技能不可卸载）。":
      "インストール済みスキルを管理し、メインエージェントとサブエージェントの表示可否を切り替え、不要なスキルをアンインストールできます（内蔵スキルは削除できません）。",
    "内置仓库来自仓库目录 skills/repositories.json。你也可以添加自定义 GitHub 仓库。":
      "内蔵リポジトリは skills/repositories.json から読み込まれます。カスタムの GitHub リポジトリも追加できます。",
    "可以试试让 Kian 来帮你修改或者创建文档":
      "Kian にドキュメントの修正や新規作成を頼んでみてください",
    "点击输入框后按下新的组合键即可录制，按":
      "入力欄をクリックして新しいキーの組み合わせを押すと録音が始まります。 ",
    "退出录制。": "を押して録音を終了します。",
    "选择 Provider 标签页来切换接入方式，配置对应的 API Key 并启用模型。":
      "Provider タブを切り替えて接続方法を選び、対応する API Key を設定してモデルを有効化してください。",
    "当前支持 fal Provider。你可以配置 fal API Key，并启用可用于生图/生视频的模型。":
      "現在は fal Provider に対応しています。fal API Key を設定し、画像生成や動画生成に使うモデルを有効化できます。",
    "所有渠道消息统一发送到主 Agent，子智能体 聊天仍可在桌面端查看。":
      "すべてのチャネルメッセージはメインエージェントに統一して送信され、サブエージェントの会話は引き続きデスクトップで確認できます。",
    "所有的音视频素材都将汇聚于此，可以试试直接给我说 “生成一张漂亮的落日照片“":
      "すべての画像・音声・動画アセットがここに集まります。たとえば「きれいな夕焼けの写真を生成して」とそのまま頼んでみてください。",
    "Telegram 接入方式指引": "Telegram 連携ガイド",
    "1. 在 Telegram 中通过 BotFather 创建 Bot，并获取 Bot Token。":
      "1. Telegram で BotFather を使って Bot を作成し、Bot Token を取得します。",
    "2. 给 Bot 发送消息，获取自己的 user_id（纯数字）。":
      "2. Bot にメッセージを送って、自分の user_id（数字のみ）を確認します。",
    "3. 配置允许与 Bot 对话的 user_id 列表。":
      "3. Bot と会話を許可する user_id の一覧を設定します。",
    "Discord 接入方式指引": "Discord 連携ガイド",
    "1. 在 Discord Developer Portal 创建应用并添加 Bot，复制 Bot Token。":
      "1. Discord Developer Portal でアプリを作成して Bot を追加し、Bot Token をコピーします。",
    "2. 将 Bot 邀请进目标服务器并授予可读取/发送消息权限。":
      "2. Bot を対象サーバーに招待し、メッセージの読み取り/送信権限を付与します。",
    "3. 配置允许接入的服务器 ID 与频道 ID。":
      "3. 接続を許可するサーバー ID とチャンネル ID を設定します。",
    "飞书接入方式指引": "Feishu 連携ガイド",
    "1. 在飞书开发者后台创建应用，获取 app_id 与 app_secret。":
      "1. Feishu 開発者コンソールでアプリを作成し、app_id と app_secret を取得します。",
    "2. 在配置中分别填写 AppID 与 AppSecret。":
      "2. 設定で AppID と AppSecret をそれぞれ入力します。",
    "3. 事件与回调使用长链接接受事件，添加 im.message.receive_v1 事件。":
      "3. イベントとコールバックは長接続で受信し、im.message.receive_v1 イベントを追加します。",
    "4. 添加 im:message 和 im:resource 权限。":
      "4. im:message と im:resource の権限を追加します。",
    "5. 成员管理中只添加自己（自己使用确保安全，同时可以免审核发布）。":
      "5. メンバー管理には自分だけを追加してください。個人利用では安全で、審査なしで公開できます。",
    "新增渠道": "チャネルを追加",
    "使用哪个渠道广播消息，Kian 说了算。":
      "どのチャネルでブロードキャストするかは Kian が判断します。",
    "正在加载广播渠道...": "配信チャネルを読み込み中...",
    "还没有广播渠道，点击“新增渠道”开始配置。":
      "まだ配信チャネルがありません。“チャネルを追加”をクリックして設定を始めてください。",
    "如何获取飞书群机器人 Webhook":
      "Feishu グループ Bot の Webhook を取得する方法",
    "1. 打开目标飞书群，点击右上角”设置”。":
      "1. 対象の Feishu グループを開き、右上の「設定」をクリックします。",
    "2. 进入”群机器人”，添加”自定义机器人”。":
      "2. 「グループ Bot」に入り、「カスタム Bot」を追加します。",
    "3. 按提示设置机器人名称与安全策略（如关键词或签名）。":
      "3. 案内に従って Bot 名とセキュリティポリシー（キーワードや署名など）を設定します。",
    "4. 创建完成后复制 Webhook 地址，粘贴到上方渠道配置中。":
      "4. 作成後に Webhook URL をコピーして、上のチャネル設定に貼り付けます。",
    "如何获取企业微信群机器人 Webhook":
      "WeCom グループ Bot の Webhook を取得する方法",
    "1. 打开企业微信桌面端，进入目标群聊。":
      "1. WeCom デスクトップアプリを開き、対象のグループチャットに入ります。",
    "2. 右键群聊，选择”添加群机器人”，点击”新创建一个机器人”。":
      "2. グループチャットを右クリックし、「グループ Bot を追加」を選んで「新しい Bot を作成」をクリックします。",
    "3. 设置机器人名称和头像，点击”添加”。":
      "3. Bot 名とアイコンを設定し、「追加」をクリックします。",
    "当前版本": "現在のバージョン",
    "检查更新": "アップデートを確認",
    "最新版本：": "最新バージョン:",
    "安装更新": "アップデートをインストール",
    "未安装": "未インストール",
    "快速引导": "クイックガイド",
    "完成基础环境后，你就可以把开发和协作任务交给 Kian。":
      "基本環境の準備が終われば、開発や共同作業のタスクを Kian に任せられます。",
    "重新检测": "再チェック",
    "主 Agent 入口": "メインエージェント入口",
    "主 Agent 会负责接待你，并在需要时把任务委派给对应的子智能体。":
      "メインエージェントが最初に応対し、必要に応じて適切なサブエージェントへタスクを委譲します。",
    "打开主 Agent": "メインエージェントを開く",
    "前往 Agent 列表": "エージェント一覧へ",
    "Node.js 与 pnpm": "Node.js と pnpm",
    "启用后，你可以使用应用模块开发前端应用，也可以快速构建各类小应用和小游戏。":
      "有効化すると、アプリモジュールでフロントエンドアプリを開発したり、さまざまな小さなアプリやミニゲームをすばやく作成できます。",
    "检测中": "確認中",
    "让 Kian 自动配置": "Kian に自動設定させる",
    "打开 Node.js 下载页": "Node.js ダウンロードページを開く",
    "启用后，你可以把编程任务直接委托给 Kian，由它在对应 Agent 工作区中执行并反馈结果。":
      "有効化すると、プログラミング作業を Kian に直接委任でき、対応するエージェントのワークスペースで実行して結果を返してくれます。",
    "打开 Claude Code 文档": "Claude Code ドキュメントを開く",
    "渠道配置": "チャネル設定",
    "启用后，你可以在手机端通过 IM 聊天工具远程控制 Kian。":
      "有効化すると、スマートフォンの IM チャットツールから Kian を遠隔操作できます。",
    "已配置": "設定済み",
    "未配置": "未設定",
    "图像生成（高质量文生图），适合角色设定图、海报风格镜头和高细节概念图。":
      "画像生成（高品質なテキストから画像）, キャラクター設定画、ポスター風ショット、高精細なコンセプトアートに適しています。",
    "图像生成（通用高质量），适合分镜草图到精修图的迭代。":
      "画像生成（汎用高品質）, 絵コンテのラフから仕上げ画像までの反復に適しています。",
    "图像生成（快速低延迟），适合前期创意探索与快速出图。":
      "画像生成（高速・低遅延）, 初期のアイデア探索や高速な画像生成に適しています。",
    "图像生成与编辑（Google Nano Banana），适合通用创意出图和快速图像改写。":
      "画像生成と編集（Google Nano Banana）, 汎用的なクリエイティブ画像生成と素早い画像リライトに適しています。",
    "图像编辑（Google Nano Banana Edit），支持多图输入进行重绘、替换和局部编辑。":
      "画像編集（Google Nano Banana Edit）, 複数画像入力による再描画、置換、部分編集に対応します。",
    "图像生成与编辑（Google Nano Banana Pro），支持 1K/2K/4K，适合高质量输出。":
      "画像生成と編集（Google Nano Banana Pro）, 1K/2K/4K に対応し、高品質出力に適しています。",
    "图像编辑（Google Nano Banana Pro Edit），支持多图输入与 1K/2K/4K 输出。":
      "画像編集（Google Nano Banana Pro Edit）, 複数画像入力と 1K/2K/4K 出力に対応します。",
    "视频生成（图生视频，轻量版），适合预演动画、分镜动态化和快速样片。":
      "動画生成（画像から動画, Lite）, プレビズ、絵コンテのアニメーション化、素早いサンプル作成に適しています。",
    "视频生成（图生视频，质量优先），适合关键镜头和更平滑动作生成。":
      "動画生成（画像から動画, 品質優先）, 重要ショットやより滑らかな動きの生成に適しています。",
    "视频生成（图生视频，v1.5 Pro），支持更丰富动态、720p/1080p 与可选生成音频。":
      "動画生成（画像から動画, v1.5 Pro）, より豊かな動き、720p/1080p、任意の音声生成に対応します。",
    "Kling 视频生音频。": "Kling 動画から音声。",
    "Google Lyria 2 音乐生成。": "Google Lyria 2 音楽生成。",
  },
};

const EN_US_PATTERNS: PatternTranslation[] = [
  {
    pattern: /^(\d+)分钟前$/,
    render: (value) => `${value} min ago`,
  },
  {
    pattern: /^(\d+)小时前$/,
    render: (value) => `${value} hr ago`,
  },
  {
    pattern: /^(\d+)天前$/,
    render: (value) => `${value} days ago`,
  },
  {
    pattern: /^(\d+)个月前$/,
    render: (value) => `${value} months ago`,
  },
  {
    pattern: /^(\d+)年前$/,
    render: (value) => `${value} years ago`,
  },
  {
    pattern: /^上次构建：(.+)$/,
    render: (value) => `Last build: ${value}`,
  },
  {
    pattern: /^场景 (\d+)$/,
    render: (value) => `${value} scenes`,
  },
  {
    pattern: /^镜头 (\d+)$/,
    render: (value) => `${value} shots`,
  },
  {
    pattern: /^(\d+) 镜头$/,
    render: (value) => `${value} shots`,
  },
  {
    pattern: /^技能 (.+) 安装成功$/,
    render: (value) => `Installed skill ${value}`,
  },
  {
    pattern: /^技能 (.+) 已卸载$/,
    render: (value) => `Uninstalled skill ${value}`,
  },
  {
    pattern: /^仓库元信息已同步：共 (\d+) 个技能，更新 (\d+) 项$/,
    render: (total, updated) =>
      `Repository metadata synced: ${total} skills, ${updated} updated`,
  },
  {
    pattern: /^仓库元信息已是最新（共 (\d+) 个技能）$/,
    render: (total) => `Repository metadata is already up to date (${total} skills)`,
  },
  {
    pattern: /^执行 git (.+) 失败：(.+)$/,
    render: (command, details) => `git ${command} failed: ${details}`,
  },
  {
    pattern: /^下载仓库归档失败（(\d+)）(?::|：)?(.*)$/,
    render: (status, details) =>
      details?.trim()
        ? `Failed to download repository archive (${status}): ${details.trim()}`
        : `Failed to download repository archive (${status})`,
  },
  {
    pattern: /^仓库归档解压失败：(.+)$/,
    render: (details) => `Failed to extract repository archive: ${details}`,
  },
  {
    pattern: /^已存在同名技能目录：(.+)。请先卸载同名技能后再安装。$/,
    render: (value) =>
      `A skill directory with the same name already exists: ${value}. Uninstall it before installing again.`,
  },
  {
    pattern: /^MCP 服务「(.+)」已添加$/,
    render: (value) => `Added MCP service "${value}"`,
  },
  {
    pattern: /^MCP 服务「(.+)」已更新$/,
    render: (value) => `Updated MCP service "${value}"`,
  },
  {
    pattern: /^已启用 (.+)$/,
    render: (value) => `Enabled ${value}`,
  },
  {
    pattern: /^已停用 (.+)$/,
    render: (value) => `Disabled ${value}`,
  },
  {
    pattern: /^无法解析键值对：(.+)$/,
    render: (value) => `Unable to parse key-value pair: ${value}`,
  },
  {
    pattern: /^键不能为空：(.+)$/,
    render: (value) => `Key cannot be empty: ${value}`,
  },
  {
    pattern: /^参数 (\d+)$/,
    render: (value) => `${value} args`,
  },
  {
    pattern: /^环境变量 (\d+)$/,
    render: (value) => `${value} env vars`,
  },
  {
    pattern: /^工作目录 (.+)$/,
    render: (value) => `Workdir ${value}`,
  },
  {
    pattern: /^执行时间：(.+)$/,
    render: (value) => `Run time: ${value}`,
  },
  {
    pattern: /^更新时间 (.+)$/,
    render: (value) => `Updated ${value}`,
  },
  {
    pattern: /^已委派给：\*\*(.+)\*\*$/,
    render: (value) => `Delegated to: **${value}**`,
  },
  {
    pattern: /^来自 Agent (.+) 的回报$/,
    render: (value) => `Report from Agent ${value}`,
  },
  {
    pattern: /^移除文件 (.+)$/,
    render: (value) => `Remove file ${value}`,
  },
  {
    pattern: /^操作 (.+)$/,
    render: (value) => `Actions for ${value}`,
  },
  {
    pattern: /^广播渠道 (\d+)$/,
    render: (value) => `Broadcast Channel ${value}`,
  },
  {
    pattern: /^建议镜头素材：(.+)$/,
    render: (value) => `Suggested shot asset: ${value}`,
  },
  {
    pattern: /^系统预览打开失败: (.+)$/,
    render: (value) => `Failed to open in system preview: ${value}`,
  },
  {
    pattern: /^当前有 (\d+) 个任务仍在运行$/,
    render: (value) => `${value} tasks are still running`,
  },
  {
    pattern: /^• 以及另外 (\d+) 个任务$/,
    render: (value) => `• and ${value} more tasks`,
  },
  {
    pattern: /^(.+) · 应用预览$/,
    render: (value) => `${value} · App Preview`,
  },
  {
    pattern: /^(.+)-副本(\.[^.]+)?$/,
    render: (value, ext = "") => `${value}-copy${ext}`,
  },
  {
    pattern: /^(.*)\n\.\.\.\(已截断\)$/,
    render: (value) => `${value}\n...(truncated)`,
  },
  {
    pattern: /^(.+) 文生视频。$/,
    render: (value) => `${value} text-to-video.`,
  },
  {
    pattern: /^(.+) 图生视频。$/,
    render: (value) => `${value} image-to-video.`,
  },
  {
    pattern: /^(.+) 参考图到视频。$/,
    render: (value) => `${value} reference-to-video.`,
  },
  {
    pattern: /^(.+) 首尾帧生视频。$/,
    render: (value) => `${value} first-last-frame-to-video.`,
  },
];

const KO_KR_PATTERNS: PatternTranslation[] = [
  {
    pattern: /^(\d+)分钟前$/,
    render: (value) => `${value}분 전`,
  },
  {
    pattern: /^(\d+)小时前$/,
    render: (value) => `${value}시간 전`,
  },
  {
    pattern: /^(\d+)天前$/,
    render: (value) => `${value}일 전`,
  },
  {
    pattern: /^(\d+)个月前$/,
    render: (value) => `${value}개월 전`,
  },
  {
    pattern: /^(\d+)年前$/,
    render: (value) => `${value}년 전`,
  },
  {
    pattern: /^上次构建：(.+)$/,
    render: (value) => `마지막 빌드: ${value}`,
  },
  {
    pattern: /^场景 (\d+)$/,
    render: (value) => `${value}개 장면`,
  },
  {
    pattern: /^镜头 (\d+)$/,
    render: (value) => `${value}개 숏`,
  },
  {
    pattern: /^(\d+) 镜头$/,
    render: (value) => `${value}개 숏`,
  },
  {
    pattern: /^技能 (.+) 安装成功$/,
    render: (value) => `스킬 ${value} 설치 완료`,
  },
  {
    pattern: /^技能 (.+) 已卸载$/,
    render: (value) => `스킬 ${value} 제거 완료`,
  },
  {
    pattern: /^仓库元信息已同步：共 (\d+) 个技能，更新 (\d+) 项$/,
    render: (total, updated) =>
      `저장소 메타데이터 동기화 완료: 총 ${total}개 스킬, ${updated}개 업데이트`,
  },
  {
    pattern: /^仓库元信息已是最新（共 (\d+) 个技能）$/,
    render: (total) => `저장소 메타데이터가 최신 상태입니다(총 ${total}개 스킬)`,
  },
  {
    pattern: /^执行 git (.+) 失败：(.+)$/,
    render: (command, details) => `git ${command} 실행 실패: ${details}`,
  },
  {
    pattern: /^下载仓库归档失败（(\d+)）(?::|：)?(.*)$/,
    render: (status, details) =>
      details?.trim()
        ? `저장소 아카이브 다운로드 실패 (${status}): ${details.trim()}`
        : `저장소 아카이브 다운로드 실패 (${status})`,
  },
  {
    pattern: /^仓库归档解压失败：(.+)$/,
    render: (details) => `저장소 아카이브 압축 해제 실패: ${details}`,
  },
  {
    pattern: /^已存在同名技能目录：(.+)。请先卸载同名技能后再安装。$/,
    render: (value) =>
      `같은 이름의 스킬 디렉터리가 이미 존재합니다: ${value}. 다시 설치하기 전에 먼저 제거하세요.`,
  },
  {
    pattern: /^MCP 服务「(.+)」已添加$/,
    render: (value) => `MCP 서비스 "${value}" 추가됨`,
  },
  {
    pattern: /^MCP 服务「(.+)」已更新$/,
    render: (value) => `MCP 서비스 "${value}" 업데이트됨`,
  },
  {
    pattern: /^已启用 (.+)$/,
    render: (value) => `${value} 활성화됨`,
  },
  {
    pattern: /^已停用 (.+)$/,
    render: (value) => `${value} 비활성화됨`,
  },
  {
    pattern: /^执行时间：(.+)$/,
    render: (value) => `실행 시간: ${value}`,
  },
  {
    pattern: /^更新时间 (.+)$/,
    render: (value) => `업데이트 ${value}`,
  },
  {
    pattern: /^已委派给：\*\*(.+)\*\*$/,
    render: (value) => `위임 대상: **${value}**`,
  },
  {
    pattern: /^来自 Agent (.+) 的回报$/,
    render: (value) => `에이전트 ${value}의 회신`,
  },
  {
    pattern: /^操作 (.+)$/,
    render: (value) => `${value} 작업`,
  },
  {
    pattern: /^广播渠道 (\d+)$/,
    render: (value) => `브로드캐스트 채널 ${value}`,
  },
  {
    pattern: /^建议镜头素材：(.+)$/,
    render: (value) => `추천 장면 소재: ${value}`,
  },
  {
    pattern: /^系统预览打开失败: (.+)$/,
    render: (value) => `시스템 미리보기 열기 실패: ${value}`,
  },
  {
    pattern: /^当前有 (\d+) 个任务仍在运行$/,
    render: (value) => `현재 ${value}개의 작업이 실행 중입니다`,
  },
  {
    pattern: /^• 以及另外 (\d+) 个任务$/,
    render: (value) => `• 그 외 ${value}개의 작업`,
  },
  {
    pattern: /^(.+) · 应用预览$/,
    render: (value) => `${value} · 앱 미리보기`,
  },
  {
    pattern: /^(.+)-副本(\.[^.]+)?$/,
    render: (value, ext = "") => `${value}-복사본${ext}`,
  },
  {
    pattern: /^(.*)\n\.\.\.\(已截断\)$/,
    render: (value) => `${value}\n...(잘림)`,
  },
  {
    pattern: /^(.+) 文生视频。$/,
    render: (value) => `${value} 텍스트-투-비디오.`,
  },
  {
    pattern: /^(.+) 图生视频。$/,
    render: (value) => `${value} 이미지-투-비디오.`,
  },
  {
    pattern: /^(.+) 参考图到视频。$/,
    render: (value) => `${value} 레퍼런스 이미지-투-비디오.`,
  },
  {
    pattern: /^(.+) 首尾帧生视频。$/,
    render: (value) => `${value} 첫 프레임/마지막 프레임 기반 비디오 생성.`,
  },
];

const JA_JP_PATTERNS: PatternTranslation[] = [
  {
    pattern: /^(\d+)分钟前$/,
    render: (value) => `${value}分前`,
  },
  {
    pattern: /^(\d+)小时前$/,
    render: (value) => `${value}時間前`,
  },
  {
    pattern: /^(\d+)天前$/,
    render: (value) => `${value}日前`,
  },
  {
    pattern: /^(\d+)个月前$/,
    render: (value) => `${value}か月前`,
  },
  {
    pattern: /^(\d+)年前$/,
    render: (value) => `${value}年前`,
  },
  {
    pattern: /^上次构建：(.+)$/,
    render: (value) => `前回ビルド: ${value}`,
  },
  {
    pattern: /^场景 (\d+)$/,
    render: (value) => `${value} シーン`,
  },
  {
    pattern: /^镜头 (\d+)$/,
    render: (value) => `${value} カット`,
  },
  {
    pattern: /^(\d+) 镜头$/,
    render: (value) => `${value} カット`,
  },
  {
    pattern: /^技能 (.+) 安装成功$/,
    render: (value) => `スキル ${value} をインストールしました`,
  },
  {
    pattern: /^技能 (.+) 已卸载$/,
    render: (value) => `スキル ${value} をアンインストールしました`,
  },
  {
    pattern: /^仓库元信息已同步：共 (\d+) 个技能，更新 (\d+) 项$/,
    render: (total, updated) =>
      `リポジトリのメタデータを同期しました: 全 ${total} 個のスキル、${updated} 件更新`,
  },
  {
    pattern: /^仓库元信息已是最新（共 (\d+) 个技能）$/,
    render: (total) =>
      `リポジトリのメタデータは最新です（全 ${total} 個のスキル）`,
  },
  {
    pattern: /^执行 git (.+) 失败：(.+)$/,
    render: (command, details) => `git ${command} の実行に失敗しました: ${details}`,
  },
  {
    pattern: /^下载仓库归档失败（(\d+)）(?::|：)?(.*)$/,
    render: (status, details) =>
      details?.trim()
        ? `リポジトリアーカイブのダウンロードに失敗しました (${status}): ${details.trim()}`
        : `リポジトリアーカイブのダウンロードに失敗しました (${status})`,
  },
  {
    pattern: /^仓库归档解压失败：(.+)$/,
    render: (details) => `リポジトリアーカイブの展開に失敗しました: ${details}`,
  },
  {
    pattern: /^已存在同名技能目录：(.+)。请先卸载同名技能后再安装。$/,
    render: (value) =>
      `同名のスキルディレクトリがすでに存在します: ${value}。再インストールする前に先にアンインストールしてください。`,
  },
  {
    pattern: /^MCP 服务「(.+)」已添加$/,
    render: (value) => `MCP サービス「${value}」を追加しました`,
  },
  {
    pattern: /^MCP 服务「(.+)」已更新$/,
    render: (value) => `MCP サービス「${value}」を更新しました`,
  },
  {
    pattern: /^已启用 (.+)$/,
    render: (value) => `${value} を有効化しました`,
  },
  {
    pattern: /^已停用 (.+)$/,
    render: (value) => `${value} を無効化しました`,
  },
  {
    pattern: /^执行时间：(.+)$/,
    render: (value) => `実行時間: ${value}`,
  },
  {
    pattern: /^更新时间 (.+)$/,
    render: (value) => `更新 ${value}`,
  },
  {
    pattern: /^已委派给：\*\*(.+)\*\*$/,
    render: (value) => `委譲先: **${value}**`,
  },
  {
    pattern: /^来自 Agent (.+) 的回报$/,
    render: (value) => `エージェント ${value} からの報告`,
  },
  {
    pattern: /^操作 (.+)$/,
    render: (value) => `${value} の操作`,
  },
  {
    pattern: /^广播渠道 (\d+)$/,
    render: (value) => `配信チャネル ${value}`,
  },
  {
    pattern: /^建议镜头素材：(.+)$/,
    render: (value) => `おすすめのショット素材: ${value}`,
  },
  {
    pattern: /^系统预览打开失败: (.+)$/,
    render: (value) => `システムプレビューを開けませんでした: ${value}`,
  },
  {
    pattern: /^当前有 (\d+) 个任务仍在运行$/,
    render: (value) => `現在 ${value} 件のタスクが実行中です`,
  },
  {
    pattern: /^• 以及另外 (\d+) 个任务$/,
    render: (value) => `• ほかに ${value} 件のタスク`,
  },
  {
    pattern: /^(.+) · 应用预览$/,
    render: (value) => `${value} · アプリプレビュー`,
  },
  {
    pattern: /^(.+)-副本(\.[^.]+)?$/,
    render: (value, ext = "") => `${value}-コピー${ext}`,
  },
  {
    pattern: /^(.*)\n\.\.\.\(已截断\)$/,
    render: (value) => `${value}\n...(省略)`,
  },
  {
    pattern: /^(.+) 文生视频。$/,
    render: (value) => `${value} テキストから動画。`,
  },
  {
    pattern: /^(.+) 图生视频。$/,
    render: (value) => `${value} 画像から動画。`,
  },
  {
    pattern: /^(.+) 参考图到视频。$/,
    render: (value) => `${value} 参照画像から動画。`,
  },
  {
    pattern: /^(.+) 首尾帧生视频。$/,
    render: (value) => `${value} 最初と最後のフレームから動画。`,
  },
];

const PATTERN_TRANSLATIONS: Record<AppLanguage, PatternTranslation[]> = {
  "zh-CN": [],
  "en-US": EN_US_PATTERNS,
  "ko-KR": KO_KR_PATTERNS,
  "ja-JP": JA_JP_PATTERNS,
};

const translateCoreText = (language: AppLanguage, value: string): string => {
  if (language === "zh-CN") {
    return value;
  }

  const exact =
    EXTRA_EXACT_TRANSLATIONS[language][value] ??
    EXACT_TRANSLATIONS[language][value];
  if (exact) {
    return exact;
  }

  for (const item of PATTERN_TRANSLATIONS[language]) {
    const matched = value.match(item.pattern);
    if (!matched) continue;
    return item.render(...matched.slice(1));
  }

  return value;
};

export const translateUiText = (
  language: AppLanguage,
  value: string,
): string => {
  if (!value) return value;

  const leading = value.match(/^\s*/)?.[0] ?? "";
  const trailing = value.match(/\s*$/)?.[0] ?? "";
  const core = value.trim();
  if (!core) return value;

  return `${leading}${translateCoreText(language, core)}${trailing}`;
};

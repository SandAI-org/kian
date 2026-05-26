import {
  CheckCircleFilled,
  CloseCircleFilled,
  DownOutlined,
  LinkOutlined,
  MessageOutlined,
  ReloadOutlined,
  RobotOutlined,
  SettingOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import { ScrollArea } from "@renderer/components/ScrollArea";
import { useAppI18n } from "@renderer/i18n/AppI18nProvider";
import { api } from "@renderer/lib/api";
import { openUrl } from "@renderer/lib/openUrl";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, Card, Space, Tabs, Tag, Typography, message } from "antd";
import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

type AutoSetupTarget = "node-pnpm" | "claude-code" | "channels";

type MainAgentLaunchPayload = {
  actionKey: string;
  promptKey: string;
  titleKey: string;
  successKey: string;
};

const NODE_PNPM_INSTALL_COMMANDS = String.raw`# Download and install nvm:
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash

# in lieu of restarting the shell
\. "$HOME/.nvm/nvm.sh"

# Download and install Node.js:
nvm install 24

# Verify the Node.js version:
node -v # Should print "v24.14.0".

# Download and install pnpm:
corepack enable pnpm

# Verify pnpm version:
pnpm -v`;

const CLAUDE_CODE_INSTALL_COMMAND =
  "curl -fsSL https://claude.ai/install.sh | bash";

const AUTO_SETUP_PROMPTS: Record<AutoSetupTarget, string> = {
  "node-pnpm":
    "请帮我检查并安装 Node.js 与 pnpm。优先使用 nvm 安装 Node.js 24，再执行 corepack enable pnpm。完成后请验证 node -v 和 pnpm -v，并把执行结果发给我。",
  "claude-code":
    "请帮我安装 Claude Code（命令：curl -fsSL https://claude.ai/install.sh | bash），安装后请验证 claude --version，并告诉我下一步如何开始使用。",
  channels:
    "请帮我完成 Kian 的渠道配置准备：先判断我更适合 Telegram、Discord 还是飞书；给出最短配置步骤；最后引导我在设置-渠道中完成必填项并启用。",
};

const MODEL_SETUP_PROMPT =
  "帮我配置下语言模型。如果这是修改 Kian 自身配置，请使用 self-management 技能：先确认当前生效的配置文件和可用 Provider，再帮我完成必要的模型配置；修改完成后请调用 ReloadSettings，让新配置对快捷键、聊天通道和后续 Agent 会话立即生效。如果缺少必要信息，请先问我最少的问题。";

const CHAT_EXAMPLE_PROMPTS = [
  "为我创建一个“我的野蛮女友”智能体，并让它出来给我讲个笑话。",
  "为我整理下电脑的下载文件夹",
  "帮我网上调研下美国和伊朗战争的最新局势",
  "把你的主题调整为浅色模式",
  "为我开发一个房贷计算器",
  "为我开发一个大鱼吃小鱼的小游戏",
] as const;

const StatusTag = ({
  color,
  label,
}: {
  color?: string;
  label: string;
}) => (
  <Tag color={color} className="!m-0">
    {label}
  </Tag>
);

export const GuidePage = () => {
  const { t } = useAppI18n();
  const navigate = useNavigate();
  const [showNodeCommands, setShowNodeCommands] = useState(false);
  const [showClaudeCommand, setShowClaudeCommand] = useState(false);
  const [isModelStepExpanded, setIsModelStepExpanded] = useState(false);

  const modelStatusQuery = useQuery({
    queryKey: ["settings", "guide", "main-model-status"],
    queryFn: () => api.settings.get({ type: "main" }),
  });

  const envQuery = useQuery({
    queryKey: ["onboarding", "environment"],
    queryFn: api.onboarding.getEnvironmentStatus,
  });

  const channelsQuery = useQuery({
    queryKey: ["onboarding", "channels"],
    queryFn: async () => {
      const [telegram, discord, feishu, weixin] = await Promise.all([
        api.settings.getTelegramChatChannelStatus(),
        api.settings.getDiscordChatChannelStatus(),
        api.settings.getFeishuChatChannelStatus(),
        api.settings.getWeixinChatChannelStatus(),
      ]);
      return { telegram, discord, feishu, weixin };
    },
  });

  const hasConfiguredChannel = useMemo(() => {
    const value = channelsQuery.data;
    if (!value) return false;
    return [value.telegram, value.discord, value.feishu, value.weixin].some(
      (item) => item.configured,
    );
  }, [channelsQuery.data]);

  const refreshChecks = useCallback(() => {
    void Promise.all([envQuery.refetch(), channelsQuery.refetch()]);
  }, [channelsQuery, envQuery]);

  const hasConfiguredModel = useMemo(
    () => (modelStatusQuery.data?.allEnabledModels.length ?? 0) > 0,
    [modelStatusQuery.data],
  );

  const canCollapseModelStep = hasConfiguredModel;
  const shouldExpandModelStep = canCollapseModelStep
    ? isModelStepExpanded
    : true;

  const renderInstalledStatus = useCallback(
    (installed: boolean, version?: string) => (
      <StatusTag
        color={installed ? "success" : "default"}
        label={`${installed ? t("已安装") : t("未安装")}${version ? ` · ${version}` : ""}`}
      />
    ),
    [t],
  );

  const openSettingsTab = useCallback(
    (tab: "agent" | "channels") => {
      navigate(`/settings?tab=${tab}`);
    },
    [navigate],
  );

  const launchMainAgentMutation = useMutation({
    mutationFn: async ({
      promptKey,
      titleKey,
    }: MainAgentLaunchPayload): Promise<string> => {
      const session = await api.chat.createSession({
        scope: { type: "main" },
        module: "main",
        title: t(titleKey),
      });

      await api.chat.sendMessage({
        scope: { type: "main" },
        module: "main",
        sessionId: session.id,
        message: t(promptKey),
      });

      try {
        await api.window.openMainAgentSession(session.id);
      } catch {
        navigate(`/main-agent?session=${encodeURIComponent(session.id)}`);
      }

      return session.id;
    },
    onSuccess: (_, variables) => {
      message.success(t(variables.successKey));
    },
    onError: (error) => {
      message.error(
        error instanceof Error ? error.message : t("主 Agent 请求发送失败"),
      );
    },
  });

  const pendingActionKey = launchMainAgentMutation.isPending
    ? launchMainAgentMutation.variables?.actionKey
    : undefined;

  const triggerAutoSetup = useCallback(
    (target: AutoSetupTarget) => {
      launchMainAgentMutation.mutate({
        actionKey: target,
        promptKey: AUTO_SETUP_PROMPTS[target],
        titleKey: "引导自动配置",
        successKey: "已向 Kian 发送自动配置请求",
      });
    },
    [launchMainAgentMutation],
  );

  const handleModelSetup = useCallback(() => {
    launchMainAgentMutation.mutate({
      actionKey: "model-config",
      promptKey: MODEL_SETUP_PROMPT,
      titleKey: "语言模型配置",
      successKey: "已向主 Agent 发送配置请求",
    });
  }, [launchMainAgentMutation]);

  const guideTabs = useMemo(
    () => [
      {
        key: "quick-start",
        label: t("快速开始"),
        children: (
          <div className="rounded-[28px] bg-[#0f172a] px-8 py-8 text-white shadow-[0_18px_40px_rgba(15,23,42,0.24)]">
            <div className="flex flex-col gap-12">
              <section className="flex flex-col gap-5">
                <button
                  type="button"
                  className="w-full text-left"
                  aria-expanded={shouldExpandModelStep}
                  aria-label={t(shouldExpandModelStep ? "收起" : "展开")}
                  onClick={() => {
                    if (!canCollapseModelStep) return;
                    setIsModelStepExpanded((value) => !value);
                  }}
                >
                  <div className="grid grid-cols-[88px_minmax(0,1fr)_32px] items-start gap-4">
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#2f6ff7] text-xl font-semibold text-white shadow-[0_10px_24px_rgba(47,111,247,0.34)]">
                      {hasConfiguredModel ? <CheckCircleFilled /> : "1"}
                    </div>
                    <div className="min-w-0">
                      <div className="flex min-h-11 flex-wrap items-center gap-3">
                        <Typography.Title
                          level={2}
                          className="!mb-0 !text-[28px] !font-semibold !leading-none !text-white"
                        >
                          {t("配置模型")}
                        </Typography.Title>
                        {hasConfiguredModel ? (
                          <span className="inline-flex items-center gap-2 rounded-full bg-[rgba(34,197,94,0.14)] px-3 py-1 text-sm font-medium text-[#86efac]">
                            <CheckCircleFilled />
                            {t("已完成")}
                          </span>
                        ) : null}
                      </div>
                      {shouldExpandModelStep ? (
                        <Typography.Paragraph className="!mb-0 !mt-5 !text-[18px] !leading-8 !text-slate-300">
                          {t("先选择 Provider、填写 API Key，并启用至少一个可用模型。")}
                        </Typography.Paragraph>
                      ) : null}
                    </div>
                    <div className="flex h-11 items-center justify-end text-slate-400">
                      {canCollapseModelStep ? (
                        <DownOutlined
                          className={`transition-transform duration-200 ${
                            shouldExpandModelStep ? "rotate-0" : "-rotate-90"
                          }`}
                        />
                      ) : null}
                    </div>
                  </div>
                </button>

                <div
                  className={`overflow-hidden pl-[104px] transition-[max-height,opacity,padding-top] duration-200 ease-out ${
                    shouldExpandModelStep
                      ? "max-h-[220px] pt-5 opacity-100"
                      : "max-h-0 pt-0 opacity-0"
                  }`}
                >
                  <div className="flex flex-wrap gap-4">
                    <Button
                      icon={<SettingOutlined />}
                      className="!h-14 !rounded-full !border-[#263a5a] !bg-[#152036] !px-7 !text-[16px] !font-semibold !text-slate-100 shadow-[inset_0_0_0_1px_rgba(82,116,166,0.12)] hover:!border-[#35527b] hover:!bg-[#1a2741] hover:!text-white"
                      onClick={() => openSettingsTab("agent")}
                    >
                      {t("前往语言模型配置")}
                    </Button>
                    <Button
                      type="primary"
                      icon={<RobotOutlined />}
                      className="!h-14 !rounded-full !border-none !bg-[#2f6ff7] !px-7 !text-[16px] !font-semibold shadow-[0_12px_24px_rgba(47,111,247,0.35)] hover:!bg-[#4a82ff]"
                      loading={pendingActionKey === "model-config"}
                      onClick={handleModelSetup}
                    >
                      {t("让 Kian 帮我配置")}
                    </Button>
                  </div>
                </div>
              </section>

              <section className="flex flex-col gap-5">
                <div className="grid grid-cols-[88px_minmax(0,1fr)] items-start gap-4">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full border border-[rgba(148,163,184,0.35)] bg-transparent text-xl font-semibold text-white">
                    2
                  </div>
                  <div className="min-w-0">
                    <Typography.Title
                      level={2}
                      className="!mb-0 !text-[28px] !font-semibold !leading-none !text-white"
                    >
                      {t("开始聊天")}
                    </Typography.Title>
                    <Typography.Paragraph className="!mb-0 !mt-5 !text-[18px] !leading-8 !text-slate-300">
                      {t("如果不知道聊什么可以点击下面的消息快速体验下")}
                    </Typography.Paragraph>
                  </div>
                </div>

                <div className="pl-[104px]">
                  <div className="flex flex-wrap gap-4">
                    {CHAT_EXAMPLE_PROMPTS.map((prompt) => (
                      <Button
                        key={prompt}
                        shape="round"
                        icon={<MessageOutlined />}
                        className="!h-auto !max-w-full !rounded-full !border-[#263a5a] !bg-[#152036] !px-6 !py-3 !text-[16px] !font-semibold !text-slate-100 shadow-[inset_0_0_0_1px_rgba(82,116,166,0.12)] hover:!border-[#35527b] hover:!bg-[#1a2741] hover:!text-white [&>span]:!whitespace-normal"
                        loading={pendingActionKey === prompt}
                        onClick={() =>
                          launchMainAgentMutation.mutate({
                            actionKey: prompt,
                            promptKey: prompt,
                            titleKey: "快速开始示例",
                            successKey: "已向主 Agent 发送示例消息",
                          })
                        }
                      >
                        {t(prompt)}
                      </Button>
                    ))}
                  </div>
                </div>
              </section>
            </div>
          </div>
        ),
      },
      {
        key: "environment",
        label: t("环境检测"),
        children: (
          <div className="flex flex-col gap-4 pt-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Typography.Title level={4} className="!mb-1 !text-slate-900">
                  {t("环境检测")}
                </Typography.Title>
                <Typography.Paragraph className="!mb-0 !text-slate-600">
                  {t("确认本机依赖和渠道配置是否已准备就绪。")}
                </Typography.Paragraph>
              </div>
              <Button
                icon={<ReloadOutlined />}
                loading={envQuery.isFetching || channelsQuery.isFetching}
                onClick={refreshChecks}
              >
                {t("重新检测")}
              </Button>
            </div>

            <Card bordered={false} className="!rounded-2xl !bg-white">
              <div className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <Typography.Title level={4} className="!mb-1 !text-slate-900">
                      {t("Node.js 与 pnpm")}
                    </Typography.Title>
                    <Typography.Paragraph className="!mb-0 !text-slate-600">
                      {t(
                        "启用后，你可以使用应用模块开发前端应用，也可以快速构建各类小应用和小游戏。",
                      )}
                    </Typography.Paragraph>
                  </div>
                  <Space size={8} align="center" wrap>
                    {envQuery.data ? (
                      <>
                        {renderInstalledStatus(
                          envQuery.data.node.installed,
                          envQuery.data.node.version,
                        )}
                        {renderInstalledStatus(
                          envQuery.data.pnpm.installed,
                          envQuery.data.pnpm.version,
                        )}
                      </>
                    ) : (
                      <StatusTag label={t("检测中")} />
                    )}
                  </Space>
                </div>

                <Space wrap>
                  <Button
                    icon={<ToolOutlined />}
                    onClick={() => setShowNodeCommands((value) => !value)}
                  >
                    {t(showNodeCommands ? "隐藏手动配置" : "手动配置")}
                  </Button>
                  <Button
                    icon={<RobotOutlined />}
                    loading={pendingActionKey === "node-pnpm"}
                    onClick={() => triggerAutoSetup("node-pnpm")}
                  >
                    {t("让 Kian 自动配置")}
                  </Button>
                </Space>

                {showNodeCommands ? (
                  <div className="flex flex-col gap-2">
                    <div className="rounded-lg border border-slate-200 bg-slate-900 p-3">
                      <pre className="whitespace-pre-wrap break-words text-xs leading-6 text-slate-100">
                        {NODE_PNPM_INSTALL_COMMANDS}
                      </pre>
                    </div>
                    <Button
                      size="small"
                      type="link"
                      icon={<LinkOutlined />}
                      className="!h-auto !w-fit !px-0"
                      onClick={() =>
                        void openUrl("https://nodejs.org/en/download")
                      }
                    >
                      {t("打开 Node.js 下载页")}
                    </Button>
                  </div>
                ) : null}
              </div>
            </Card>

            <Card bordered={false} className="!rounded-2xl !bg-white">
              <div className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <Typography.Title level={4} className="!mb-1 !text-slate-900">
                      {t("Claude Code")}
                    </Typography.Title>
                    <Typography.Paragraph className="!mb-0 !text-slate-600">
                      {t(
                        "启用后，你可以把编程任务直接委托给 Kian，由它在对应 Agent 工作区中执行并反馈结果。",
                      )}
                    </Typography.Paragraph>
                  </div>
                  {envQuery.data ? (
                    renderInstalledStatus(
                      envQuery.data.claudeCode.installed,
                      envQuery.data.claudeCode.version,
                    )
                  ) : (
                    <StatusTag label={t("检测中")} />
                  )}
                </div>

                <Space wrap>
                  <Button
                    icon={<ToolOutlined />}
                    onClick={() => setShowClaudeCommand((value) => !value)}
                  >
                    {t(showClaudeCommand ? "隐藏手动配置" : "手动配置")}
                  </Button>
                  <Button
                    icon={<RobotOutlined />}
                    loading={pendingActionKey === "claude-code"}
                    onClick={() => triggerAutoSetup("claude-code")}
                  >
                    {t("让 Kian 自动配置")}
                  </Button>
                </Space>

                {showClaudeCommand ? (
                  <div className="flex flex-col gap-2">
                    <div className="rounded-lg border border-slate-200 bg-slate-900 p-3">
                      <pre className="whitespace-pre-wrap break-words text-xs leading-6 text-slate-100">
                        {CLAUDE_CODE_INSTALL_COMMAND}
                      </pre>
                    </div>
                    <Button
                      size="small"
                      type="link"
                      icon={<LinkOutlined />}
                      className="!h-auto !w-fit !px-0"
                      onClick={() =>
                        void openUrl(
                          "https://code.claude.com/docs/en/overview#terminal",
                        )
                      }
                    >
                      {t("打开 Claude Code 文档")}
                    </Button>
                  </div>
                ) : null}
              </div>
            </Card>

            <Card bordered={false} className="!rounded-2xl !bg-white">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Typography.Title level={4} className="!mb-1 !text-slate-900">
                    {t("Codex")}
                  </Typography.Title>
                  <Typography.Paragraph className="!mb-0 !text-slate-600">
                    {t("检测你当前系统里是否已安装 Codex CLI，便于后续需要时直接使用。")}
                  </Typography.Paragraph>
                </div>
                {envQuery.data ? (
                  renderInstalledStatus(
                    envQuery.data.codex.installed,
                    envQuery.data.codex.version,
                  )
                ) : (
                  <StatusTag label={t("检测中")} />
                )}
              </div>
            </Card>

            <Card bordered={false} className="!rounded-2xl !bg-white">
              <div className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <Typography.Title level={4} className="!mb-1 !text-slate-900">
                      {t("渠道配置")}
                    </Typography.Title>
                    <Typography.Paragraph className="!mb-0 !text-slate-600">
                      {t("启用后，你可以在手机端通过 IM 聊天工具远程控制 Kian。")}
                    </Typography.Paragraph>
                  </div>
                  <Tag
                    color={hasConfiguredChannel ? "success" : "default"}
                    className="!m-0"
                  >
                    {hasConfiguredChannel ? (
                      <span className="inline-flex items-center gap-1">
                        <CheckCircleFilled />
                        {t("已配置")}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <CloseCircleFilled />
                        {t("未配置")}
                      </span>
                    )}
                  </Tag>
                </div>

                <Space wrap>
                  <Button
                    icon={<ToolOutlined />}
                    onClick={() => openSettingsTab("channels")}
                  >
                    {t("手动配置")}
                  </Button>
                  <Button
                    icon={<RobotOutlined />}
                    loading={pendingActionKey === "channels"}
                    onClick={() => triggerAutoSetup("channels")}
                  >
                    {t("让 Kian 自动配置")}
                  </Button>
                </Space>
              </div>
            </Card>
          </div>
        ),
      },
    ],
    [
      envQuery.data,
      envQuery.isFetching,
      channelsQuery.isFetching,
      handleModelSetup,
      hasConfiguredChannel,
      launchMainAgentMutation,
      openSettingsTab,
      pendingActionKey,
      refreshChecks,
      renderInstalledStatus,
      showClaudeCommand,
      showNodeCommands,
      t,
      triggerAutoSetup,
    ],
  );

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto flex w-full max-w-[1180px] flex-col px-5 pb-5 pt-4">
        <Tabs
          items={guideTabs}
          className="[&_.ant-tabs-nav]:!mb-5"
        />
      </div>
    </ScrollArea>
  );
};

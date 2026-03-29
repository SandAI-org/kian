import type { MainLayoutOutletContext } from "@renderer/app/MainLayout";
import { ScrollArea } from "@renderer/components/ScrollArea";
import { useAppI18n } from "@renderer/i18n/AppI18nProvider";
import { translateUiText } from "@renderer/i18n/uiTranslations";
import { api } from "@renderer/lib/api";
import type { McpServerDTO, McpTransportType } from "@shared/types";
import { formatUtcTimestampToLocal } from "@shared/utils/dateTime";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiOutlined,
  CloseOutlined,
  CodeOutlined,
  EditOutlined,
  InfoCircleOutlined,
  LinkOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import {
  Button,
  Card,
  Drawer,
  Empty,
  Form,
  Input,
  Space,
  Spin,
  Switch,
  Tabs,
  Tag,
  Typography,
  message,
} from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";

type McpFormValues = {
  name: string;
  command?: string;
  argsText?: string;
  cwd?: string;
  envText?: string;
  url?: string;
  headersText?: string;
};

const TRANSPORT_LABELS: Record<McpTransportType, string> = {
  stdio: "标准输入输出",
  sse: "SSE",
  "streamable-http": "HTTP",
};

const parseArgsText = (raw: string | undefined): string[] =>
  (raw ?? "")
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

const parseKeyValueText = (raw: string | undefined): Record<string, string> => {
  const result: Record<string, string> = {};
  const lines = (raw ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (const line of lines) {
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      throw new Error(`无法解析键值对：${line}`);
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (!key) {
      throw new Error(`键不能为空：${line}`);
    }
    result[key] = value;
  }

  return result;
};

const formatArgsText = (args: string[]): string => args.join("\n");

const formatKeyValueText = (value: Record<string, string>): string =>
  Object.entries(value)
    .map(([key, item]) => `${key}=${item}`)
    .join("\n");

const summarizeServer = (server: McpServerDTO): string => {
  if (server.transport === "stdio") {
    const commandParts = [server.command, ...server.args].filter(Boolean);
    return commandParts.join(" ") || "未配置命令";
  }
  return server.url || "未配置 URL";
};

const getTransportIcon = (transport: McpTransportType) => {
  if (transport === "stdio") {
    return <CodeOutlined className="!text-slate-500" />;
  }
  return <LinkOutlined className="!text-slate-500" />;
};

const mcpCardBaseClassName =
  "!rounded-xl !border-[#dde6f5] !bg-white !shadow-[0_8px_20px_rgba(15,23,42,0.03)] !transition-all !duration-200 hover:!-translate-y-0.5 hover:!border-[#cbd9f0] hover:!shadow-[0_12px_24px_rgba(15,23,42,0.06)]";

export const McpPage = () => {
  const queryClient = useQueryClient();
  const { language } = useAppI18n();
  const t = (value: string): string => translateUiText(language, value);
  const { setHeaderActions } = useOutletContext<MainLayoutOutletContext>();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<McpServerDTO | null>(null);
  const [activeTransport, setActiveTransport] =
    useState<McpTransportType>("stdio");
  const [form] = Form.useForm<McpFormValues>();

  const mcpServersQuery = useQuery({
    queryKey: ["settings", "mcp-servers"],
    queryFn: api.settings.getMcpServers,
  });

  const refreshMcpServers = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ["settings", "mcp-servers"] });
  };

  const addMcpServerMutation = useMutation({
    mutationFn: async (values: McpFormValues) => {
      const payload = {
        name: values.name.trim(),
        transport: activeTransport,
        enabled: true,
        command: activeTransport === "stdio" ? values.command?.trim() : undefined,
        args: activeTransport === "stdio" ? parseArgsText(values.argsText) : [],
        cwd: activeTransport === "stdio" ? values.cwd?.trim() : undefined,
        env:
          activeTransport === "stdio"
            ? parseKeyValueText(values.envText)
            : {},
        url: activeTransport !== "stdio" ? values.url?.trim() : undefined,
        headers:
          activeTransport !== "stdio"
            ? parseKeyValueText(values.headersText)
            : {},
      };
      return api.settings.addMcpServer(payload);
    },
    onSuccess: async (server) => {
      message.success(`MCP 服务「${server.name}」已添加`);
      setEditingServer(null);
      setIsDrawerOpen(false);
      setActiveTransport("stdio");
      form.resetFields();
      await refreshMcpServers();
    },
    onError: (error) => {
      message.error(
        error instanceof Error ? error.message : t("添加 MCP 服务失败"),
      );
    },
  });

  const updateMcpServerMutation = useMutation({
    mutationFn: async (values: McpFormValues) => {
      if (!editingServer) {
        throw new Error(t("缺少待编辑的 MCP 服务"));
      }

      const payload = {
        id: editingServer.id,
        name: values.name.trim(),
        transport: activeTransport,
        enabled: editingServer.enabled,
        command: activeTransport === "stdio" ? values.command?.trim() : undefined,
        args: activeTransport === "stdio" ? parseArgsText(values.argsText) : [],
        cwd: activeTransport === "stdio" ? values.cwd?.trim() : undefined,
        env:
          activeTransport === "stdio"
            ? parseKeyValueText(values.envText)
            : {},
        url: activeTransport !== "stdio" ? values.url?.trim() : undefined,
        headers:
          activeTransport !== "stdio"
            ? parseKeyValueText(values.headersText)
            : {},
      };
      return api.settings.updateMcpServer(payload);
    },
    onSuccess: async (server) => {
      message.success(`MCP 服务「${server.name}」已更新`);
      setEditingServer(null);
      setIsDrawerOpen(false);
      setActiveTransport("stdio");
      form.resetFields();
      await refreshMcpServers();
    },
    onError: (error) => {
      message.error(
        error instanceof Error ? error.message : t("更新 MCP 服务失败"),
      );
    },
  });

  const toggleServerMutation = useMutation({
    mutationFn: (payload: { id: string; enabled: boolean }) =>
      api.settings.setMcpServerEnabled(payload),
    onSuccess: async (server) => {
      message.success(
        server.enabled
          ? `已启用 ${server.name}`
          : `已停用 ${server.name}`,
      );
      await refreshMcpServers();
    },
    onError: (error) => {
      message.error(
        error instanceof Error ? error.message : t("切换 MCP 状态失败"),
      );
    },
  });

  const isSaving =
    addMcpServerMutation.isPending || updateMcpServerMutation.isPending;

  const resetFormState = (): void => {
    setEditingServer(null);
    setActiveTransport("stdio");
    form.resetFields();
  };

  const openEditDrawer = (server: McpServerDTO): void => {
    setEditingServer(server);
    setActiveTransport(server.transport);
    form.setFieldsValue({
      name: server.name,
      command: server.command,
      argsText: formatArgsText(server.args),
      cwd: server.cwd,
      envText: formatKeyValueText(server.env),
      url: server.url,
      headersText: formatKeyValueText(server.headers),
    });
    setIsDrawerOpen(true);
  };

  const closeDrawer = (): void => {
    if (isSaving) return;
    setIsDrawerOpen(false);
    resetFormState();
  };

  const openCreateDrawer = useCallback(() => {
    setEditingServer(null);
    setActiveTransport("stdio");
    form.resetFields();
    setIsDrawerOpen(true);
  }, [form]);

  const headerActions = useMemo(
    () => (
      <Button
        type="primary"
        icon={<PlusOutlined />}
        className="!h-10 !rounded-full !px-5"
        onClick={openCreateDrawer}
      >
        {translateUiText(language, "添加 MCP 服务")}
      </Button>
    ),
    [language, openCreateDrawer],
  );

  useEffect(() => {
    setHeaderActions(headerActions);
    return () => {
      setHeaderActions(null);
    };
  }, [headerActions, setHeaderActions]);

  const submitServer = async (): Promise<void> => {
    try {
      const values = await form.validateFields();
      if (editingServer) {
        updateMcpServerMutation.mutate(values);
      } else {
        addMcpServerMutation.mutate(values);
      }
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "errorFields" in error
      ) {
        return;
      }
      message.error(error instanceof Error ? error.message : t("表单校验失败"));
    }
  };

  return (
    <>
      <ScrollArea className="h-full">
        <div className="space-y-4 px-5 pb-5 pt-4">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <InfoCircleOutlined className="!text-slate-400" />
            <Typography.Text className="!text-xs !text-slate-500">
              {t("已启用的服务会在下一轮 Agent 对话时自动注入运行时")}
            </Typography.Text>
          </div>

          {mcpServersQuery.isLoading ? (
            <div className="flex h-[180px] items-center justify-center">
              <Spin />
            </div>
          ) : (mcpServersQuery.data ?? []).length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t("还没有 MCP 服务，点击右上角按钮添加")}
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {(mcpServersQuery.data ?? []).map((server) => {
                const toggleLoading =
                  toggleServerMutation.isPending &&
                  toggleServerMutation.variables?.id === server.id;

                return (
                  <Card
                    key={server.id}
                    size="small"
                    className={mcpCardBaseClassName}
                  >
                    <Space direction="vertical" size={10} className="w-full">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <ApiOutlined className="!text-slate-500" />
                            <Typography.Text className="!text-sm !font-semibold !text-slate-900">
                              {server.name}
                            </Typography.Text>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Tag className="!m-0">
                              {TRANSPORT_LABELS[server.transport]}
                            </Tag>
                            <Tag
                              color={server.enabled ? "blue" : "default"}
                              className="!m-0"
                            >
                              {server.enabled ? t("已启用") : t("已停用")}
                            </Tag>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={server.enabled}
                            loading={toggleLoading}
                            onChange={(checked) =>
                              toggleServerMutation.mutate({
                                id: server.id,
                                enabled: checked,
                              })
                            }
                          />
                          <Button
                            size="small"
                            icon={<EditOutlined />}
                            onClick={() => openEditDrawer(server)}
                          >
                            {t("编辑")}
                          </Button>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        {getTransportIcon(server.transport)}
                        <span>
                          {t(
                            server.transport === "stdio"
                              ? "启动命令"
                              : "服务地址",
                          )}
                        </span>
                      </div>
                      <Typography.Paragraph
                        className="!my-0 break-all !font-mono !text-[13px] !text-slate-700"
                        ellipsis={{ rows: 2 }}
                      >
                        {summarizeServer(server)}
                      </Typography.Paragraph>

                      <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                        {server.transport === "stdio" ? (
                          <>
                            <span>{t(`参数 ${server.args.length}`)}</span>
                            <span>
                              {t(`环境变量 ${Object.keys(server.env).length}`)}
                            </span>
                            <span>
                              {t(`工作目录 ${server.cwd ? "已设置" : "未设置"}`)}
                            </span>
                          </>
                        ) : (
                          <>
                            <span>
                              {t("请求头")} {Object.keys(server.headers).length}
                            </span>
                            <span>
                              {t(
                                `更新时间 ${formatUtcTimestampToLocal(server.updatedAt)}`,
                              )}
                            </span>
                          </>
                        )}
                      </div>
                    </Space>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </ScrollArea>

      <Drawer
        title={editingServer ? t("编辑 MCP 服务") : t("添加 MCP 服务")}
        placement="right"
        open={isDrawerOpen}
        onClose={closeDrawer}
        closable={false}
        extra={
          <Button
            type="text"
            icon={<CloseOutlined />}
            aria-label="关闭"
            disabled={isSaving}
            onClick={closeDrawer}
          />
        }
        width={720}
        maskClosable={!isSaving}
        styles={{
          body: {
            padding: 0,
            overflow: "hidden",
          },
        }}
        footer={
          <div className="flex items-center justify-end gap-3">
            <Button onClick={closeDrawer}>
              {t("取消")}
            </Button>
            <Button
              type="primary"
              loading={isSaving}
              onClick={() => {
                void submitServer();
              }}
            >
              {editingServer ? t("保存修改") : t("添加服务")}
            </Button>
          </div>
        }
      >
        <div className="h-full min-h-0">
          <ScrollArea className="h-full">
            <div className="px-5 py-4">
              <Tabs
                activeKey={activeTransport}
                onChange={(key) => setActiveTransport(key as McpTransportType)}
                items={[
                  {
                    key: "stdio",
                    label: "标准输入输出",
                  },
                  {
                    key: "sse",
                    label: "SSE",
                  },
                  {
                    key: "streamable-http",
                    label: "HTTP",
                  },
                ]}
              />

              <Form
                form={form}
                layout="vertical"
                initialValues={{
                  name: "",
                  command: "",
                  argsText: "",
                  cwd: "",
                  envText: "",
                  url: "",
                  headersText: "",
                }}
              >
                <Form.Item
                  name="name"
                  label="服务名称"
                  rules={[{ required: true, message: t("请输入服务名称") }]}
                >
                  <Input placeholder="例如：Figma MCP / Browser MCP" />
                </Form.Item>

                {activeTransport === "stdio" ? (
                  <>
                    <Form.Item
                      name="command"
                      label="启动命令"
                      rules={[{ required: true, message: t("请输入启动命令") }]}
                    >
                      <Input placeholder="例如：npx -y @modelcontextprotocol/server-filesystem" />
                    </Form.Item>
                    <Form.Item
                      name="argsText"
                      label="命令参数"
                      extra="支持逗号或换行分隔"
                    >
                      <Input.TextArea
                        autoSize={{ minRows: 3, maxRows: 6 }}
                        placeholder="例如：/Users/lei/Projects"
                      />
                    </Form.Item>
                    <Form.Item
                      name="cwd"
                      label="工作目录"
                    >
                      <Input placeholder="可选，例如：/Users/lei/Projects/vivid" />
                    </Form.Item>
                    <Form.Item
                      name="envText"
                      label="环境变量"
                      extra="每行一个，格式 KEY=VALUE"
                    >
                      <Input.TextArea
                        autoSize={{ minRows: 4, maxRows: 8 }}
                        placeholder={"API_KEY=xxx\nDEBUG=1"}
                      />
                    </Form.Item>
                  </>
                ) : (
                  <>
                    <Form.Item
                      name="url"
                      label="服务 URL"
                      rules={[{ required: true, message: t("请输入服务 URL") }]}
                    >
                      <Input placeholder="例如：https://example.com/mcp" />
                    </Form.Item>
                    <Form.Item
                      name="headersText"
                      label="请求头"
                      extra="每行一个，格式 KEY=VALUE"
                    >
                      <Input.TextArea
                        autoSize={{ minRows: 4, maxRows: 8 }}
                        placeholder={"Authorization=Bearer xxx\nX-Workspace=demo"}
                      />
                    </Form.Item>
                  </>
                )}
              </Form>
            </div>
          </ScrollArea>
        </div>
      </Drawer>
    </>
  );
};

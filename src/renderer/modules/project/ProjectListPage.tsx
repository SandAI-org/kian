import {
  DeleteOutlined,
  EllipsisOutlined,
} from "@ant-design/icons";
import { IllustrationNewProject } from "@renderer/components/EmptyIllustrations";
import { ScrollArea } from "@renderer/components/ScrollArea";
import { api } from "@renderer/lib/api";
import type { ProjectDTO } from "@shared/types";
import { formatUtcTimestampToLocal } from "@shared/utils/dateTime";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Space, Spin, Typography, message } from "antd";
import { CompactDropdown } from "@renderer/components/CompactDropdown";
import { useAppI18n } from "@renderer/i18n/AppI18nProvider";
import { translateUiText } from "@renderer/i18n/uiTranslations";
import { useNavigate } from "react-router-dom";

export const ProjectListPage = () => {
  const { language } = useAppI18n();
  const t = (value: string): string => translateUiText(language, value);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const compactCardBodyStyle = { height: "100%", padding: "16px 18px" };
  const createCardBodyStyle = {
    ...compactCardBodyStyle,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };

  const projectQuery = useQuery({
    queryKey: ["projects"],
    queryFn: api.project.list,
  });

  const createMutation = useMutation({
    mutationFn: () => api.project.create({ source: "manual" }),
    onSuccess: async (project) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        queryClient.invalidateQueries({ queryKey: ["project"] }),
        queryClient.invalidateQueries({
          queryKey: ["settings", "chat-channel"],
        }),
      ]);
      navigate(`/agent/${project.id}`);
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : t("创建失败"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.project.delete(id),
    onSuccess: async (_result, deletedId) => {
      queryClient.setQueryData<ProjectDTO[]>(["projects"], (current) =>
        (current ?? []).filter((item) => item.id !== deletedId),
      );
      message.success("Agent 已删除");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        queryClient.invalidateQueries({ queryKey: ["project"] }),
        queryClient.invalidateQueries({
          queryKey: ["settings", "chat-channel"],
        }),
      ]);
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : t("删除失败"));
    },
  });
  const projects = projectQuery.data ?? [];
  const createCardClassName = [
    "panel group relative flex min-h-[154px] cursor-pointer items-center justify-center !rounded-[16px] border-dashed !bg-[#f8fbff] transition-all duration-200 hover:!border-[#2f6ff7] hover:!shadow-[0_12px_24px_rgba(47,111,247,0.12)]",
    projects.length === 0 ? "w-full max-w-[300px] justify-self-start" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <ScrollArea className="h-full">
      {projectQuery.isLoading ? (
        <div className="flex h-[60vh] items-center justify-center px-5">
          <Spin />
        </div>
      ) : (
        <div className="px-5 pb-5">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-3.5">
            <Card
              className={createCardClassName}
              bodyStyle={createCardBodyStyle}
              onClick={() => {
                if (createMutation.isPending) return;
                createMutation.mutate();
              }}
            >
              <Space direction="vertical" className="!items-center" size={4}>
                <IllustrationNewProject size={56} />
                <Typography.Text className="!text-sm !font-medium !text-slate-700">
                  {createMutation.isPending ? "创建中..." : "新建 Agent"}
                </Typography.Text>
              </Space>
            </Card>
            {projects.map((project) => (
              <Card
                key={project.id}
                className="panel group relative min-h-[154px] cursor-pointer !rounded-[16px] !bg-[#ffffff] transition-shadow duration-200 hover:!shadow-[0_12px_24px_rgba(15,23,42,0.08)]"
                bodyStyle={compactCardBodyStyle}
                onClick={(event) => {
                  const target = event.target as HTMLElement;
                  if (target.closest('[data-project-action="menu"]')) {
                    return;
                  }
                  navigate(`/agent/${project.id}`);
                }}
              >
                <div className="flex h-full w-full flex-col justify-between gap-2">
                  <div className="space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <Typography.Paragraph
                        className="!mb-0 !text-base !font-semibold !text-slate-900"
                        ellipsis={{ rows: 1 }}
                      >
                        {project.name}
                      </Typography.Paragraph>
                    </div>
                    <Typography.Paragraph
                      className="!mb-0 !text-slate-600"
                      ellipsis={{ rows: 2 }}
                    >
                      {project.description || "暂无描述"}
                    </Typography.Paragraph>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <Typography.Text className="!text-xs !text-slate-500">
                      更新时间 {formatUtcTimestampToLocal(project.updatedAt)}
                    </Typography.Text>
                    <CompactDropdown
                      trigger={["click"]}
                      menu={{
                        items: [
                          {
                            key: "delete",
                            label: "删除",
                            icon: <DeleteOutlined />,
                            danger: true,
                            onClick: async (e) => {
                              e.domEvent.stopPropagation();
                              await deleteMutation.mutateAsync(project.id);
                            },
                          },
                        ],
                      }}
                    >
                      <Button
                        type="text"
                        shape="circle"
                        icon={<EllipsisOutlined />}
                        data-project-action="menu"
                        className="no-drag -mr-2"
                        onClick={(event) => event.stopPropagation()}
                        onMouseDown={(event) => event.stopPropagation()}
                      />
                    </CompactDropdown>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </ScrollArea>
  );
};

import { useAppI18n } from "@renderer/i18n/AppI18nProvider";
import { Button } from "antd";

interface SidebarPanelIconProps {
  side: "left" | "right";
  collapsed: boolean;
}

const SidebarPanelIcon = ({ side, collapsed }: SidebarPanelIconProps) => {
  const dividerX = side === "left" ? 9 : 15;

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-[18px] w-[18px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="5" width="16" height="14" rx="3.2" />
      {collapsed ? (
        <path d={`M${dividerX} 9.5v5`} />
      ) : (
        <path d={`M${dividerX} 5v14`} />
      )}
    </svg>
  );
};

interface WorkspacePaneControlsProps {
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  showLeft?: boolean;
  showRight?: boolean;
}

export const WorkspacePaneControls = ({
  leftCollapsed,
  rightCollapsed,
  onToggleLeft,
  onToggleRight,
  showLeft = true,
  showRight = true,
}: WorkspacePaneControlsProps) => {
  const { t } = useAppI18n();
  const leftLabel = leftCollapsed ? t("展开左侧边栏") : t("折叠左侧边栏");
  const rightLabel = rightCollapsed
    ? t("展开右侧对话边栏")
    : t("折叠右侧对话边栏");
  const getButtonClassName = (collapsed: boolean): string =>
    `!h-9 !w-9 !rounded-xl ${
      collapsed
        ? "!text-slate-500 hover:!bg-[#eef3fc] hover:!text-slate-900"
        : "!bg-[#eef3fc] !text-slate-900"
    }`;
  const edgeAlignClassName =
    showLeft && !showRight
      ? "-ml-[9px]"
      : showRight && !showLeft
        ? "-mr-[9px]"
        : "";

  return (
    <div
      className={`no-drag flex items-center gap-1 ${edgeAlignClassName}`}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {showLeft ? (
        <Button
          type="text"
          size="small"
          className={getButtonClassName(leftCollapsed)}
          icon={<SidebarPanelIcon side="left" collapsed={leftCollapsed} />}
          aria-label={leftLabel}
          onClick={onToggleLeft}
        />
      ) : null}
      {showRight ? (
        <Button
          type="text"
          size="small"
          className={getButtonClassName(rightCollapsed)}
          icon={<SidebarPanelIcon side="right" collapsed={rightCollapsed} />}
          aria-label={rightLabel}
          onClick={onToggleRight}
        />
      ) : null}
    </div>
  );
};

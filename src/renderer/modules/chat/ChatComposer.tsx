import {
  ArrowUpOutlined,
  FileTextOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { RevealableImage } from "@renderer/components/RevealableImage";
import {
  CompactSelect,
  type CompactSelectOption,
} from "@renderer/components/CompactSelect";
import { ScrollArea } from "@renderer/components/ScrollArea";
import type { ChatThinkingLevel } from "@shared/types";
import { Button, Input, Tooltip } from "antd";
import type { ChangeEvent, KeyboardEvent, ReactNode, RefObject } from "react";

export interface LocalChatFile {
  key: string;
  name: string;
  sourcePath: string;
  size: number;
  mimeType?: string;
  extension: string;
  previewUrl?: string;
}

export const CHAT_THINKING_LEVEL_VALUES: ChatThinkingLevel[] = [
  "low",
  "medium",
  "high",
];

export interface QueuedComposerMessage {
  id: string;
  content: string;
  queuedAt: string;
  sourceName?: string;
}

const StopSquareIcon = (): ReactNode => (
  <span className="inline-flex h-[12px] w-[12px] items-center justify-center">
    <span className="inline-block h-[9px] w-[9px] rounded-[1px] bg-current" />
  </span>
);

interface ChatComposerProps {
  variant?: "default" | "embedded";
  queuedMessages?: QueuedComposerMessage[];
  queuedMessagesLabel?: string;
  queuedSourcePrefix?: string;
  queuedSourceSuffix?: string;
  removeQueuedMessageLabel?: string;
  onRemoveQueuedMessage?: (id: string) => void;
  pendingFiles?: LocalChatFile[];
  onRemovePendingFile?: (key: string) => void;
  showInputShortcutTip?: boolean;
  chatInputShortcutHint: ReactNode;
  onDismissInputShortcutTip?: () => void;
  dismissShortcutTipLabel?: string;
  inputContainerRef: RefObject<HTMLDivElement | null>;
  input: string;
  isComposing: boolean;
  onInputChange: (value: string) => void;
  onCompositionStart: () => void;
  onCompositionEnd: (value: string) => void;
  onInputKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder: string;
  fileInputRef?: RefObject<HTMLInputElement | null>;
  onSelectFiles?: (event: ChangeEvent<HTMLInputElement>) => void;
  fileAccept?: string;
  addFileLabel?: string;
  removeFileLabel?: (fileName: string) => string;
  selectedModel?: string;
  modelOptions?: CompactSelectOption[];
  onModelChange?: (value: string) => void;
  selectedThinkingLevel: ChatThinkingLevel;
  onThinkingLevelChange: (value: ChatThinkingLevel) => void;
  thinkingLevelOptions?: Array<{ label: string; value: ChatThinkingLevel }>;
  thinkingLevelMenuHeader: string;
  canInterrupt: boolean;
  interruptLoading: boolean;
  onInterrupt: () => void;
  sendLoading: boolean;
  onSend: () => void;
  canSend: boolean;
}

export const ChatComposer = ({
  variant = "default",
  queuedMessages = [],
  queuedMessagesLabel = "",
  queuedSourcePrefix = "",
  queuedSourceSuffix = "",
  removeQueuedMessageLabel = "",
  onRemoveQueuedMessage,
  pendingFiles = [],
  onRemovePendingFile,
  showInputShortcutTip = false,
  chatInputShortcutHint,
  onDismissInputShortcutTip,
  dismissShortcutTipLabel = "",
  inputContainerRef,
  input,
  isComposing,
  onInputChange,
  onCompositionStart,
  onCompositionEnd,
  onInputKeyDown,
  placeholder,
  fileInputRef,
  onSelectFiles,
  fileAccept,
  addFileLabel = "",
  removeFileLabel,
  selectedModel,
  modelOptions = [],
  onModelChange,
  selectedThinkingLevel,
  onThinkingLevelChange,
  thinkingLevelOptions = [],
  thinkingLevelMenuHeader,
  canInterrupt,
  interruptLoading,
  onInterrupt,
  sendLoading,
  onSend,
  canSend,
}: ChatComposerProps) => {
  const showFilePicker = Boolean(fileInputRef && onSelectFiles && fileAccept);
  const showModelSelector =
    modelOptions.length > 0 || Boolean(selectedModel?.trim());
  const disableModelSelector =
    modelOptions.length <= 1 || !onModelChange;
  const containerClassName =
    variant === "embedded"
      ? "rounded-[24px] border border-[#dbe5f5] bg-white px-4 py-4"
      : "rounded-xl border border-[#dbe5f5] bg-white px-3 py-3 shadow-[0_2px_12px_rgba(15,23,42,0.04)]";

  return (
    <div className={containerClassName}>
      {queuedMessages.length > 0 ? (
        <div className="mb-3 rounded-lg border border-[#dbe5f5] bg-[#f7faff]">
          <div className="border-b border-[#dbe5f5] px-3 py-2 text-[12px] font-medium text-slate-600">
            {queuedMessagesLabel}
          </div>
          <ScrollArea className="max-h-28 px-3 py-2">
            <div className="space-y-2 pr-2">
              {queuedMessages.map((item) => (
                <div
                  key={item.id}
                  className="rounded-md border border-[#d8e2f2] bg-white px-2.5 py-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      {item.sourceName ? (
                        <div className="flex items-center gap-1 text-[12px] text-slate-700">
                          <span>{queuedSourcePrefix}</span>
                          <span className="inline-flex rounded-full border border-[#d8e2f2] bg-[#f7faff] px-2 py-0.5 text-[11px] font-medium text-slate-600">
                            {item.sourceName}
                          </span>
                          <span>{queuedSourceSuffix}</span>
                        </div>
                      ) : (
                        <div className="line-clamp-3 whitespace-pre-wrap break-words text-[12px] leading-5 text-slate-700">
                          {item.content}
                        </div>
                      )}
                    </div>
                    {onRemoveQueuedMessage ? (
                      <button
                        type="button"
                        onClick={() => onRemoveQueuedMessage(item.id)}
                        disabled={interruptLoading}
                        className="shrink-0 text-[12px] font-medium text-slate-400 transition-colors enabled:hover:cursor-pointer enabled:hover:text-[#f97316] disabled:cursor-not-allowed disabled:text-slate-300"
                      >
                        {removeQueuedMessageLabel}
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      ) : null}

      {pendingFiles.length > 0 ? (
        <div className="mb-3 flex flex-wrap gap-2">
          {pendingFiles.map((file) => (
            <div key={file.key} className="relative h-14 w-14">
              <div className="h-full w-full overflow-hidden rounded-md border border-[#d8e2f2]">
                {file.previewUrl ? (
                  <RevealableImage
                    src={file.previewUrl}
                    alt={file.name}
                    filePath={file.sourcePath}
                    className="h-full w-full"
                    imageClassName="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center bg-[#f3f6fb] text-slate-500">
                    <FileTextOutlined className="text-sm" />
                    <span className="max-w-[48px] truncate text-[10px] leading-none">
                      {(file.extension || "file")
                        .replace(".", "")
                        .toUpperCase()}
                    </span>
                  </div>
                )}
              </div>
              {onRemovePendingFile ? (
                <button
                  type="button"
                  onClick={() => onRemovePendingFile(file.key)}
                  className="absolute -right-2 -top-2 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-slate-900/78 pb-[1px] text-[13px] font-semibold leading-none text-white shadow-sm transition-colors hover:cursor-pointer hover:bg-slate-900"
                  aria-label={removeFileLabel?.(file.name)}
                >
                  ×
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {showInputShortcutTip && onDismissInputShortcutTip ? (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-[#dbe5f5] bg-[#f7faff] px-3 py-2 text-[12px] text-slate-600">
          <span>{chatInputShortcutHint}</span>
          <Button
            type="link"
            size="small"
            onClick={onDismissInputShortcutTip}
            className="!h-auto !p-0 !text-[12px] !text-slate-500 hover:!text-slate-700"
          >
            {dismissShortcutTipLabel}
          </Button>
        </div>
      ) : null}

      <div ref={inputContainerRef} className="min-h-[84px]">
        <Input.TextArea
          autoSize={{ minRows: 2, maxRows: 6 }}
          value={input}
          onChange={(event) => onInputChange(event.target.value)}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={(event) => {
            onCompositionEnd(event.currentTarget.value);
          }}
          onKeyDown={onInputKeyDown}
          className="!border-0 !bg-transparent !px-0 !py-0 !shadow-none"
          placeholder={placeholder}
        />
      </div>

      <div className="mt-3 flex items-center justify-between pt-2">
        <div className="flex items-center gap-2">
          {showFilePicker ? (
            <button
              type="button"
              onClick={() => fileInputRef?.current?.click()}
              className="inline-flex items-center justify-center text-[15px] leading-none text-slate-400 hover:cursor-pointer hover:text-slate-600"
              aria-label={addFileLabel}
            >
              <PlusOutlined />
            </button>
          ) : null}
          {showModelSelector ? (
            <CompactSelect
              key="chat-model-select"
              value={selectedModel}
              onChange={(value: string) => onModelChange?.(value)}
              options={modelOptions}
              popupMinWidth={200}
              disabled={disableModelSelector}
            />
          ) : null}
          <CompactSelect
            key="chat-thinking-level-select"
            value={selectedThinkingLevel}
            onChange={(value: string) =>
              onThinkingLevelChange(value as ChatThinkingLevel)
            }
            options={thinkingLevelOptions}
            menuHeader={thinkingLevelMenuHeader}
            popupMinWidth={132}
          />
        </div>
        <Tooltip title={chatInputShortcutHint} placement="left">
          <span className="inline-flex">
            {canInterrupt ? (
              <Button
                type="primary"
                shape="circle"
                icon={<StopSquareIcon />}
                loading={interruptLoading}
                onClick={onInterrupt}
                className="!inline-flex !h-8 !w-8 !min-w-8 !items-center !justify-center !border-[#f97316] !bg-[#f97316] !p-0 !text-[13px] !text-white transition-all duration-200 enabled:hover:!cursor-pointer enabled:hover:!border-[#ea580c] enabled:hover:!bg-[#ea580c] enabled:hover:!shadow-[0_0_0_4px_rgba(249,115,22,0.18)] motion-safe:animate-pulse disabled:!cursor-not-allowed"
              />
            ) : (
              <Button
                type="primary"
                shape="circle"
                icon={<ArrowUpOutlined />}
                loading={sendLoading}
                onClick={onSend}
                disabled={!canSend}
                className="!inline-flex !h-8 !w-8 !min-w-8 !items-center !justify-center !p-0 !text-[14px] transition-all duration-200 enabled:hover:!cursor-pointer enabled:hover:!shadow-[0_0_0_4px_rgba(37,99,235,0.15)] enabled:hover:!scale-[1.04] enabled:active:!scale-[0.96] disabled:!cursor-not-allowed"
              />
            )}
          </span>
        </Tooltip>
      </div>

      {showFilePicker ? (
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={fileAccept}
          className="hidden"
          onChange={onSelectFiles}
        />
      ) : null}
    </div>
  );
};

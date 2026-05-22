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
import type { TextAreaRef } from "antd/es/input/TextArea";
import type {
  ChangeEvent,
  ClipboardEvent,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
  RefObject,
  SyntheticEvent,
} from "react";

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
  mode?: "default" | "controls-only";
  readOnlyNotice?: ReactNode;
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
  inputTextAreaRef?: RefObject<TextAreaRef | null>;
  inputOverlay?: ReactNode;
  input: string;
  isComposing: boolean;
  onInputChange: (
    value: string,
    event?: ChangeEvent<HTMLTextAreaElement>,
  ) => void;
  onCompositionStart: () => void;
  onCompositionEnd: (value: string) => void;
  onInputKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onInputKeyUp?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onInputClick?: (event: MouseEvent<HTMLTextAreaElement>) => void;
  onInputSelect?: (event: SyntheticEvent<HTMLTextAreaElement>) => void;
  onInputPaste?: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
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
  showThinkingLevel?: boolean;
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
  mode = "default",
  readOnlyNotice,
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
  inputTextAreaRef,
  inputOverlay,
  input,
  isComposing,
  onInputChange,
  onCompositionStart,
  onCompositionEnd,
  onInputKeyDown,
  onInputKeyUp,
  onInputClick,
  onInputSelect,
  onInputPaste,
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
  showThinkingLevel = true,
  thinkingLevelOptions = [],
  thinkingLevelMenuHeader,
  canInterrupt,
  interruptLoading,
  onInterrupt,
  sendLoading,
  onSend,
  canSend,
}: ChatComposerProps) => {
  const controlsOnly = mode === "controls-only";
  const showFilePicker = Boolean(fileInputRef && onSelectFiles && fileAccept);
  const showModelSelector =
    modelOptions.length > 0 || Boolean(selectedModel?.trim());
  const disableModelSelector =
    modelOptions.length <= 1 || !onModelChange;
  const containerClassName =
    variant === "embedded"
      ? "no-drag rounded-[24px] border border-[var(--stroke)] bg-[rgba(var(--surface-rgb),0.92)] px-4 py-4"
      : "no-drag rounded-xl border border-[var(--stroke)] bg-[rgba(var(--surface-rgb),0.92)] px-3 py-3 shadow-[var(--shadow-panel)]";

  return (
    <div className={containerClassName}>
      {!controlsOnly && queuedMessages.length > 0 ? (
        <div className="mb-3 rounded-lg border border-[var(--stroke)] bg-[var(--surface-2)]">
          <div className="border-b border-[var(--stroke)] px-3 py-2 text-[12px] font-medium text-[var(--text-soft)]">
            {queuedMessagesLabel}
          </div>
          <ScrollArea className="max-h-28 px-3 py-2">
            <div className="space-y-2 pr-2">
              {queuedMessages.map((item) => (
                <div
                  key={item.id}
                  className="rounded-md border border-[var(--stroke)] bg-[var(--surface)] px-2.5 py-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      {item.sourceName ? (
                        <div className="flex items-center gap-1 text-[12px] text-[var(--text-soft)]">
                          <span>{queuedSourcePrefix}</span>
                          <span className="inline-flex rounded-full border border-[var(--stroke)] bg-[var(--surface-2)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-soft)]">
                            {item.sourceName}
                          </span>
                          <span>{queuedSourceSuffix}</span>
                        </div>
                      ) : (
                        <div className="line-clamp-3 whitespace-pre-wrap break-words text-[12px] leading-5 text-[var(--text-soft)]">
                          {item.content}
                        </div>
                      )}
                    </div>
                    {onRemoveQueuedMessage ? (
                      <button
                        type="button"
                        onClick={() => onRemoveQueuedMessage(item.id)}
                        disabled={interruptLoading}
                        className="shrink-0 text-[12px] font-medium text-[var(--muted)] transition-colors enabled:hover:cursor-pointer enabled:hover:text-[#f97316] disabled:cursor-not-allowed disabled:opacity-50"
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

      {!controlsOnly && pendingFiles.length > 0 ? (
        <div className="mb-3 flex flex-wrap gap-2">
          {pendingFiles.map((file) => (
            <div key={file.key} className="relative h-14 w-14">
              <div className="h-full w-full overflow-hidden rounded-md border border-[var(--stroke)]">
                {file.previewUrl ? (
                  <RevealableImage
                    src={file.previewUrl}
                    alt={file.name}
                    filePath={file.sourcePath}
                    className="h-full w-full"
                    imageClassName="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center bg-[var(--surface-3)] text-[var(--muted)]">
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

      {!controlsOnly && showInputShortcutTip && onDismissInputShortcutTip ? (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-[var(--stroke)] bg-[var(--surface-2)] px-3 py-2 text-[12px] text-[var(--text-soft)]">
          <span>{chatInputShortcutHint}</span>
          <Button
            type="link"
            size="small"
            onClick={onDismissInputShortcutTip}
            className="!h-auto !p-0 !text-[12px] !text-[var(--muted)] hover:!text-[var(--text)]"
          >
            {dismissShortcutTipLabel}
          </Button>
        </div>
      ) : null}

      {controlsOnly ? (
        readOnlyNotice ? (
          <div className="rounded-lg border border-[var(--stroke)] bg-[var(--surface-2)] px-3 py-2 text-[12px] text-[var(--text-soft)]">
            {readOnlyNotice}
          </div>
        ) : null
      ) : (
        <div ref={inputContainerRef} className="relative min-h-[84px]">
          {inputOverlay}
          <Input.TextArea
            ref={inputTextAreaRef}
            autoSize={{ minRows: 2, maxRows: 6 }}
            value={input}
            onChange={(event) => onInputChange(event.target.value, event)}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={(event) => {
              onCompositionEnd(event.currentTarget.value);
            }}
            onKeyDown={onInputKeyDown}
            onKeyUp={onInputKeyUp}
            onClick={onInputClick}
            onSelect={onInputSelect}
            onPaste={onInputPaste}
            className="!border-0 !bg-transparent !px-0 !py-0 !shadow-none"
            placeholder={placeholder}
          />
        </div>
      )}

      <div
        className={
          controlsOnly
            ? "flex items-center justify-between"
            : "mt-3 flex items-center justify-between pt-2"
        }
      >
        <div className="flex items-center gap-2">
          {!controlsOnly && showFilePicker ? (
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
              className={controlsOnly ? "min-w-[220px] justify-center" : ""}
              labelClassName={controlsOnly ? "text-center" : ""}
              popupMinWidth={200}
              disabled={disableModelSelector}
            />
          ) : null}
          {showThinkingLevel ? (
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
          ) : null}
        </div>
        {!controlsOnly ? (
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
        ) : null}
      </div>

      {!controlsOnly && showFilePicker ? (
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

import {
  ArrowUpOutlined,
  FileTextOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import {
  CompactSelect,
  type CompactSelectOption,
} from "@renderer/components/CompactSelect";
import { RevealableImage } from "@renderer/components/RevealableImage";
import { ScrollArea } from "@renderer/components/ScrollArea";
import type { ChatThinkingLevel } from "@shared/types";
import { Button, Tooltip } from "antd";
import type {
  ClipboardEvent,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
} from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createEditor,
  Editor,
  Element as SlateElement,
  Node as SlateNode,
  Range,
  Transforms,
  type BaseEditor,
  type Descendant,
} from "slate";
import { withHistory, type HistoryEditor } from "slate-history";
import {
  Editable,
  ReactEditor,
  Slate,
  withReact,
  type RenderElementProps,
} from "slate-react";

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

export interface ChatMentionOption {
  key: string;
  label: string;
  insertText: string;
  replacementText?: string;
  searchText?: string;
  description?: string;
}

export interface ChatComposerEditorHelpers {
  insertBreak: () => void;
  focus: () => void;
}

type ChatComposerText = { text: string };
type ChatMentionElement = {
  type: "mention";
  label: string;
  insertText: string;
  replacementText?: string;
  children: ChatComposerText[];
};
type ChatParagraphElement = {
  type: "paragraph";
  children: Array<ChatComposerText | ChatMentionElement>;
};
type ChatComposerElement = ChatMentionElement | ChatParagraphElement;
type ChatComposerEditor = BaseEditor & ReactEditor & HistoryEditor;
type MentionTarget = { range: Range; query: string };
type MentionPopupPosition = { left: number; top: number };

declare module "slate" {
  interface CustomTypes {
    Editor: ChatComposerEditor;
    Element: ChatComposerElement;
    Text: ChatComposerText;
  }
}

const MENTION_POPUP_WIDTH = 320;

const createEmptyEditorValue = (): Descendant[] => [
  {
    type: "paragraph",
    children: [{ text: "" }],
  },
];

const deserializeEditorValue = (input: string): Descendant[] => {
  if (!input) return createEmptyEditorValue();
  return input.split("\n").map((line) => ({
    type: "paragraph",
    children: [{ text: line }],
  }));
};

const serializeEditorNode = (node: SlateNode): string => {
  if ("text" in node) return node.text;
  if (SlateElement.isElement(node) && node.type === "mention") {
    return node.replacementText ?? node.insertText;
  }
  return node.children.map((child) => serializeEditorNode(child)).join("");
};

const serializeEditorValue = (value: Descendant[]): string =>
  value.map((node) => serializeEditorNode(node)).join("\n");

const withMentions = (editor: ChatComposerEditor): ChatComposerEditor => {
  const { isInline, isVoid } = editor;
  editor.isInline = (element) =>
    element.type === "mention" ? true : isInline(element);
  editor.isVoid = (element) =>
    element.type === "mention" ? true : isVoid(element);
  return editor;
};

const createComposerEditor = (): ChatComposerEditor =>
  withMentions(withHistory(withReact(createEditor())));

const getMentionTarget = (editor: ChatComposerEditor): MentionTarget | null => {
  const { selection } = editor;
  if (!selection || !Range.isCollapsed(selection)) return null;

  const blockEntry = Editor.above(editor, {
    match: (node) => SlateElement.isElement(node) && node.type === "paragraph",
  });
  if (!blockEntry) return null;

  const [, blockPath] = blockEntry;
  const blockStart = Editor.start(editor, blockPath);
  const beforeRange = Editor.range(editor, blockStart, selection.anchor);
  const beforeText = Editor.string(editor, beforeRange);
  const match = beforeText.match(/(?:^|\s)@([^\s@]*)$/u);
  if (!match) return null;

  const query = match[1] ?? "";
  const mentionStartOffset = beforeText.length - query.length - 1;
  const mentionStart =
    mentionStartOffset === 0
      ? blockStart
      : Editor.after(editor, blockStart, {
          distance: mentionStartOffset,
          unit: "character",
        });
  if (!mentionStart) return null;

  return {
    range: Editor.range(editor, mentionStart, selection.anchor),
    query,
  };
};

const StopSquareIcon = (): ReactNode => (
  <span className="inline-flex h-[12px] w-[12px] items-center justify-center">
    <span className="inline-block h-[9px] w-[9px] rounded-[1px] bg-current" />
  </span>
);

const MentionElement = ({
  attributes,
  children,
  element,
}: RenderElementProps & { element: ChatMentionElement }) => (
  <span
    {...attributes}
    contentEditable={false}
    className="chat-composer-mention-token"
    data-chat-mention-token="true"
  >
    {element.label}
    {children}
  </span>
);

const ParagraphElement = ({
  attributes,
  children,
}: RenderElementProps) => (
  <div {...attributes} className="chat-composer-paragraph">
    {children}
  </div>
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
  inputContainerRef: React.RefObject<HTMLDivElement | null>;
  input: string;
  onInputChange: (value: string) => void;
  onCompositionStart?: () => void;
  onCompositionEnd?: () => void;
  onEditorKeyDown?: (
    event: KeyboardEvent<HTMLDivElement>,
    helpers: ChatComposerEditorHelpers,
  ) => void;
  onInputPaste?: (event: ClipboardEvent<HTMLDivElement>) => void;
  mentionOptions?: ChatMentionOption[];
  mentionAriaLabel?: string;
  placeholder: string;
  fileInputRef?: React.RefObject<HTMLInputElement | null>;
  onSelectFiles?: (event: React.ChangeEvent<HTMLInputElement>) => void;
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
  input,
  onInputChange,
  onCompositionStart,
  onCompositionEnd,
  onEditorKeyDown,
  onInputPaste,
  mentionOptions = [],
  mentionAriaLabel = "",
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
  const disableModelSelector = modelOptions.length <= 1 || !onModelChange;
  const containerClassName =
    variant === "embedded"
      ? "no-drag rounded-[24px] bg-[var(--surface)] px-4 py-4 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_24%,var(--stroke)),0_8px_18px_rgba(15,23,42,0.04)]"
      : "no-drag rounded-xl bg-[var(--surface)] px-3 py-3 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_24%,var(--stroke)),0_8px_18px_rgba(15,23,42,0.04)]";
  const lastEmittedValueRef = useRef(input);
  const [editorVersion, setEditorVersion] = useState(0);
  const editor = useMemo(() => createComposerEditor(), [editorVersion]);
  const initialValue = useMemo(
    () => deserializeEditorValue(input),
    [editorVersion],
  );
  const [mentionTarget, setMentionTarget] = useState<MentionTarget | null>(
    null,
  );
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const [mentionPopupPosition, setMentionPopupPosition] =
    useState<MentionPopupPosition | null>(null);
  const mentionOptionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (input === lastEmittedValueRef.current) return;
    lastEmittedValueRef.current = input;
    setMentionTarget(null);
    setMentionPopupPosition(null);
    setEditorVersion((version) => version + 1);
  }, [input]);

  const filteredMentionOptions = useMemo(() => {
    if (!mentionTarget) return [];
    const query = mentionTarget.query.trim().toLowerCase();
    return mentionOptions
      .filter((option) =>
        (option.searchText ?? option.label).toLowerCase().includes(query),
      )
      .slice(0, 8);
  }, [mentionOptions, mentionTarget]);
  const mentionSuggestionsOpen = filteredMentionOptions.length > 0;

  useEffect(() => {
    setActiveMentionIndex(0);
  }, [mentionTarget?.query, mentionOptions]);

  useLayoutEffect(() => {
    if (!mentionSuggestionsOpen) return;
    mentionOptionRefs.current[activeMentionIndex]?.scrollIntoView({
      block: "nearest",
    });
  }, [activeMentionIndex, mentionSuggestionsOpen]);

  useLayoutEffect(() => {
    if (!mentionSuggestionsOpen || !mentionTarget) {
      setMentionPopupPosition(null);
      return;
    }

    const container = inputContainerRef.current;
    if (!container) return;

    try {
      const domRange = ReactEditor.toDOMRange(editor, mentionTarget.range);
      const targetRect = domRange.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const popupWidth = Math.min(MENTION_POPUP_WIDTH, container.clientWidth);
      const maxLeft = Math.max(0, container.clientWidth - popupWidth);
      setMentionPopupPosition({
        left: Math.min(
          Math.max(0, targetRect.left - containerRect.left),
          maxLeft,
        ),
        top: targetRect.top - containerRect.top,
      });
    } catch {
      setMentionPopupPosition(null);
    }
  }, [
    editor,
    inputContainerRef,
    mentionSuggestionsOpen,
    mentionTarget,
  ]);

  const refreshMentionTarget = useCallback(() => {
    setMentionTarget(getMentionTarget(editor));
  }, [editor]);

  const focusEditor = useCallback((): void => {
    ReactEditor.focus(editor);
    if (editor.selection) return;
    Transforms.select(editor, Editor.end(editor, []));
  }, [editor]);

  const selectMention = useCallback(
    (option: ChatMentionOption): void => {
      if (!mentionTarget) return;
      Transforms.select(editor, mentionTarget.range);
      Transforms.insertNodes(editor, [
        {
          type: "mention",
          label: option.label,
          insertText: option.insertText,
          replacementText: option.replacementText,
          children: [{ text: "" }],
        },
        { text: " " },
      ]);
      setMentionTarget(null);
      setMentionPopupPosition(null);
      requestAnimationFrame(() => {
        ReactEditor.focus(editor);
      });
    },
    [editor, mentionTarget],
  );

  const helpers = useMemo<ChatComposerEditorHelpers>(
    () => ({
      insertBreak: () => editor.insertBreak(),
      focus: focusEditor,
    }),
    [editor, focusEditor],
  );

  const renderElement = useCallback((props: RenderElementProps) => {
    if (props.element.type === "mention") {
      return (
        <MentionElement
          {...props}
          element={props.element as ChatMentionElement}
        />
      );
    }
    return <ParagraphElement {...props} />;
  }, []);

  const handleSlateChange = (nextValue: Descendant[]): void => {
    const nextSerializedValue = serializeEditorValue(nextValue);
    if (nextSerializedValue !== lastEmittedValueRef.current) {
      lastEmittedValueRef.current = nextSerializedValue;
      onInputChange(nextSerializedValue);
    }
    refreshMentionTarget();
  };

  const handleEditableKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
  ): void => {
    if (mentionSuggestionsOpen) {
      const isNextMentionKey =
        event.key === "ArrowDown" ||
        (event.ctrlKey && event.key.toLowerCase() === "n");
      const isPreviousMentionKey =
        event.key === "ArrowUp" ||
        (event.ctrlKey && event.key.toLowerCase() === "p");
      if (isNextMentionKey) {
        event.preventDefault();
        setActiveMentionIndex(
          (index) => (index + 1) % filteredMentionOptions.length,
        );
        return;
      }
      if (isPreviousMentionKey) {
        event.preventDefault();
        setActiveMentionIndex(
          (index) =>
            (index - 1 + filteredMentionOptions.length) %
            filteredMentionOptions.length,
        );
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        const selectedOption =
          filteredMentionOptions[
            Math.min(activeMentionIndex, filteredMentionOptions.length - 1)
          ];
        selectMention(selectedOption);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMentionTarget(null);
        return;
      }
    }

    onEditorKeyDown?.(event, helpers);
  };

  const handleComposerMouseDown = (
    event: MouseEvent<HTMLDivElement>,
  ): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (
      target.closest(
        'button,a,input,textarea,select,[contenteditable="true"],[role="button"],[data-chat-composer-editor="true"],.simplebar-track,.simplebar-scrollbar',
      )
    ) {
      return;
    }
    event.preventDefault();
    focusEditor();
  };

  return (
    <div
      className={containerClassName}
      onMouseDown={controlsOnly ? undefined : handleComposerMouseDown}
    >
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
          <Slate
            key={editorVersion}
            editor={editor}
            initialValue={initialValue}
            onChange={handleSlateChange}
            onSelectionChange={refreshMentionTarget}
          >
            <ScrollArea className="chat-composer-input-scroll pr-2">
              <Editable
                data-chat-composer-editor="true"
                renderElement={renderElement}
                placeholder={placeholder}
                className="chat-composer-editor min-h-[84px] outline-none"
                onCompositionStart={onCompositionStart}
                onCompositionEnd={onCompositionEnd}
                onKeyDown={handleEditableKeyDown}
                onPaste={onInputPaste}
              />
            </ScrollArea>
          </Slate>
          {mentionSuggestionsOpen && mentionPopupPosition ? (
            <div
              className="absolute z-50 overflow-hidden rounded-lg border border-[var(--stroke)] bg-[var(--surface)] shadow-[var(--shadow-panel)]"
              style={{
                left: mentionPopupPosition.left,
                top: mentionPopupPosition.top,
                width: `min(${MENTION_POPUP_WIDTH}px, 100%)`,
                transform: "translateY(calc(-100% - 8px))",
              }}
              role="listbox"
              aria-label={mentionAriaLabel}
            >
              <ScrollArea className="max-h-52 py-1">
                <div className="space-y-0.5 px-1">
                  {filteredMentionOptions.map((option, index) => (
                    <button
                      key={option.key}
                      ref={(element) => {
                        mentionOptionRefs.current[index] = element;
                      }}
                      type="button"
                      role="option"
                      aria-selected={index === activeMentionIndex}
                      className={`flex w-full min-w-0 flex-col rounded-md px-2.5 py-2 text-left text-sm ${
                        index === activeMentionIndex
                          ? "bg-[rgba(var(--primary-rgb),0.12)] text-[var(--primary)]"
                          : "text-[var(--text)] hover:bg-[var(--surface-2)]"
                      }`}
                      onMouseEnter={() => setActiveMentionIndex(index)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => selectMention(option)}
                    >
                      <span className="max-w-full truncate font-medium">
                        {option.label}
                      </span>
                      {option.description ? (
                        <span className="max-w-full truncate text-xs font-normal text-[var(--muted)]">
                          {option.description}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              </ScrollArea>
            </div>
          ) : null}
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

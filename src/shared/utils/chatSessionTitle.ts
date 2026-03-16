const CHAT_SESSION_TITLE_MAX_LENGTH = 30;

export const normalizeChatSessionTitleCandidate = (value: string): string => {
  const compact = value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/[#>*_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return compact
    .replace(/["""''「」『』【】]/g, "")
    .replace(/[.,!?;:，。！？；：]+$/g, "")
    .trim();
};

export const deriveOptimisticChatSessionTitle = (
  value: string,
  maxLength = CHAT_SESSION_TITLE_MAX_LENGTH,
): string =>
  normalizeChatSessionTitleCandidate(value).slice(0, maxLength).trim();

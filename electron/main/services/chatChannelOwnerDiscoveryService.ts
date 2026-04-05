import type { ChatChannelOwnerCandidateDTO } from "@shared/types";

type ChatChannelProvider = "telegram" | "discord" | "feishu";

interface OwnerCandidateRecord {
  userId: string;
  displayName?: string;
}

const MAX_OWNER_CANDIDATES = 8;

const ownerCandidatesByProvider: Record<
  ChatChannelProvider,
  Map<string, OwnerCandidateRecord>
> = {
  telegram: new Map(),
  discord: new Map(),
  feishu: new Map(),
};

const normalizeValue = (value: string | undefined): string => value?.trim() ?? "";

export const chatChannelOwnerDiscoveryService = {
  record(input: {
    provider: ChatChannelProvider;
    userId: string;
    displayName?: string;
  }): void {
    const userId = normalizeValue(input.userId);
    if (!userId) return;

    const displayName = normalizeValue(input.displayName) || undefined;
    const bucket = ownerCandidatesByProvider[input.provider];
    const existing = bucket.get(userId);

    if (existing) {
      bucket.delete(userId);
    }

    bucket.set(userId, {
      userId,
      displayName: displayName ?? existing?.displayName,
    });

    while (bucket.size > MAX_OWNER_CANDIDATES) {
      const oldestUserId = bucket.keys().next().value;
      if (!oldestUserId) break;
      bucket.delete(oldestUserId);
    }
  },

  list(provider: ChatChannelProvider): ChatChannelOwnerCandidateDTO[] {
    return Array.from(ownerCandidatesByProvider[provider].values())
      .reverse()
      .map((item) => ({
        userId: item.userId,
        ...(item.displayName ? { displayName: item.displayName } : {}),
      }));
  },
};

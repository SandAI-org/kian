import { describe, expect, it } from "vitest";

import {
  deriveOptimisticChatSessionTitle,
  normalizeChatSessionTitleCandidate,
} from "../../src/shared/utils/chatSessionTitle";

describe("chatSessionTitle", () => {
  it("normalizes markdown noise in title candidates", () => {
    expect(
      normalizeChatSessionTitleCandidate(
        '```ts\nconst a = 1;\n```\n帮我整理这个发布计划。 [link](https://example.com)',
      ),
    ).toBe("帮我整理这个发布计划");
  });

  it("derives an optimistic title from the first message", () => {
    expect(
      deriveOptimisticChatSessionTitle("帮我整理一下这次迭代要做的任务"),
    ).toBe("帮我整理一下这次迭代要做的任务");
  });
});

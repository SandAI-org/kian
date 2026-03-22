export const shouldRetainCompletedStreamingBlocks = (input: {
  previousSessionId?: string;
  currentSessionId?: string;
  previousActiveRequestId?: string;
  activeRequestId?: string;
  previousStreamingBlockCount: number;
}): boolean =>
  input.previousSessionId === input.currentSessionId &&
  Boolean(input.activeRequestId) &&
  input.previousActiveRequestId !== input.activeRequestId &&
  input.previousStreamingBlockCount > 0;

import { EventEmitter } from 'node:events';
import type {
  ChatHistoryUpdatedEvent,
  ChatQueueUpdatedEvent,
  ChatStreamEvent,
} from '@shared/types';

const emitter = new EventEmitter();

const HISTORY_UPDATED_EVENT = 'history-updated';
const QUEUE_UPDATED_EVENT = 'queue-updated';
const STREAM_EVENT = 'stream';

export const chatEvents = {
  emitHistoryUpdated(event: ChatHistoryUpdatedEvent): void {
    emitter.emit(HISTORY_UPDATED_EVENT, event);
  },
  onHistoryUpdated(listener: (event: ChatHistoryUpdatedEvent) => void): () => void {
    emitter.on(HISTORY_UPDATED_EVENT, listener);
    return () => emitter.off(HISTORY_UPDATED_EVENT, listener);
  },
  emitQueueUpdated(event: ChatQueueUpdatedEvent): void {
    emitter.emit(QUEUE_UPDATED_EVENT, event);
  },
  onQueueUpdated(listener: (event: ChatQueueUpdatedEvent) => void): () => void {
    emitter.on(QUEUE_UPDATED_EVENT, listener);
    return () => emitter.off(QUEUE_UPDATED_EVENT, listener);
  },
  emitStream(event: ChatStreamEvent): void {
    emitter.emit(STREAM_EVENT, event);
  },
  onStream(listener: (event: ChatStreamEvent) => void): () => void {
    emitter.on(STREAM_EVENT, listener);
    return () => emitter.off(STREAM_EVENT, listener);
  }
};

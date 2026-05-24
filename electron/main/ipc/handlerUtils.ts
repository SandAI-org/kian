import { ipcMain } from 'electron';
import { ZodSchema } from 'zod';
import { err, ok } from '@shared/utils/result';
import type { Result } from '@shared/types';
import { logger } from '../services/logger';

export const handle = <TInput, TOutput>(
  channel: string,
  schema: ZodSchema<TInput> | null,
  fn: (input: TInput) => Promise<TOutput>
): void => {
  ipcMain.handle(channel, async (_event, payload): Promise<Result<TOutput>> => {
    try {
      const parsed = schema ? schema.parse(payload) : (payload as TInput);
      const data = await fn(parsed);
      return ok(data);
    } catch (error) {
      logger.error(`IPC failed: ${channel}`, error);
      if (error instanceof Error && error.name === 'ZodError') {
        return err('VALIDATION_ERROR', '输入校验失败，请检查填写内容', error.message);
      }
      return err('UNKNOWN_ERROR', error instanceof Error ? error.message : 'unknown error');
    }
  });
};

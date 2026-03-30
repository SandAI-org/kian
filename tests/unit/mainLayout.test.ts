import { describe, expect, it } from 'vitest';
import { shouldKeepHeaderActions } from '../../src/renderer/app/MainLayout';

describe('shouldKeepHeaderActions', () => {
  it('keeps header actions on the skills page', () => {
    expect(shouldKeepHeaderActions('/skills')).toBe(true);
    expect(shouldKeepHeaderActions('/skills/repository')).toBe(true);
  });

  it('clears header actions on pages without a header action slot', () => {
    expect(shouldKeepHeaderActions('/tasks')).toBe(false);
    expect(shouldKeepHeaderActions('/cronjobs')).toBe(false);
  });
});

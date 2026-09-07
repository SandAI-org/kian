import assert from 'node:assert/strict';
import test from 'node:test';
import { disableCardAction } from '../src/card-actions.mjs';

const card = {
  config: { wide_screen_mode: true },
  elements: [
    { tag: 'markdown', content: 'PR updates' },
    {
      tag: 'action',
      actions: [
        {
          tag: 'button',
          type: 'primary',
          text: { tag: 'plain_text', content: '更新 PR #576 描述' },
          value: { action: 'up', pr: 576, repo: 'owner/repo' },
        },
        {
          tag: 'button',
          text: { tag: 'plain_text', content: '更新 PR #576 完整版' },
          value: { action: 'up', pr: 576, repo: 'owner/repo', mode: 'full' },
        },
      ],
    },
  ],
};

test('disables only the completed card action', () => {
  const result = disableCardAction(card, {
    command: 'up576',
    repo: 'owner/repo',
    mode: 'default',
  });

  assert.equal(result.changed, true);
  const [completed, other] = result.card.elements[1].actions;
  assert.equal(completed.disabled, true);
  assert.equal(completed.type, 'default');
  assert.equal(other.disabled, undefined);
  assert.equal(card.elements[1].actions[0].disabled, undefined);
});

test('matches the selected mode independently', () => {
  const result = disableCardAction(card, {
    command: 'up576',
    repo: 'owner/repo',
    mode: 'full',
  });

  const [other, completed] = result.card.elements[1].actions;
  assert.equal(other.disabled, undefined);
  assert.equal(completed.disabled, true);
});

test('leaves the card unchanged when no action matches', () => {
  const result = disableCardAction(card, {
    command: 'up577',
    repo: 'owner/repo',
    mode: 'default',
  });

  assert.equal(result.changed, false);
  assert.deepEqual(result.card, card);
});

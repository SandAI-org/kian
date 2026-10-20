import assert from 'node:assert/strict';
import test from 'node:test';
import {
  disableCardAction,
  disablePublicPinAction,
  disableReminderAction,
} from '../src/card-actions.mjs';

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

test('matches a button value returned as serialized JSON', () => {
  const serializedCard = structuredClone(card);
  serializedCard.elements[1].actions[0].value = JSON.stringify(
    serializedCard.elements[1].actions[0].value,
  );

  const result = disableCardAction(serializedCard, {
    command: 'up576',
    repo: 'owner/repo',
    mode: 'default',
  });

  assert.equal(result.changed, true);
  assert.equal(result.card.elements[1].actions[0].disabled, true);
});

test('falls back to button text when Feishu omits the action value', () => {
  const returnedCard = structuredClone(card);
  delete returnedCard.elements[1].actions[1].value;

  const result = disableCardAction(returnedCard, {
    command: 'up576',
    repo: 'owner/repo',
    mode: 'full',
  });

  assert.equal(result.changed, true);
  assert.equal(result.card.elements[1].actions[1].disabled, true);
});

test('uses the button label mode when Feishu omits mode from the value', () => {
  const returnedCard = structuredClone(card);
  delete returnedCard.elements[1].actions[1].value.mode;

  const result = disableCardAction(returnedCard, {
    command: 'up576',
    repo: 'owner/repo',
    mode: 'full',
  });

  assert.equal(result.changed, true);
  assert.equal(result.card.elements[1].actions[1].disabled, true);
});

test('matches repository names case-insensitively', () => {
  const result = disableCardAction(card, {
    command: 'up576',
    repo: 'Owner/Repo',
    mode: 'default',
  });

  assert.equal(result.changed, true);
  assert.equal(result.card.elements[1].actions[0].disabled, true);
});

test('uses a unique command and mode match when the returned repo differs', () => {
  const returnedCard = structuredClone(card);
  returnedCard.elements[1].actions[1].value.repo = 'unexpected/repo-format';

  const result = disableCardAction(returnedCard, {
    command: 'up576',
    repo: 'owner/repo',
    mode: 'full',
  });

  assert.equal(result.changed, true);
  assert.equal(result.card.elements[1].actions[1].disabled, true);
});

test('uses button text independently when the returned value is malformed', () => {
  const returnedCard = structuredClone(card);
  returnedCard.elements[1].actions[1].value = { unexpected: true };

  const result = disableCardAction(returnedCard, {
    command: 'up576',
    repo: 'owner/repo',
    mode: 'full',
  });

  assert.equal(result.changed, true);
  assert.equal(result.card.elements[1].actions[1].disabled, true);
});

test('normalizes legacy button rows returned as nested element arrays', () => {
  const returnedCard = structuredClone(card);
  returnedCard.elements[1] = returnedCard.elements[1].actions.map((button) => [button]);

  const result = disableCardAction(returnedCard, {
    command: 'up576',
    repo: 'owner/repo',
    mode: 'default',
  });

  assert.equal(result.changed, true);
  assert.equal(result.card.elements[1].tag, 'action');
  assert.equal(result.card.elements[1].actions[0].disabled, true);
  assert.equal(Array.isArray(result.card.elements[1]), false);
});

test('flattens nested action arrays before updating the card', () => {
  const returnedCard = structuredClone(card);
  returnedCard.elements[1].actions = returnedCard.elements[1].actions.map((button) => [button]);

  const result = disableCardAction(returnedCard, {
    command: 'up576',
    repo: 'owner/repo',
    mode: 'default',
  });

  assert.equal(result.changed, true);
  assert.equal(result.card.elements[1].actions[0].tag, 'button');
  assert.equal(result.card.elements[1].actions[0].disabled, true);
});

test('restores button text objects returned as strings before updating the card', () => {
  const returnedCard = structuredClone(card);
  returnedCard.elements[1].actions.forEach((button) => {
    button.text = button.text.content;
  });

  const result = disableCardAction(returnedCard, {
    command: 'up576',
    repo: 'owner/repo',
    mode: 'default',
  });

  assert.equal(result.changed, true);
  assert.deepEqual(result.card.elements[1].actions[0].text, {
    tag: 'plain_text',
    content: '更新 PR #576 描述',
  });
  assert.deepEqual(result.card.elements[1].actions[1].text, {
    tag: 'plain_text',
    content: '更新 PR #576 完整版',
  });
  assert.equal(result.card.elements[1].actions[0].disabled, true);
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

test('disables and relabels the acknowledged reminder button', () => {
  const reminderCard = {
    elements: [{
      tag: 'action',
      actions: [{
        tag: 'button',
        type: 'primary',
        text: { tag: 'plain_text', content: '已服用' },
        value: { action: 'ack_reminder', reminder_id: 'supplement', occurrence: '2026-10-20' },
      }],
    }],
  };
  const result = disableReminderAction(reminderCard, {
    reminderId: 'supplement',
    occurrence: '2026-10-20',
    completedText: '今日已服用 ✓',
  });
  assert.equal(result.changed, true);
  assert.equal(result.card.elements[0].actions[0].disabled, true);
  assert.equal(result.card.elements[0].actions[0].type, 'default');
  assert.equal(result.card.elements[0].actions[0].text.content, '今日已服用 ✓');
});

test('does not disable a reminder button from another occurrence', () => {
  const reminderCard = {
    elements: [[{
      tag: 'button',
      text: '已服用',
      value: JSON.stringify({ action: 'ack_reminder', reminder_id: 'supplement', occurrence: '2026-10-19' }),
    }]],
  };
  const result = disableReminderAction(reminderCard, {
    reminderId: 'supplement',
    occurrence: '2026-10-20',
    completedText: '今日已服用 ✓',
  });
  assert.equal(result.changed, false);
});

test('disables and relabels a public PR pin button', () => {
  const pinCard = {
    elements: [{
      tag: 'action',
      actions: [{
        tag: 'button',
        type: 'primary',
        text: { tag: 'plain_text', content: '📌 持续关注 #123' },
        value: { action: 'pin_public_pr', repo: 'PyTorch/PyTorch', pr: 123 },
      }],
    }],
  };
  const result = disablePublicPinAction(pinCard, { repo: 'pytorch/pytorch', number: 123, kind: 'pr' });
  assert.equal(result.changed, true);
  assert.equal(result.card.elements[0].actions[0].disabled, true);
  assert.equal(result.card.elements[0].actions[0].type, 'default');
  assert.equal(result.card.elements[0].actions[0].text.content, '已关注 #123 ✓');
  assert.equal(pinCard.elements[0].actions[0].disabled, undefined);
});

test('does not disable another public PR pin button', () => {
  const pinCard = {
    elements: [[{
      tag: 'button',
      text: '📌 持续关注 #124',
      value: JSON.stringify({ action: 'pin_public_pr', repo: 'pytorch/pytorch', pr: 124 }),
    }]],
  };
  const result = disablePublicPinAction(pinCard, { repo: 'pytorch/pytorch', number: 123, kind: 'pr' });
  assert.equal(result.changed, false);
});

test('disables and relabels a public Issue pin button', () => {
  const pinCard = {
    elements: [{
      tag: 'action',
      actions: [{
        tag: 'button',
        type: 'primary',
        text: { tag: 'plain_text', content: '📌 持续关注 #321' },
        value: {
          action: 'pin_public_item', repo: 'pytorch/pytorch', number: 321, kind: 'issue',
        },
      }],
    }],
  };
  const result = disablePublicPinAction(pinCard, {
    repo: 'PyTorch/PyTorch', number: 321, kind: 'issue',
  });
  assert.equal(result.changed, true);
  assert.equal(result.card.elements[0].actions[0].disabled, true);
  assert.equal(result.card.elements[0].actions[0].text.content, '已关注 #321 ✓');
});

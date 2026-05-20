/**
 * Regression coverage for #2560 — group @-mentions of the bot must set
 * `InboundMessage.isMention`. Before the fix, the inbound construction
 * site hard-coded `isMention: !isGroup ? true : undefined`, which dropped
 * every group mention on the floor and prevented the router from waking
 * the agent on a mention-only trigger.
 *
 * The detection logic lives in the exported pure helper `isBotMentionedInGroup`;
 * the inbound site calls it with `normalized`, `botPhoneJid`, `botLidUser`.
 * `isMention` is then computed as:
 *
 *   isMention: !isGroup ? true : botMentionedInGroup ? true : undefined
 *
 * Both the helper and the call-site ternary are covered below so a future
 * refactor that breaks either part fails this suite.
 */
import { describe, it, expect } from 'vitest';

import { computeIsMention, isBotMentionedInGroup } from './whatsapp.js';

const BOT_PHONE_JID = '15550009999@s.whatsapp.net';
const BOT_LID_USER = '987654321';

describe('isBotMentionedInGroup (#2560)', () => {
  it('detects the bot phone JID in extendedTextMessage.contextInfo.mentionedJid', () => {
    const normalized = {
      extendedTextMessage: {
        text: 'hey @15550009999 take a look',
        contextInfo: { mentionedJid: [BOT_PHONE_JID] },
      },
    };
    expect(isBotMentionedInGroup(normalized, BOT_PHONE_JID, BOT_LID_USER)).toBe(true);
  });

  it('returns false when the bot is not in mentionedJid', () => {
    const normalized = {
      extendedTextMessage: {
        text: 'hey @15551112222 take a look',
        contextInfo: { mentionedJid: ['15551112222@s.whatsapp.net'] },
      },
    };
    expect(isBotMentionedInGroup(normalized, BOT_PHONE_JID, BOT_LID_USER)).toBe(false);
  });

  it('detects an LID-only mention when no phone JID is in the list', () => {
    // Modern WhatsApp clients increasingly emit the LID even when the
    // human typed a phone-number mention; the phone JID may not appear.
    const normalized = {
      extendedTextMessage: {
        contextInfo: { mentionedJid: [`${BOT_LID_USER}@lid`] },
      },
    };
    expect(isBotMentionedInGroup(normalized, BOT_PHONE_JID, BOT_LID_USER)).toBe(true);
  });

  it('detects a mention in an image caption', () => {
    const normalized = {
      imageMessage: {
        caption: 'check this @15550009999',
        contextInfo: { mentionedJid: [BOT_PHONE_JID] },
      },
    };
    expect(isBotMentionedInGroup(normalized, BOT_PHONE_JID, BOT_LID_USER)).toBe(true);
  });

  it('returns false on an empty / missing mentionedJid array', () => {
    expect(isBotMentionedInGroup({}, BOT_PHONE_JID, BOT_LID_USER)).toBe(false);
    expect(
      isBotMentionedInGroup(
        { extendedTextMessage: { contextInfo: { mentionedJid: [] } } },
        BOT_PHONE_JID,
        BOT_LID_USER,
      ),
    ).toBe(false);
  });

  it('returns false when neither bot identifier is known', () => {
    const normalized = {
      extendedTextMessage: {
        contextInfo: { mentionedJid: [BOT_PHONE_JID, `${BOT_LID_USER}@lid`] },
      },
    };
    expect(isBotMentionedInGroup(normalized, undefined, undefined)).toBe(false);
  });
});

describe('InboundMessage.isMention semantics (#2560)', () => {
  it('is undefined for a group message with no bot mention', () => {
    expect(computeIsMention(true, false)).toBeUndefined();
  });

  it('is true for a group message where the bot is mentioned', () => {
    expect(computeIsMention(true, true)).toBe(true);
  });

  it('is true for a DM regardless of mention state', () => {
    // DMs are unconditionally mentions — the helper isn't consulted there.
    expect(computeIsMention(false, false)).toBe(true);
    expect(computeIsMention(false, true)).toBe(true);
  });
});

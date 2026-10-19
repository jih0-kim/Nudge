import type { Store, User } from './store.js';
import { splitPetImage } from './status.js';

export type ConversationMessage = {
  ts: string; text?: string; bot_id?: string;
  reactions?: { name: string; users?: string[] }[];
};

export function isQuestReply(text: string): boolean {
  return /^\s*(?:#{1,3}\s*)?\*{0,2}Quest\s*:/im.test(splitPetImage(text).text);
}

/** Only human changes cause work. Never feed our own Slack posts back to the coach. */
export function observeConversation(store: Store, user: User, messages: ConversationMessage[], botId: string) {
  const quest = messages.filter((m) => m.bot_id === botId && m.text && isQuestReply(m.text))
    .sort((a, b) => Number(b.ts) - Number(a.ts))[0];
  if (!quest) return false;
  store.trackQuest(user.id, quest.ts, quest.text!);
  const checked = quest.reactions?.some((r) => ['white_check_mark', 'heavy_check_mark', 'ballot_box_with_check'].includes(r.name)
    && r.users?.includes(user.slack_id));
  // A completion takes precedence when the owner has reacted both ✅ and ❌.
  if (checked) return store.completeQuest(user.id, quest.ts);
  const skipped = quest.reactions?.some((r) => ['x', 'no_entry', 'no_entry_sign', 'negative_squared_cross_mark'].includes(r.name)
    && r.users?.includes(user.slack_id));
  return skipped ? store.skipQuest(user.id, quest.ts) : false;
}

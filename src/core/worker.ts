import type { Store } from './store.js';
import type { MessageSender } from './messaging.js';
import { replyToUser } from './coach.js';
import { isQuestReply } from './conversation-loop.js';
import { splitPetImage } from './status.js';

export function createWorker(store: Store, sender: MessageSender, reply = replyToUser) {
  const activeUsers = new Set<number>();
  return async function tick() {
    // Different people must not wait behind another person's model call.
    // Keep each person's turns ordered and bound total provider concurrency.
    if (activeUsers.size >= 4) return;
    store.queueReminders();
    const job = store.claim(Date.now(), [...activeUsers]);
    if (!job) return;
    activeUsers.add(job.user_id);
    try {
      const startedAt = Date.now();
      const timing = (stage: string) => console.log('Slack job timing', JSON.stringify({ jobId: job.id, stage, elapsedMs: Date.now() - startedAt }));
      try {
        const user = store.getUser(job.user_id);
        const target = { workspaceId: user.team_id, channelId: user.channel_id };
        let response = job.reply;
        let messageId = job.message_id ?? undefined;
        if ((job.kind === 'message' || job.kind === 'quest_completion' || job.kind === 'quest_skip') && response === null && !messageId && sender.start) {
          try {
            messageId = await sender.start(target, job.id);
            store.saveMessageId(job.id, messageId);
            timing('progress-posted');
          } catch { /* A missing progress indicator must never prevent a reply. */ }
        }
        if (response === null) {
          try { response = await reply(store, user, job.text, undefined, { questCompleted: job.kind === 'quest_completion', questSkipped: job.kind === 'quest_skip' }); }
          catch (error) {
            // Do not replay model mutations on network delivery retries.
            response = 'My AI response failed just now—this is a server problem, not your message. Simple commands such as "help" still work. If you asked me to save or change something, check "memory", "reminders", or "progress" before retrying.';
            // Record diagnostic metadata only: provider messages/bodies can
            // include personal context, tool arguments, or credentials.
            const failure = error as { name?: string; statusCode?: number } | undefined;
            console.error('Coach request failed', JSON.stringify({ jobId: job.id, name: failure?.name, status: failure?.statusCode }));
          }
          store.saveReply(job.id, response);
          timing('reply-prepared');
        }
        await sender.send(target, response, job.id, messageId);
        if (messageId && isQuestReply(response)) store.trackQuest(user.id, messageId, splitPetImage(response).text);
        store.finish(job);
        timing('delivered');
      } catch {
        store.retry(job);
        console.error(`Slack delivery failed for job ${job.id}, attempt ${job.attempts}`);
      }
    } finally { activeUsers.delete(job.user_id); }
  };
}

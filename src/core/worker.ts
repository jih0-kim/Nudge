import type { Store } from './store.js';
import type { MessageSender } from './messaging.js';
import { replyToUser } from './coach.js';

export function createWorker(store: Store, sender: MessageSender, reply = replyToUser) {
  let busy = false;
  return async function tick() {
    if (busy) return;
    busy = true;
    try {
      store.queueReminders();
      const job = store.claim();
      if (!job) return;
      try {
        const user = store.getUser(job.user_id);
        let response = job.reply;
        if (response === null) {
          try { response = await reply(store, user, job.text); }
          catch {
            // Do not replay model mutations on network delivery retries.
            response = 'I couldn’t finish that request. Use "help" for the supported formats. If you asked for a change, check "memory", "reminders", or "progress" before trying again.';
            console.error(`Coach request failed for job ${job.id}`);
          }
          store.saveReply(job.id, response);
        }
        await sender.send({ workspaceId: user.team_id, channelId: user.channel_id }, response, job.id);
        store.finish(job);
      } catch {
        store.retry(job);
        console.error(`Slack delivery failed for job ${job.id}, attempt ${job.attempts}`);
      }
    } finally { busy = false; }
  };
}

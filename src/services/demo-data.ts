import type { Store } from '../core/store.js';
import { demoScenario } from '../demo/scenario.js';
import { arrivedDemoEmails } from './demo-simulation.js';

function context(store: Store, userId: number) {
  if (!store.demoDataEnabled(userId)) throw new Error('Demo data is off. Send "demo on" to use the fictional inbox and calendar.');
  return {
    source: 'fictional-demo' as const,
    date: demoScenario.date,
    time: demoScenario.time,
    timezone: demoScenario.timezone,
    persona: demoScenario.persona,
  };
}

/** Same fixtures as /demo, exposed read-only to the real, user-scoped coach. */
export function readDemoInbox(store: Store, userId: number) {
  return { ...context(store, userId), emails: [...arrivedDemoEmails(store, userId), ...demoScenario.emails] };
}

export function readDemoCalendar(store: Store, userId: number) {
  return { ...context(store, userId), events: demoScenario.events };
}

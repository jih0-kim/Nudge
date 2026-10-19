/** Role-prefixed log line, e.g. "[Watcher  ] ...". See .clinerules. */
export const log = (role: string, msg: string) => console.log(`[${role.padEnd(9)}] ${msg}`);

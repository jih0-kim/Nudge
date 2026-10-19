/** The habit worker does not depend on Slack credentials or any integration SDK. */
export interface MessageTarget {
  workspaceId: string;
  channelId: string;
}

export interface MessageSender {
  start?(target: MessageTarget, deliveryId: number): Promise<string>;
  send(target: MessageTarget, text: string, deliveryId: number, messageId?: string): Promise<void>;
}

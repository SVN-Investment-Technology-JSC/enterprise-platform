import amqp from 'amqplib';

/** Bounded, selective cleanup. Never purges a shared queue. */
export class TenantEventCleaner {
  constructor(
    private readonly url: string,
    private readonly managementUrl: string,
    private readonly queues: readonly string[] = [
      'maintenance.integrations.v1',
      'enterprise.events.dead',
    ],
  ) {
    if (!queues.length) throw new Error('BROKER_INSPECTION_FAILED');
  }

  async inspect(): Promise<void> {
    for (const queue of this.queues) await this.state(queue);
  }

  async purge(
    tenantId: string,
    assertOwnership: () => Promise<void>,
  ): Promise<boolean> {
    const connection = await amqp.connect(this.url);
    try {
      const channel = await connection.createConfirmChannel();
      for (const queue of this.queues) {
        await this.state(queue);
        const initial = await channel.checkQueue(queue);
        for (let index = 0; index < initial.messageCount; index++) {
          await assertOwnership();
          const message = await channel.get(queue, { noAck: false });
          if (!message) break;
          let payloadTenant: unknown;
          try {
            payloadTenant = JSON.parse(
              message.content.toString('utf8'),
            ).tenantId;
          } catch {
            /* preserve opaque messages */
          }
          if (payloadTenant !== tenantId) {
            channel.sendToQueue(queue, message.content, {
              ...message.properties,
            });
            await channel.waitForConfirms();
          }
          channel.ack(message);
        }
        // Include consumers that have already received a message. A later tick
        // retries after their handler observes the closed tenant and acknowledges.
        await channel.checkQueue(queue); // barrier after this channel's acknowledgements
        if ((await this.state(queue)).messages_unacknowledged > 0) return false;
      }
      await channel.close();
      return true;
    } finally {
      await connection.close();
    }
  }

  private async state(
    queue: string,
  ): Promise<{ messages_ready: number; messages_unacknowledged: number }> {
    if (!this.managementUrl)
      throw new Error('BROKER_MANAGEMENT_NOT_CONFIGURED');
    const url = new URL(this.url);
    const vhost = decodeURIComponent(url.pathname.slice(1) || '/');
    // Read live queue totals instead of the management metrics cache. Cached
    // counts can miss a message a consumer received only moments ago.
    const response = await fetch(
      `${this.managementUrl.replace(/\/$/, '')}/api/queues/${encodeURIComponent(vhost)}/${encodeURIComponent(queue)}?disable_stats=true&enable_queue_totals=true`,
      {
        headers: {
          authorization: `Basic ${Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString('base64')}`,
        },
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok) throw new Error('BROKER_INSPECTION_FAILED');
    const value = (await response.json()) as {
      messages_ready?: number;
      messages_unacknowledged?: number;
    };
    const ready = value.messages_ready;
    const unacknowledged = value.messages_unacknowledged;
    if (
      typeof ready !== 'number' ||
      !Number.isInteger(ready) ||
      ready < 0 ||
      typeof unacknowledged !== 'number' ||
      !Number.isInteger(unacknowledged) ||
      unacknowledged < 0
    )
      throw new Error('BROKER_INSPECTION_FAILED');
    return { messages_ready: ready, messages_unacknowledged: unacknowledged };
  }
}

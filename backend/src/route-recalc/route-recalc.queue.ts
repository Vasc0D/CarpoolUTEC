import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ROUTE_RECALC_QUEUE, RouteRecalcJobData } from './route-recalc.types';

/**
 * Producer wrapper around the BullMQ queue. BookingsService talks to this
 * instead of importing `Queue` directly so the call site stays small and the
 * retry/backoff policy lives in one place.
 *
 * Why a dedicated service rather than just InjectQueue everywhere:
 *   - default job options (attempts, backoff, removeOnComplete) belong to
 *     the producer, not the caller — concentrating them avoids drift
 *   - test mocks have a single seam (mock RouteRecalcQueue.enqueue, done)
 *   - if we later route different ops to different queues (e.g., `remove`
 *     could be lower priority than `add`), the routing logic lives here
 */
@Injectable()
export class RouteRecalcQueue {
  private readonly logger = new Logger(RouteRecalcQueue.name);

  constructor(@InjectQueue(ROUTE_RECALC_QUEUE) private readonly queue: Queue<RouteRecalcJobData>) {}

  async enqueue(data: RouteRecalcJobData): Promise<void> {
    // Job name = op for easier introspection in BullMQ dashboards.
    await this.queue.add(data.op, data, {
      // 3 attempts is plenty for a Routes API blip; more risks queueing
      // bookings for too long and hiding real outages.
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      // Keep finished jobs around briefly for debugging, then GC.
      removeOnComplete: { age: 60 * 60, count: 1000 }, // 1 hour OR 1000 jobs
      removeOnFail: { age: 24 * 60 * 60, count: 1000 }, // 24h OR 1000 jobs
    });
    this.logger.debug(`Enqueued ${data.op} for trip ${data.tripId}, booking ${data.bookingId}`);
  }
}

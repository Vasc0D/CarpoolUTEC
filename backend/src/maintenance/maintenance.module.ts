import { Logger, Module, OnApplicationBootstrap } from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { TripsModule } from '../trips/trips.module';
import { MaintenanceProcessor } from './maintenance.processor';
import { MAINTENANCE_JOBS, MAINTENANCE_QUEUE } from './maintenance.types';

/**
 * Registers the trip-maintenance queue, its processor, and the recurring
 * job schedulers. Replaces the @nestjs/schedule @Cron decorators previously
 * on TripsService.
 *
 * upsertJobScheduler is called on every bootstrap; BullMQ keys schedulers by
 * id so multiple instances starting up don't create duplicate entries —
 * the cluster ends up with exactly one scheduler per id no matter how many
 * pods race to register on boot.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: MAINTENANCE_QUEUE }),
    TripsModule,
  ],
  providers: [MaintenanceProcessor],
})
export class MaintenanceModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(MaintenanceModule.name);

  constructor(@InjectQueue(MAINTENANCE_QUEUE) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    // Run every minute. Pattern uses standard cron syntax.
    await this.queue.upsertJobScheduler(
      MAINTENANCE_JOBS.AUTO_CANCEL_EMPTY,
      { pattern: '* * * * *' },
      { name: MAINTENANCE_JOBS.AUTO_CANCEL_EMPTY, data: {} },
    );
    await this.queue.upsertJobScheduler(
      MAINTENANCE_JOBS.AUTO_REMOVE_NO_SHOWS,
      { pattern: '* * * * *' },
      { name: MAINTENANCE_JOBS.AUTO_REMOVE_NO_SHOWS, data: {} },
    );
    this.logger.log('Maintenance schedulers registered (1 min cadence)');
  }
}

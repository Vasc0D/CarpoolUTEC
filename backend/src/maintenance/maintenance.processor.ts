import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { TripsService } from '../trips/trips.service';
import { MAINTENANCE_JOBS, MAINTENANCE_QUEUE, MaintenanceJobName } from './maintenance.types';

/**
 * Worker for periodic trip maintenance jobs scheduled by MaintenanceModule.
 *
 * Concurrency=1 here is intentional: both jobs scan the entire trips table
 * and we don't want two parallel scans clobbering each other. The dedup
 * across backend instances comes from the BullMQ scheduler upstream — only
 * one instance gets the tick.
 */
@Processor(MAINTENANCE_QUEUE, { concurrency: 1 })
export class MaintenanceProcessor extends WorkerHost {
  private readonly logger = new Logger(MaintenanceProcessor.name);

  constructor(private readonly tripsService: TripsService) {
    super();
  }

  async process(job: Job<unknown, void, MaintenanceJobName>): Promise<void> {
    switch (job.name) {
      case MAINTENANCE_JOBS.AUTO_CANCEL_EMPTY:
        await this.tripsService.autoCancelEmptyTrips();
        return;
      case MAINTENANCE_JOBS.AUTO_REMOVE_NO_SHOWS:
        await this.tripsService.autoRemoveNoShows();
        return;
      case MAINTENANCE_JOBS.RECOMPUTE_LIVE_ETAS:
        await this.tripsService.recomputeLiveEtas();
        return;
      case MAINTENANCE_JOBS.AUTO_START_BOARDING:
        await this.tripsService.autoStartBoarding();
        return;
      default:
        this.logger.warn(`Unknown maintenance job: ${job.name}`);
    }
  }
}

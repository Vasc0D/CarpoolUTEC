/**
 * Queue + job names for periodic trip maintenance work.
 *
 * Replaces the @nestjs/schedule @Cron decorators that previously fired in
 * every backend instance simultaneously (no dedup), causing double
 * cancellations and notification spam at horizontal scale. BullMQ's job
 * scheduler is keyed on schedulerId — Redis serializes adds across
 * instances so exactly one job runs per tick cluster-wide.
 */
export const MAINTENANCE_QUEUE = 'trip-maintenance';

export const MAINTENANCE_JOBS = {
  AUTO_CANCEL_EMPTY: 'auto-cancel-empty',
  AUTO_REMOVE_NO_SHOWS: 'auto-remove-no-shows',
} as const;

export type MaintenanceJobName = (typeof MAINTENANCE_JOBS)[keyof typeof MAINTENANCE_JOBS];

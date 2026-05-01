import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Removes the `meetingPoint` column from the trips table.
 *
 * The column previously stored a per-trip serialized GeoJSON Point, but in
 * practice every trip used the same fixed pickup spot at the UTEC car exit.
 * The pickup location is now a backend constant (see src/trips/constants.ts).
 * Removing the column eliminates a TEXT-with-JSON-inside footgun and shrinks
 * the Trip entity ahead of the larger TripRoutePlan refactor.
 *
 * Down migration recreates the column as nullable so the prior shape is
 * recoverable, but existing data is not preserved (it would have been the
 * same constant for every row anyway).
 */
export class DropMeetingPointFromTrips1745700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trips"
        DROP COLUMN IF EXISTS "meetingPoint"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trips"
        ADD COLUMN IF NOT EXISTS "meetingPoint" text NULL
    `);
  }
}

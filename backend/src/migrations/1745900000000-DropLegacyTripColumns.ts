import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 2 Commit #5 — remove the six legacy routing columns from the trips
 * table now that every reader has been migrated to TripRoutePlan / TripRouteLeg
 * and the dual-write window is closed.
 *
 * Dropped columns:
 *   routePolyline          — geometry, replaced by trip_route_plans.polylineGeom
 *   originalDurationSeconds — int, replaced by trip_route_plans.totalDurationSeconds
 *   tripOrigin              — json, derived from first leg's startLat/startLng
 *   finalDestination        — json, derived from last leg's endLat/endLng
 *   passengerWaypoints      — json[], derived from legs with passengerDropOffId != null
 *   legDurationsSeconds     — json[], derived from legs[].durationSeconds
 *
 * The down migration re-adds all columns as nullable so a rollback doesn't
 * break existing rows — the data is gone, but the schema is intact.
 */
export class DropLegacyTripColumns1745900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trips"
        DROP COLUMN IF EXISTS "routePolyline",
        DROP COLUMN IF EXISTS "passengerWaypoints",
        DROP COLUMN IF EXISTS "legDurationsSeconds",
        DROP COLUMN IF EXISTS "originalDurationSeconds",
        DROP COLUMN IF EXISTS "tripOrigin",
        DROP COLUMN IF EXISTS "finalDestination"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Re-add as nullable so existing rows are not broken on rollback.
    // Data is not restored — this only reinstates the schema structure.
    await queryRunner.query(`
      ALTER TABLE "trips"
        ADD COLUMN IF NOT EXISTS "originalDurationSeconds" int NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "tripOrigin" json NULL,
        ADD COLUMN IF NOT EXISTS "finalDestination" json NULL,
        ADD COLUMN IF NOT EXISTS "passengerWaypoints" json NULL,
        ADD COLUMN IF NOT EXISTS "legDurationsSeconds" json NULL
    `);
    // geometry column must be added separately (PostGIS syntax)
    await queryRunner.query(`
      ALTER TABLE "trips"
        ADD COLUMN IF NOT EXISTS "routePolyline" geometry(LineString, 4326) NULL
    `);
  }
}

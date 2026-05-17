import { MigrationInterface, QueryRunner } from 'typeorm';

export class BackfillTripRoutePlans1745850000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasRoutePolyline = await this.hasColumn(queryRunner, 'trips', 'routePolyline');
    if (!hasRoutePolyline) return;

    await queryRunner.query(`
      WITH source AS (
        SELECT
          t.id AS "tripId",
          t."departureTime",
          t."routePolyline",
          GREATEST(COALESCE(t."originalDurationSeconds", 0), 0) AS duration
        FROM "trips" t
        WHERE t."routePolyline" IS NOT NULL
          AND t."currentRoutePlanId" IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM "trip_route_plans" p WHERE p."tripId" = t.id
          )
      ),
      inserted AS (
        INSERT INTO "trip_route_plans" (
          "tripId", "version", "encodedPolyline", "polylineGeom",
          "totalDurationSeconds", "computedForDepartureAt",
          "routingPreference", "status"
        )
        SELECT
          "tripId", 1, '', "routePolyline", duration,
          "departureTime", 'TRAFFIC_AWARE', 'ACTIVE'
        FROM source
        RETURNING id, "tripId", "polylineGeom", "totalDurationSeconds"
      ),
      legs AS (
        INSERT INTO "trip_route_legs" (
          "planId", "legIndex", "durationSeconds",
          "startLat", "startLng", "endLat", "endLng", "passengerDropOffId"
        )
        SELECT
          id,
          0,
          "totalDurationSeconds",
          ST_Y(ST_StartPoint("polylineGeom")),
          ST_X(ST_StartPoint("polylineGeom")),
          ST_Y(ST_EndPoint("polylineGeom")),
          ST_X(ST_EndPoint("polylineGeom")),
          NULL
        FROM inserted
        RETURNING "planId"
      )
      UPDATE "trips" t
      SET "currentRoutePlanId" = i.id
      FROM inserted i
      WHERE t.id = i."tripId"
    `);
  }

  public async down(): Promise<void> {
    // Backfilled plans are indistinguishable from user-created plans after
    // they become current route state, so rollback intentionally preserves them.
  }

  private async hasColumn(queryRunner: QueryRunner, table: string, column: string): Promise<boolean> {
    const rows = await queryRunner.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
      [table, column],
    );
    return rows.length > 0;
  }
}

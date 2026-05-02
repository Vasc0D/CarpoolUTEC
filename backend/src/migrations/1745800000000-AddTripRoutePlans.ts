import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 2 — introduce TripRoutePlan / TripRouteLeg schema.
 *
 * The old shape — embedded routePolyline + passengerWaypoints[] +
 * legDurationsSeconds[] on Trip — couldn't carry version history (every
 * recalc clobbered the previous state) and had no place to associate a
 * leg with the booking it terminated at without trusting parallel-array
 * indexing. The new shape is one row per Routes API response, with one
 * leg row per segment, FK'd to bookings where applicable.
 *
 * This migration only ADDS the new schema and a nullable
 * `currentRoutePlanId` FK on `trips`. Legacy columns stay in place for the
 * dual-write window — drop migration lands separately once readers have
 * been switched over.
 */
export class AddTripRoutePlans1745800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enums declared at the type level; PostgreSQL requires them as named
    // types when used in column definitions. IF NOT EXISTS not supported on
    // CREATE TYPE, so we guard with a DO block.
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "trip_route_plans_routingpreference_enum" AS ENUM (
          'TRAFFIC_UNAWARE', 'TRAFFIC_AWARE', 'TRAFFIC_AWARE_OPTIMAL'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "trip_route_plans_status_enum" AS ENUM (
          'ACTIVE', 'SUPERSEDED', 'FAILED'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "trip_route_plans" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tripId" uuid NOT NULL,
        "version" int NOT NULL,
        "encodedPolyline" text NOT NULL,
        "polylineGeom" geometry(LineString, 4326) NOT NULL,
        "totalDurationSeconds" int NOT NULL,
        "computedForDepartureAt" timestamp NOT NULL,
        "routingPreference" "trip_route_plans_routingpreference_enum" NOT NULL DEFAULT 'TRAFFIC_AWARE',
        "status" "trip_route_plans_status_enum" NOT NULL DEFAULT 'ACTIVE',
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_trip_route_plans_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_trip_route_plans_trip_version" UNIQUE ("tripId", "version"),
        CONSTRAINT "FK_trip_route_plans_trip" FOREIGN KEY ("tripId")
          REFERENCES "trips"("id") ON DELETE CASCADE
      )
    `);

    // Composite index used by hot-path lookups for the ACTIVE plan of a
    // given trip — matches the @Index decorator on the entity.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "trip_route_plans_trip_status"
        ON "trip_route_plans" ("tripId", "status")
    `);

    // GiST on the geometry column for ST_DWithin / ST_Distance. Without
    // this, findAvailableTrips proximity filters would full-scan every
    // plan — the existing GiST on trips.routePolyline is implicit because
    // PostGIS auto-creates it on geometry columns; doing the same here.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "trip_route_plans_polyline_gist"
        ON "trip_route_plans" USING GIST ("polylineGeom")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "trip_route_legs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "planId" uuid NOT NULL,
        "legIndex" int NOT NULL,
        "durationSeconds" int NOT NULL,
        "startLat" numeric(9,6) NOT NULL,
        "startLng" numeric(9,6) NOT NULL,
        "endLat" numeric(9,6) NOT NULL,
        "endLng" numeric(9,6) NOT NULL,
        "passengerDropOffId" uuid NULL,
        CONSTRAINT "PK_trip_route_legs_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_trip_route_legs_plan_index" UNIQUE ("planId", "legIndex"),
        CONSTRAINT "FK_trip_route_legs_plan" FOREIGN KEY ("planId")
          REFERENCES "trip_route_plans"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_trip_route_legs_dropoff" FOREIGN KEY ("passengerDropOffId")
          REFERENCES "bookings"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "trips"
        ADD COLUMN IF NOT EXISTS "currentRoutePlanId" uuid NULL,
        ADD CONSTRAINT "FK_trips_currentRoutePlan" FOREIGN KEY ("currentRoutePlanId")
          REFERENCES "trip_route_plans"("id") ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trips"
        DROP CONSTRAINT IF EXISTS "FK_trips_currentRoutePlan",
        DROP COLUMN IF EXISTS "currentRoutePlanId"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "trip_route_legs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "trip_route_plans"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "trip_route_plans_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "trip_route_plans_routingpreference_enum"`);
  }
}

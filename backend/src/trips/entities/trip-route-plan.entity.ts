import {
  Column, CreateDateColumn, Entity, Index,
  JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';
import { Trip } from './trip.entity';
import { TripRouteLeg } from './trip-route-leg.entity';

/**
 * Routing preference passed to Routes API. Stored on the plan so we know
 * which traffic model produced a given duration estimate — useful for
 * auditing whether ETA drift is upstream (Google) or in our code.
 */
export enum RoutingPreference {
  TRAFFIC_UNAWARE = 'TRAFFIC_UNAWARE',
  TRAFFIC_AWARE = 'TRAFFIC_AWARE',
  TRAFFIC_AWARE_OPTIMAL = 'TRAFFIC_AWARE_OPTIMAL',
}

/**
 * Plan lifecycle. ACTIVE plans are referenced by Trip.currentRoutePlanId;
 * SUPERSEDED plans are kept for history but never read from the hot path;
 * FAILED plans were attempted and their underlying job exhausted retries —
 * we keep them so the audit trail captures Routes API failures, not just
 * successes.
 */
export enum RoutePlanStatus {
  ACTIVE = 'ACTIVE',
  SUPERSEDED = 'SUPERSEDED',
  FAILED = 'FAILED',
}

/**
 * One row per Routes API call that produced a usable plan for a trip.
 * Replaces the embedded {routePolyline, passengerWaypoints,
 * legDurationsSeconds, originalDurationSeconds} on Trip — those couldn't
 * carry version history and silently lost prior state on every recalc.
 *
 * Each plan is immutable after persist. New recalcs SUPERSEDE the previous
 * ACTIVE plan and create a new row at version+1, swapping
 * Trip.currentRoutePlanId in the same transaction.
 */
@Entity('trip_route_plans')
@Index('trip_route_plans_trip_status', ['trip', 'status'])
export class TripRoutePlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Trip, trip => trip.routePlans, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tripId' })
  trip: Trip;

  @Column({ type: 'uuid' })
  tripId: string;

  // Monotonic per trip. Combined with tripId via a unique constraint (in
  // the migration) so concurrent recalc workers can't race to the same
  // (tripId, version).
  @Column({ type: 'int' })
  version: number;

  // Raw encoded polyline as returned by Routes API. Cheaper to store than
  // decoding to coordinates; clients decode on demand.
  @Column({ type: 'text' })
  encodedPolyline: string;

  // PostGIS LineString in [lng, lat] order, SRID 4326. Used for ST_DWithin
  // proximity searches in findAvailableTrips. Stored alongside the encoded
  // polyline so the spatial query stays a single index lookup instead of
  // forcing a runtime polyline decode.
  @Column({
    type: 'geometry',
    spatialFeatureType: 'LineString',
    srid: 4326,
  })
  polylineGeom: { type: string; coordinates: number[][] };

  // Sum of leg durations, denormalized so consumers don't have to aggregate
  // children. Always equals SUM(legs.durationSeconds).
  @Column({ type: 'int' })
  totalDurationSeconds: number;

  // The trip.departureTime that was passed to Routes API for this plan.
  // Pinning it on the row lets us tell whether a plan is stale because the
  // driver rescheduled and the cached traffic predictions no longer apply.
  @Column({ type: 'timestamp' })
  computedForDepartureAt: Date;

  @Column({
    type: 'enum',
    enum: RoutingPreference,
    default: RoutingPreference.TRAFFIC_AWARE,
  })
  routingPreference: RoutingPreference;

  @Column({
    type: 'enum',
    enum: RoutePlanStatus,
    default: RoutePlanStatus.ACTIVE,
  })
  status: RoutePlanStatus;

  // Cascade so deleting a plan removes its legs in one statement; also
  // covers the orphan case if a plan row is rolled back mid-write.
  @OneToMany(() => TripRouteLeg, leg => leg.plan, { cascade: ['insert', 'update'] })
  legs: TripRouteLeg[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

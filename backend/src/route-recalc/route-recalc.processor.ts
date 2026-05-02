import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { Job } from 'bullmq';
import { Booking, BookingStatus } from '../bookings/entities/booking.entity';
import { Trip } from '../trips/entities/trip.entity';
import { TripRoutePlan, RoutePlanStatus, RoutingPreference } from '../trips/entities/trip-route-plan.entity';
import { TripRouteLeg } from '../trips/entities/trip-route-leg.entity';
import { DirectionsService } from '../geo/directions.service';
import { GeoService } from '../geo/geo.service';
import { NotificationsService } from '../notifications/notifications.service';
import { KeyedMutex } from '../common/keyed-mutex';
import { ROUTE_RECALC_QUEUE, RouteRecalcJobData } from './route-recalc.types';

/**
 * Result of a Routes API call, distilled to what the persist step needs.
 * Decoupling the API shape from the DB shape so the processor's main
 * branches stay readable and the dual-write transaction has a single,
 * well-typed input.
 */
type RecalcResult = {
  trip: Trip;
  intermediates: { passengerId: string; lat: number; lng: number }[];
  origin: { lat: number; lng: number };
  finalDest: { lat: number; lng: number };
  polylinePoints: [number, number][];
  legDurations: number[];
};

/**
 * Worker that owns the Routes API call and the persistence of new route plans.
 *
 * Phase 2: dual-writes. Every successful recalc:
 *   1. Persists the new TripRoutePlan + TripRouteLeg rows (versioned).
 *   2. Marks the previously ACTIVE plan as SUPERSEDED.
 *   3. Updates Trip.currentRoutePlanId.
 *   4. Continues to write legacy columns (routePolyline, passengerWaypoints,
 *      legDurationsSeconds) so reads that haven't switched over yet keep
 *      working. Legacy writes drop in the next commit.
 *
 * All four steps happen inside one DB transaction so the swap is atomic —
 * a crash mid-write never leaves a stale currentRoutePlanId.
 */
@Processor(ROUTE_RECALC_QUEUE, { concurrency: 5 })
export class RouteRecalcProcessor extends WorkerHost {
  private readonly logger = new Logger(RouteRecalcProcessor.name);

  constructor(
    @InjectRepository(Trip) private readonly tripsRepository: Repository<Trip>,
    @InjectRepository(Booking) private readonly bookingsRepository: Repository<Booking>,
    @InjectRepository(TripRoutePlan) private readonly plansRepository: Repository<TripRoutePlan>,
    private readonly directionsService: DirectionsService,
    private readonly geoService: GeoService,
    private readonly notificationsService: NotificationsService,
    private readonly recalcMutex: KeyedMutex,
    private readonly dataSource: DataSource,
  ) {
    super();
  }

  async process(job: Job<RouteRecalcJobData>): Promise<void> {
    const data = job.data;
    this.logger.debug(`Processing ${data.op} for trip ${data.tripId} (attempt ${job.attemptsMade + 1}/${job.opts.attempts})`);

    try {
      await this.recalcMutex.run(data.tripId, async () => {
        const recalc = data.op === 'add'
          ? await this.computeAdd(data)
          : await this.computeRemove(data);
        if (!recalc) return; // legacy trip with no usable polyline; logged inside

        await this.persistAtomicSwap(recalc);
        await this.notifyActivePassengers(recalc.trip.id);
      });
    } catch (err: any) {
      const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      if (isFinalAttempt && data.op === 'add') {
        await this.compensateFailedAdd(data, err.message);
      }
      throw err;
    }
  }

  private async computeAdd(data: Extract<RouteRecalcJobData, { op: 'add' }>): Promise<RecalcResult | null> {
    const trip = await this.tripsRepository.findOne({ where: { id: data.tripId } });
    if (!trip) throw new Error(`Trip ${data.tripId} not found`);

    const coords: number[][] = trip.routePolyline?.coordinates;
    if (!coords?.length || coords.length < 2) {
      throw new Error(`Trip ${data.tripId} has no usable routePolyline`);
    }

    const origin = trip.tripOrigin ?? { lat: coords[0][1], lng: coords[0][0] };
    const finalDest = trip.finalDestination ?? { lat: coords[coords.length - 1][1], lng: coords[coords.length - 1][0] };

    // Filter prevents duplicate-waypoint corruption when a previous recalc
    // already persisted this passenger's stop.
    const intermediatesPre = [
      ...(trip.passengerWaypoints ?? []).filter(w => w.passengerId !== data.passengerId),
      { passengerId: data.passengerId, lat: data.destLat, lng: data.destLng },
    ];
    const allWaypoints = [origin, ...intermediatesPre.map(w => ({ lat: w.lat, lng: w.lng })), finalDest];

    const { polylinePoints, legDurations, waypointOrder } = await this.directionsService.getRoute(
      allWaypoints,
      new Date(trip.departureTime),
    );

    // Apply Google's optimized order so the persisted waypoint sequence
    // matches the actual driving sequence.
    const intermediates = waypointOrder.length === intermediatesPre.length
      ? waypointOrder.map(i => intermediatesPre[i])
      : intermediatesPre;

    return { trip, intermediates, origin, finalDest, polylinePoints, legDurations };
  }

  private async computeRemove(data: Extract<RouteRecalcJobData, { op: 'remove' }>): Promise<RecalcResult | null> {
    const trip = await this.tripsRepository.findOne({ where: { id: data.tripId } });
    if (!trip) throw new Error(`Trip ${data.tripId} not found`);

    const remaining = (trip.passengerWaypoints ?? []).filter(w => w.passengerId !== data.passengerId);
    const coords: number[][] = trip.routePolyline?.coordinates;
    if (!coords?.length || coords.length < 2) {
      this.logger.warn(`Trip ${trip.id} has no usable routePolyline; skipping remove`);
      return null;
    }

    const origin = trip.tripOrigin ?? { lat: coords[0][1], lng: coords[0][0] };
    const finalDest = trip.finalDestination ?? { lat: coords[coords.length - 1][1], lng: coords[coords.length - 1][0] };
    const waypointList = [origin, ...remaining.map(w => ({ lat: w.lat, lng: w.lng })), finalDest];

    const { polylinePoints, legDurations, waypointOrder } = await this.directionsService.getRoute(
      waypointList,
      new Date(trip.departureTime),
    );

    const intermediates = waypointOrder.length === remaining.length
      ? waypointOrder.map(i => remaining[i])
      : remaining;

    return { trip, intermediates, origin, finalDest, polylinePoints, legDurations };
  }

  /**
   * Atomic swap to the new TripRoutePlan, with legacy column writes for
   * backwards compatibility with readers that haven't migrated yet.
   *
   * Order matters: SUPERSEDE the prior ACTIVE plan FIRST so the partial
   * unique index (one ACTIVE plan per trip — added in a later migration)
   * doesn't collide on insert. Within a transaction, this is just defensive
   * — Postgres only checks the constraint at commit by default.
   */
  private async persistAtomicSwap(r: RecalcResult): Promise<void> {
    const { trip, intermediates, origin, finalDest, polylinePoints, legDurations } = r;

    // Resolve passengerId → bookingId for each waypoint up front (single
    // query) so the transaction body stays short.
    const bookingMap = await this.resolveBookingMap(trip.id, intermediates.map(w => w.passengerId));

    const lineString = this.geoService.createLineString(polylinePoints);
    const encodedPolyline = this.encodePolyline(polylinePoints);

    await this.dataSource.transaction(async (manager: EntityManager) => {
      // 1. Find current ACTIVE version (if any) and supersede it.
      const previous = await manager.findOne(TripRoutePlan, {
        where: { tripId: trip.id, status: RoutePlanStatus.ACTIVE },
      });
      if (previous) {
        await manager.update(TripRoutePlan, previous.id, { status: RoutePlanStatus.SUPERSEDED });
      }
      const nextVersion = (previous?.version ?? 0) + 1;

      // 2. Insert the new plan.
      const totalDurationSeconds = legDurations.reduce((a, b) => a + b, 0);
      const inserted = await manager.save(TripRoutePlan, manager.create(TripRoutePlan, {
        tripId: trip.id,
        version: nextVersion,
        encodedPolyline,
        polylineGeom: lineString,
        totalDurationSeconds,
        computedForDepartureAt: trip.departureTime,
        routingPreference: RoutingPreference.TRAFFIC_AWARE,
        status: RoutePlanStatus.ACTIVE,
      }));

      // 3. Build legs: one per intermediate (each ends at a passenger drop-off)
      // plus a final leg ending at the trip's destination (no drop-off).
      const legRows: Partial<TripRouteLeg>[] = [];
      const sequence = [origin, ...intermediates.map(w => ({ lat: w.lat, lng: w.lng })), finalDest];
      for (let i = 0; i < legDurations.length; i++) {
        const start = sequence[i];
        const end = sequence[i + 1];
        const passengerForLeg = i < intermediates.length ? intermediates[i].passengerId : null;
        legRows.push({
          planId: inserted.id,
          legIndex: i,
          durationSeconds: legDurations[i],
          startLat: start.lat,
          startLng: start.lng,
          endLat: end.lat,
          endLng: end.lng,
          passengerDropOffId: passengerForLeg ? bookingMap.get(passengerForLeg) ?? null : null,
        });
      }
      if (legRows.length > 0) {
        await manager.insert(TripRouteLeg, legRows);
      }

      // 4. Point the trip at the new plan AND keep legacy columns in sync.
      // The legacy writes go away in the next commit once readers are
      // migrated, but for now we cannot break consumers reading
      // routePolyline / passengerWaypoints / legDurationsSeconds.
      await manager.update(Trip, trip.id, {
        currentRoutePlanId: inserted.id,
        routePolyline: lineString,
        passengerWaypoints: intermediates,
        legDurationsSeconds: legDurations,
      });
    });
  }

  /**
   * One DB query → Map<passengerId, bookingId> for every passenger that has
   * an ACCEPTED booking on this trip. Used to associate each leg with the
   * booking it terminates at.
   */
  private async resolveBookingMap(tripId: string, passengerIds: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (passengerIds.length === 0) return map;
    const bookings = await this.bookingsRepository.find({
      where: { trip: { id: tripId }, status: BookingStatus.ACCEPTED },
      relations: ['passenger'],
    });
    for (const b of bookings) {
      if (passengerIds.includes(b.passenger.id)) map.set(b.passenger.id, b.id);
    }
    return map;
  }

  /**
   * Encode a [lat, lng][] sequence as a Google polyline string. We get an
   * encoded polyline back from Routes API and have it as the decoded array
   * here; encoding is needed to populate TripRoutePlan.encodedPolyline.
   *
   * This is just the inverse of DirectionsService.decodePolyline. Keeping
   * it inline avoids a third file for ten lines of arithmetic; if a third
   * caller appears, hoist into a shared module.
   */
  private encodePolyline(points: [number, number][]): string {
    let result = '';
    let prevLat = 0;
    let prevLng = 0;
    for (const [lat, lng] of points) {
      const latE5 = Math.round(lat * 1e5);
      const lngE5 = Math.round(lng * 1e5);
      result += this.encodeSignedNumber(latE5 - prevLat);
      result += this.encodeSignedNumber(lngE5 - prevLng);
      prevLat = latE5;
      prevLng = lngE5;
    }
    return result;
  }

  private encodeSignedNumber(num: number): string {
    let sgn = num << 1;
    if (num < 0) sgn = ~sgn;
    let result = '';
    while (sgn >= 0x20) {
      result += String.fromCharCode((0x20 | (sgn & 0x1f)) + 63);
      sgn >>= 5;
    }
    result += String.fromCharCode(sgn + 63);
    return result;
  }

  private async notifyActivePassengers(tripId: string): Promise<void> {
    const trip = await this.tripsRepository.findOne({
      where: { id: tripId },
      relations: ['driver'],
    });
    const activeBookings = await this.bookingsRepository.find({
      where: { trip: { id: tripId }, status: In([BookingStatus.PENDING, BookingStatus.ACCEPTED]) },
      relations: ['passenger'],
    });
    for (const b of activeBookings) {
      this.notificationsService.notifyPassengerRouteUpdated(b.passenger.id, { tripId });
    }
    if (trip?.driver) {
      this.notificationsService.notifyDriverRouteUpdated(trip.driver.id, { tripId });
    }
  }

  private async compensateFailedAdd(
    data: Extract<RouteRecalcJobData, { op: 'add' }>,
    reason: string,
  ): Promise<void> {
    this.logger.error(`Compensating booking ${data.bookingId} (trip ${data.tripId}): ${reason}`);

    let driverId: string | null = null;
    let passengerName: string | null = null;
    try {
      await this.dataSource.transaction(async (manager: EntityManager) => {
        const booking = await manager.findOne(Booking, {
          where: { id: data.bookingId },
          relations: ['trip', 'trip.driver', 'passenger'],
        });
        if (!booking) return;
        if (booking.status !== BookingStatus.ACCEPTED) return;

        await manager.update(Booking, booking.id, { status: BookingStatus.CANCELED });
        await manager
          .createQueryBuilder()
          .update(Trip)
          .set({ availableSeats: () => '"availableSeats" + 1' })
          .where('id = :id', { id: data.tripId })
          .execute();

        driverId = booking.trip.driver.id;
        passengerName = booking.passenger.name;
      });
    } catch (err: any) {
      this.logger.error(`Compensation transaction failed for booking ${data.bookingId}: ${err.message}`);
      return;
    }

    this.notificationsService.notifyBookingRouteFailed(data.passengerId, {
      bookingId: data.bookingId,
      tripId: data.tripId,
      reason,
    });
    if (driverId && passengerName) {
      this.notificationsService.notifyDriverBookingCanceled(driverId, {
        bookingId: data.bookingId,
        tripId: data.tripId,
        passengerName,
      });
    }
  }
}

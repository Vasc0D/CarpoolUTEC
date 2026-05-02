import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { Job } from 'bullmq';
import { Booking, BookingStatus } from '../bookings/entities/booking.entity';
import { Trip } from '../trips/entities/trip.entity';
import { DirectionsService } from '../geo/directions.service';
import { GeoService } from '../geo/geo.service';
import { NotificationsService } from '../notifications/notifications.service';
import { KeyedMutex } from '../common/keyed-mutex';
import { ROUTE_RECALC_QUEUE, RouteRecalcJobData } from './route-recalc.types';

/**
 * Worker that owns the Routes API call and the persistence of new route plans.
 *
 * Moving this off the booking request's critical path means:
 *   - POST /bookings/:tripId returns in ~50ms (Phase 1 vs ~1500ms in Phase 0)
 *   - Routes API failures retry with exponential backoff instead of 500-ing
 *     the user-visible booking response
 *   - Saga compensation (cancel booking + restore seat) happens only after
 *     all retries are exhausted, surfaced via the `booking_route_failed`
 *     socket event so the frontend can render a clear toast
 *
 * Per-trip serialization: the previous in-process KeyedMutex is now Redis
 * SETNX, so two recalcs for the same tripId across different worker
 * instances still serialize. Concurrency=5 by default — multiple TRIPS can
 * recalc in parallel; multiple bookings on the SAME trip cannot.
 */
@Processor(ROUTE_RECALC_QUEUE, { concurrency: 5 })
export class RouteRecalcProcessor extends WorkerHost {
  private readonly logger = new Logger(RouteRecalcProcessor.name);

  constructor(
    @InjectRepository(Trip) private readonly tripsRepository: Repository<Trip>,
    @InjectRepository(Booking) private readonly bookingsRepository: Repository<Booking>,
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
        if (data.op === 'add') {
          await this.applyAdd(data);
        } else {
          await this.applyRemove(data);
        }
      });
    } catch (err: any) {
      // Final failure: BullMQ has exhausted retries. Compensate the booking
      // (cancel + restore seat) and notify both parties. Only `add` ops have
      // a meaningful compensation — `remove` failing leaves the route a bit
      // stale but the booking is already cancelled.
      const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      if (isFinalAttempt && data.op === 'add') {
        await this.compensateFailedAdd(data, err.message);
      }
      throw err; // let BullMQ mark the job as failed and trigger retries
    }
  }

  private async applyAdd(data: Extract<RouteRecalcJobData, { op: 'add' }>): Promise<void> {
    const trip = await this.tripsRepository.findOne({ where: { id: data.tripId } });
    if (!trip) throw new Error(`Trip ${data.tripId} not found`);

    const coords: number[][] = trip.routePolyline?.coordinates;
    if (!coords?.length || coords.length < 2) {
      throw new Error(`Trip ${data.tripId} has no usable routePolyline`);
    }

    const origin = trip.tripOrigin ?? { lat: coords[0][1], lng: coords[0][0] };
    const finalDest = trip.finalDestination ?? { lat: coords[coords.length - 1][1], lng: coords[coords.length - 1][0] };

    // Filter prevents the duplicate-waypoint bug if the worker runs after a
    // previous recalc already persisted this passenger's stop.
    const intermediates = [
      ...(trip.passengerWaypoints ?? []).filter(w => w.passengerId !== data.passengerId),
      { passengerId: data.passengerId, lat: data.destLat, lng: data.destLng },
    ];
    const allWaypoints = [origin, ...intermediates.map(w => ({ lat: w.lat, lng: w.lng })), finalDest];

    const { polylinePoints, legDurations, waypointOrder } = await this.directionsService.getRoute(allWaypoints, new Date(trip.departureTime));
    trip.routePolyline = this.geoService.createLineString(polylinePoints);
    trip.passengerWaypoints = waypointOrder.length === intermediates.length
      ? waypointOrder.map(i => intermediates[i])
      : intermediates;
    trip.legDurationsSeconds = legDurations;
    await this.tripsRepository.save(trip);

    await this.notifyActivePassengers(trip.id);
  }

  private async applyRemove(data: Extract<RouteRecalcJobData, { op: 'remove' }>): Promise<void> {
    const trip = await this.tripsRepository.findOne({ where: { id: data.tripId } });
    if (!trip) throw new Error(`Trip ${data.tripId} not found`);

    const remainingWaypoints = (trip.passengerWaypoints ?? []).filter(w => w.passengerId !== data.passengerId);
    const coords: number[][] = trip.routePolyline?.coordinates;
    if (!coords?.length || coords.length < 2) return;

    const origin = trip.tripOrigin ?? { lat: coords[0][1], lng: coords[0][0] };
    const finalDest = trip.finalDestination ?? { lat: coords[coords.length - 1][1], lng: coords[coords.length - 1][0] };
    const waypointList = [origin, ...remainingWaypoints.map(w => ({ lat: w.lat, lng: w.lng })), finalDest];

    const { polylinePoints, legDurations, waypointOrder } = await this.directionsService.getRoute(waypointList, new Date(trip.departureTime));
    trip.routePolyline = this.geoService.createLineString(polylinePoints);
    trip.passengerWaypoints = waypointOrder.length === remainingWaypoints.length
      ? waypointOrder.map(i => remainingWaypoints[i])
      : remainingWaypoints;
    trip.legDurationsSeconds = legDurations;
    await this.tripsRepository.save(trip);

    await this.notifyActivePassengers(trip.id);
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
    // Driver also subscribes to route changes — their dashboard map needs to
    // redraw when waypoints reorder or new stops appear.
    if (trip?.driver) {
      this.notificationsService.notifyDriverRouteUpdated(trip.driver.id, { tripId });
    }
  }

  private async compensateFailedAdd(
    data: Extract<RouteRecalcJobData, { op: 'add' }>,
    reason: string,
  ): Promise<void> {
    this.logger.error(`Compensating booking ${data.bookingId} (trip ${data.tripId}): ${reason}`);

    // Cancel the booking and restore the seat in one transaction so they
    // commit or roll back together.
    let driverId: string | null = null;
    let passengerName: string | null = null;
    try {
      await this.dataSource.transaction(async (manager: EntityManager) => {
        const booking = await manager.findOne(Booking, {
          where: { id: data.bookingId },
          relations: ['trip', 'trip.driver', 'passenger'],
        });
        if (!booking) return;
        // If something already cancelled it (e.g., manual cancel during retry
        // window), don't double-restore the seat.
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
      return; // nothing useful to notify; the inconsistency is now logged
    }

    // Best-effort notifications outside the transaction so a socket failure
    // doesn't roll back the DB state.
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

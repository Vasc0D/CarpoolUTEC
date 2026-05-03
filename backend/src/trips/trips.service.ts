import {
  BadRequestException, ConflictException, ForbiddenException,
  Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, DataSource, EntityManager, In, LessThan, Repository } from 'typeorm';
import { Trip, TripStatus } from './entities/trip.entity';
import { TripStateMachine } from './trip-state-machine';
import { TripRoutePlan, RoutePlanStatus, RoutingPreference } from './entities/trip-route-plan.entity';
import { TripRouteLeg } from './entities/trip-route-leg.entity';
import { CreateTripDto } from './dto/create-trip.dto';
import { UsersService } from '../users/users.service';
import { Booking, BookingStatus } from '../bookings/entities/booking.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { GeoService } from '../geo/geo.service';
import { DirectionsService } from '../geo/directions.service';

// C-1: typed search result — replaces the previous Promise<any[]> return type
export type TripSearchResult = Trip & {
  matchType: 'exact' | 'near' | 'detour';
  distanceToDestination?: number;
  detourMinutes?: number;
};

@Injectable()
export class TripsService {
  private readonly logger = new Logger(TripsService.name);

  constructor(
    @InjectRepository(Trip)
    private readonly tripsRepository: Repository<Trip>,
    @InjectRepository(Booking)
    private readonly bookingsRepository: Repository<Booking>,
    @InjectRepository(TripRoutePlan)
    private readonly plansRepository: Repository<TripRoutePlan>,
    private readonly usersService: UsersService,
    private readonly notificationsService: NotificationsService,
    private readonly geoService: GeoService,
    private readonly directionsService: DirectionsService,
    private readonly dataSource: DataSource,
  ) { }

  async create(userId: string, createTripDto: CreateTripDto): Promise<Trip> {
    const user = await this.usersService.findByIdWithVehicle(userId);

    if (!user || !user.vehicle) {
      throw new ForbiddenException('Debes registrar un vehículo para publicar viajes');
    }

    const requestedDay = new Date(createTripDto.departureTime);
    const startOfDay = new Date(requestedDay);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(requestedDay);
    endOfDay.setHours(23, 59, 59, 999);

    const existingTrip = await this.tripsRepository.findOne({
      where: {
        driver: { id: userId },
        status: In([TripStatus.SCHEDULED, TripStatus.ACTIVE]),
        departureTime: Between(startOfDay, endOfDay),
      },
    });

    if (existingTrip) {
      throw new ConflictException('Ya tienes un viaje programado para ese día');
    }

    // C-2: enforce same 20-minute buffer as the frontend — prevents API-level bypass
    // if (new Date(createTripDto.departureTime) < new Date(Date.now() + 20 * 60 * 1000)) {
    //   throw new BadRequestException('La hora de salida debe ser al menos 20 minutos a partir de ahora');
    // }

    const origin = { lat: createTripDto.route[0][0], lng: createTripDto.route[0][1] };
    const destination = {
      lat: createTripDto.route[createTripDto.route.length - 1][0],
      lng: createTripDto.route[createTripDto.route.length - 1][1],
    };

    let finalRoute = createTripDto.route;
    let originalDurationSeconds = 0;
    let legDurationsSeconds: number[] | null = null;

    try {
      const { polylinePoints, durationSeconds, legDurations } = await this.directionsService.getRoute([origin, destination], new Date(createTripDto.departureTime));
      finalRoute = polylinePoints;
      originalDurationSeconds = durationSeconds;
      legDurationsSeconds = legDurations;
    } catch (e) {
      this.logger.warn(`DirectionsService falló al crear viaje, usando ruta del frontend: ${e.message}`);
    }

    const lineString = this.geoService.createLineString(finalRoute);

    // Persist the trip AND its initial v=1 TripRoutePlan in one transaction
    // so currentRoutePlanId is never null on a fresh trip. Legacy routing
    // columns (routePolyline, passengerWaypoints, etc.) were dropped in
    // migration 1745900000000; all route data lives in TripRoutePlan/Leg.
    const saved = await this.dataSource.transaction(async (manager: EntityManager) => {
      const trip = manager.create(Trip, {
        driver: user,
        departureTime: new Date(createTripDto.departureTime),
        autoAccept: createTripDto.autoAccept || false,
        availableSeats: createTripDto.availableSeats ?? user.vehicle.capacity,
        maxDetourMinutes: createTripDto.maxDetourMinutes ?? 5,
        pricePerSeat: createTripDto.pricePerSeat ?? 0,
        detourEnabled: createTripDto.detourEnabled ?? false,
        status: TripStatus.SCHEDULED,
      });
      const tripRow = await manager.save(Trip, trip);

      // Skip plan creation if Routes API failed and we have no real
      // duration data — the recalc worker will produce a real v=1 on the
      // first booking instead. (Phase 0 fallback warned about this case.)
      if (originalDurationSeconds > 0 && legDurationsSeconds && legDurationsSeconds.length > 0) {
        const plan = await manager.save(TripRoutePlan, manager.create(TripRoutePlan, {
          tripId: tripRow.id,
          version: 1,
          encodedPolyline: this.encodePolyline(finalRoute),
          polylineGeom: lineString,
          totalDurationSeconds: originalDurationSeconds,
          computedForDepartureAt: tripRow.departureTime,
          routingPreference: RoutingPreference.TRAFFIC_AWARE,
          status: RoutePlanStatus.ACTIVE,
        }));
        // Single leg origin → destination on a freshly created trip (no
        // intermediate passenger waypoints yet).
        await manager.insert(TripRouteLeg, {
          planId: plan.id,
          legIndex: 0,
          durationSeconds: legDurationsSeconds[0],
          startLat: origin.lat,
          startLng: origin.lng,
          endLat: destination.lat,
          endLng: destination.lng,
          passengerDropOffId: null,
        });
        await manager.update(Trip, tripRow.id, { currentRoutePlanId: plan.id });
        tripRow.currentRoutePlanId = plan.id;
      }
      return tripRow;
    });

    this.notificationsService.notifyTripPublished();
    return saved;
  }

  /**
   * Inverse of DirectionsService.decodePolyline. Duplicated rather than
   * pulled into a shared helper because there are exactly two callers
   * (here and the recalc processor) and the encoder is fewer than 20 lines.
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

  // C-1: return type is TripSearchResult[] instead of any[]
  async findAvailableTrips(
    lat: number,
    lng: number,
    destLat?: number,
    destLng?: number,
    passengerId?: string,
  ): Promise<TripSearchResult[]> {
    // Join the active route plan so spatial filters can use plan."polylineGeom"
    // instead of the now-dropped trip."routePolyline" column.
    // Trips without a plan (Routes API failed on creation) are excluded from
    // results — they have no route data and cannot be matched spatially.
    const buildBase = () =>
      this.tripsRepository.createQueryBuilder('trip')
        .leftJoin('trip.driver', 'driver')
        .leftJoin('driver.vehicle', 'vehicle')
        .addSelect(['driver.id', 'driver.name', 'vehicle.model', 'vehicle.color', 'vehicle.brand', 'vehicle.plate'])
        .leftJoin('trip.currentRoutePlan', 'plan')
        .where('trip.status = :status', { status: TripStatus.SCHEDULED })
        .andWhere('trip.availableSeats > 0')
        .andWhere('trip.departureTime > :now', { now: new Date() })
        .andWhere(...this.geoService.getDWithinCondition('plan."polylineGeom"', lat, lng, 500, 'pickup'));

    if (destLat === undefined || destLng === undefined) {
      return buildBase().getMany() as Promise<TripSearchResult[]>;
    }

    // Non-detour trips: distance-based matching against the plan geometry
    const nonDetourQb = buildBase()
      .andWhere('trip.detourEnabled = :detour', { detour: false })
      .addSelect(
        `ST_Distance(plan."polylineGeom"::geography, ST_SetSRID(ST_MakePoint(:destLng, :destLat), 4326)::geography)`,
        'distanceToDestination',
      )
      .setParameter('destLng', destLng)
      .setParameter('destLat', destLat)
      .andWhere(...this.geoService.getDWithinCondition('plan."polylineGeom"', destLat, destLng, 800, 'dropoff'));

    // Detour-enabled trips: proximity filter only; detour minutes are checked
    // via Directions API below. We get IDs first so we can reload with plan
    // + legs (needed to derive origin/dest/existing-stops from the leg rows).
    // M-5: cap at 10 to bound Routes API calls.
    const detourIdRows = await buildBase()
      .andWhere('trip.detourEnabled = :detour', { detour: true })
      .select('trip.id')
      .take(10)
      .getMany();
    const detourTripIds = detourIdRows.map(t => t.id);

    // Run the three async operations in parallel: non-detour query, detour
    // trip full-load (with plan + legs), and the requesting passenger's active
    // booking IDs on those trips (for the duplicate-waypoint dedup guard).
    const [
      { entities: nonDetourEntities, raw: nonDetourRaw },
      detourTrips,
      passengerBookingsList,
    ] = await Promise.all([
      nonDetourQb.getRawAndEntities(),
      detourTripIds.length > 0
        ? this.tripsRepository.find({
            where: { id: In(detourTripIds) },
            relations: ['currentRoutePlan', 'currentRoutePlan.legs'],
          })
        : Promise.resolve([] as Trip[]),
      passengerId && detourTripIds.length > 0
        ? this.bookingsRepository.find({
            where: {
              passenger: { id: passengerId },
              status: In([BookingStatus.PENDING, BookingStatus.ACCEPTED]),
            },
            relations: ['trip'],
          })
        : Promise.resolve([] as Booking[]),
    ]);

    // Map tripId → passengerBookingId for the requesting passenger so the
    // detour preview can exclude their existing stop from the re-routing call
    // (otherwise a re-search after booking feeds Routes API a duplicate waypoint).
    const passengerBookingByTripId = new Map<string, string>(
      passengerBookingsList
        .filter(b => detourTripIds.includes(b.trip.id))
        .map(b => [b.trip.id, b.id]),
    );

    const nonDetourResults: TripSearchResult[] = nonDetourEntities.map((entity, i) => {
      const dist = parseFloat(nonDetourRaw[i].distanceToDestination ?? '9999');
      return {
        ...entity,
        distanceToDestination: Math.round(dist),
        matchType: dist <= 200 ? 'exact' : 'near',
      } as TripSearchResult;
    });

    const detourResults: TripSearchResult[] = (
      await Promise.all(
        detourTrips.map(async (trip): Promise<TripSearchResult | null> => {
          try {
            const plan = trip.currentRoutePlan;
            if (!plan?.legs?.length) return null;

            const sortedLegs = [...plan.legs].sort((a, b) => a.legIndex - b.legIndex);
            const origin = {
              lat: Number(sortedLegs[0].startLat),
              lng: Number(sortedLegs[0].startLng),
            };
            const finalDest = {
              lat: Number(sortedLegs[sortedLegs.length - 1].endLat),
              lng: Number(sortedLegs[sortedLegs.length - 1].endLng),
            };

            // Existing passenger drop-off points from the plan, excluding the
            // requesting passenger's own stop to avoid a duplicate-waypoint call.
            const passengerBookingId = passengerBookingByTripId.get(trip.id);
            const existingWaypoints = sortedLegs
              .filter(l => l.passengerDropOffId !== null && l.passengerDropOffId !== passengerBookingId)
              .map(l => ({ lat: Number(l.endLat), lng: Number(l.endLng) }));

            const allWaypoints = [origin, ...existingWaypoints, { lat: destLat, lng: destLng }, finalDest];
            const { durationSeconds } = await this.directionsService.getRoute(allWaypoints, new Date(trip.departureTime));
            const detourSeconds = durationSeconds - plan.totalDurationSeconds;
            const detourMinutes = Math.round(detourSeconds / 60);

            if (detourMinutes <= trip.maxDetourMinutes) {
              return { ...trip, matchType: 'detour', detourMinutes } as TripSearchResult;
            }
            return null;
          } catch {
            return null;
          }
        }),
      )
    ).filter((x): x is TripSearchResult => x !== null);

    const combined: TripSearchResult[] = [...nonDetourResults, ...detourResults];

    combined.sort((a, b) => {
      const order: Record<string, number> = { exact: 0, detour: 1, near: 2 };
      const aOrder = order[a.matchType] ?? 3;
      const bOrder = order[b.matchType] ?? 3;
      if (aOrder !== bOrder) return aOrder - bOrder;
      if (a.matchType === 'detour') return (a.detourMinutes ?? 0) - (b.detourMinutes ?? 0);
      return (a.distanceToDestination ?? 0) - (b.distanceToDestination ?? 0);
    });

    return combined;
  }

  async getStopsCoverage(
    stops: Array<{ id: string; lat: number; lng: number }>,
  ): Promise<Array<{ id: string; covered: boolean }>> {
    // B-2: process in batches of 5 to avoid 50 simultaneous DB connections
    const BATCH_SIZE = 5;
    const results: Array<{ id: string; covered: boolean }> = [];

    for (let i = 0; i < stops.length; i += BATCH_SIZE) {
      const batch = stops.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async stop => {
          // M-2: EXISTS-style query — limit(1) + getRawOne avoids a full COUNT scan
          // Join the active plan so we can filter by plan."polylineGeom"
          // (trip."routePolyline" was dropped in migration 1745900000000).
          const row = await this.tripsRepository.createQueryBuilder('trip')
            .select('1')
            .leftJoin('trip.currentRoutePlan', 'plan')
            .where('trip.status = :status', { status: TripStatus.SCHEDULED })
            .andWhere('trip.availableSeats > 0')
            .andWhere('trip.departureTime > :now', { now: new Date() })
            .andWhere(...this.geoService.getDWithinCondition('plan."polylineGeom"', stop.lat, stop.lng, 600, 'stop'))
            .limit(1)
            .getRawOne();
          return { id: stop.id, covered: !!row };
        }),
      );
      results.push(...batchResults);
    }

    return results;
  }

  async findOne(tripId: string): Promise<Trip> {
    const trip = await this.tripsRepository.findOne({
      where: { id: tripId },
      relations: ['driver'],
    });
    if (!trip) throw new NotFoundException('Viaje no encontrado');
    return trip;
  }

  async startTrip(tripId: string, driverId: string): Promise<Trip> {
    const trip = await this.tripsRepository.findOne({
      where: { id: tripId },
      relations: ['driver', 'bookings', 'bookings.passenger'],
    });

    if (!trip) throw new NotFoundException('Viaje no encontrado');
    if (trip.driver.id !== driverId) throw new ForbiddenException('Solo el conductor puede iniciar el viaje');
    TripStateMachine.assertTransition(trip.status, TripStatus.ACTIVE);

    const minutesLate = (new Date().getTime() - new Date(trip.departureTime).getTime()) / 60000;
    if (minutesLate < 0) throw new BadRequestException('Aún no es la hora de salida');

    const missingPassengers = trip.bookings.some(b => b.status === BookingStatus.ACCEPTED && !b.isBoarded);
    if (missingPassengers && minutesLate < 5) {
      throw new BadRequestException('Debes esperar 5 minutos o a que todos suban.');
    }

    trip.status = TripStatus.ACTIVE;
    const saved = await this.tripsRepository.save(trip);

    for (const booking of trip.bookings) {
      if (booking.status === BookingStatus.ACCEPTED) {
        this.notificationsService.notifyPassengerTripStarted(booking.passenger.id, { tripId });
      }
    }

    return saved;
  }

  async finishTrip(tripId: string, driverId: string): Promise<Trip> {
    const trip = await this.tripsRepository.findOne({
      where: { id: tripId },
      relations: ['driver', 'bookings', 'bookings.passenger'],
    });

    if (!trip) throw new NotFoundException('Viaje no encontrado');
    if (trip.driver.id !== driverId) throw new ForbiddenException('Solo el conductor puede finalizar el viaje');
    TripStateMachine.assertTransition(trip.status, TripStatus.COMPLETED);

    trip.status = TripStatus.COMPLETED;
    const saved = await this.tripsRepository.save(trip);

    // P-3: UpdateQueryBuilder cannot JOIN relations in WHERE — reference the FK column directly
    await this.bookingsRepository.createQueryBuilder()
      .update(Booking)
      .set({ status: BookingStatus.COMPLETED })
      .where('"tripId" = :tripId', { tripId })
      .andWhere('status = :status', { status: BookingStatus.ACCEPTED })
      .execute();

    for (const booking of trip.bookings) {
      if (booking.status === BookingStatus.ACCEPTED) {
        this.notificationsService.notifyPassengerTripFinished(booking.passenger.id, { tripId });
      }
    }

    return saved;
  }

  // H-5: paginated to prevent unbounded result sets
  async getMyTrips(driverId: string, page = 1, limit = 20): Promise<Trip[]> {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(Math.max(1, limit), 50);
    return this.tripsRepository.find({
      where: { driver: { id: driverId } },
      relations: ['bookings', 'bookings.passenger'],
      order: { departureTime: 'DESC' },
      take: safeLimit,
      skip: (safePage - 1) * safeLimit,
    });
  }

  // Triggered every minute by MaintenanceProcessor (BullMQ scheduler).
  // Was @Cron('* * * * *') before Phase 1 — moving the trigger to BullMQ
  // means only one instance fires per tick cluster-wide, so we no longer
  // double-cancel trips when running >1 backend pod.
  async autoCancelEmptyTrips(): Promise<void> {
    try {
      const overdueTrips = await this.tripsRepository.find({
        where: { status: TripStatus.SCHEDULED, departureTime: LessThan(new Date()) },
        relations: ['bookings', 'bookings.passenger', 'driver'],
      });

      for (const trip of overdueTrips) {
        const hasAccepted = trip.bookings.some(b => b.status === BookingStatus.ACCEPTED);
        if (!hasAccepted) {
          this.logger.log(`Auto-canceling empty trip ${trip.id} (no accepted passengers)`);

          // Cancel any still-pending bookings and notify those passengers
          const pendingBookings = trip.bookings.filter(b => b.status === BookingStatus.PENDING);
          for (const booking of pendingBookings) {
            booking.status = BookingStatus.CANCELED;
            await this.bookingsRepository.save(booking);
            try {
              this.notificationsService.notifyPassengerTripCanceled(booking.passenger.id, { tripId: trip.id });
            } catch (notifyErr) {
              this.logger.warn(`Notification failed for pending booking ${booking.id} on canceled trip ${trip.id}: ${notifyErr.message}`);
            }
          }

          trip.status = TripStatus.CANCELED;
          await this.tripsRepository.save(trip);
          try {
            this.notificationsService.notifyDriverTripAutoCanceled(trip.driver.id, { tripId: trip.id });
          } catch (notifyErr) {
            this.logger.warn(`Notification failed for auto-canceled trip ${trip.id}: ${notifyErr.message}`);
          }
        }
      }
    } catch (err) {
      this.logger.error('autoCancelEmptyTrips failed', err);
    }
  }

  // Triggered every minute by MaintenanceProcessor (BullMQ scheduler). See
  // autoCancelEmptyTrips above for the rationale on the move from @Cron.
  async autoRemoveNoShows(): Promise<void> {
    try {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const trips = await this.tripsRepository.find({
        where: { status: TripStatus.SCHEDULED, departureTime: LessThan(fiveMinutesAgo) },
        relations: ['bookings', 'bookings.passenger', 'driver'],
      });

      for (const trip of trips) {
        const noShows = trip.bookings.filter(
          b => b.status === BookingStatus.ACCEPTED && !b.isBoarded,
        );
        for (const booking of noShows) {
          this.logger.log(`Auto-removing no-show booking ${booking.id} for trip ${trip.id}`);
          booking.status = BookingStatus.CANCELED;
          await this.bookingsRepository.save(booking);

          // A-1: restore the seat — was missing, causing a permanent seat leak
          await this.tripsRepository
            .createQueryBuilder()
            .update(Trip)
            .set({ availableSeats: () => '"availableSeats" + 1' })
            .where('id = :id', { id: trip.id })
            .execute();

          try {
            this.notificationsService.notifyPassengerNoShow(booking.passenger.id, { bookingId: booking.id });
            this.notificationsService.notifyDriverBookingCanceled(trip.driver.id, {
              bookingId: booking.id,
              tripId: trip.id,
              passengerName: booking.passenger.name,
            });
          } catch (notifyErr) {
            this.logger.warn(`Notification failed for no-show booking ${booking.id}: ${notifyErr.message}`);
          }
        }
      }
    } catch (err) {
      this.logger.error('autoRemoveNoShows failed', err);
    }
  }

  async getClosestPoint(
    tripId: string,
    destLat: number,
    destLng: number,
    passengerId?: string,
  ): Promise<{ latitude: number; longitude: number; routeToDropoff: { latitude: number; longitude: number }[]; isDetour: boolean }> {
    // Load plan + legs upfront so previewRouteWithDetour (detour path) can
    // derive origin/dest/existing-stops without another DB round-trip.
    const trip = await this.tripsRepository.findOne({
      where: { id: tripId },
      relations: ['currentRoutePlan', 'currentRoutePlan.legs'],
    });
    if (!trip) throw new NotFoundException('Viaje no encontrado');

    if (trip.detourEnabled) {
      return this.previewRouteWithDetour(trip, destLat, destLng, passengerId);
    }

    // Non-detour: use the plan's polylineGeom for PostGIS calculations.
    // trip."routePolyline" was dropped in migration 1745900000000.
    if (!trip.currentRoutePlanId) throw new NotFoundException('No se pudo calcular el punto');

    const result = await this.tripsRepository.query(
      `WITH geom AS (
          SELECT "polylineGeom" AS line
          FROM trip_route_plans
          WHERE id = $1
        )
        SELECT
          ST_AsGeoJSON(
            ST_ClosestPoint(
              (SELECT line FROM geom)::geometry,
              ST_SetSRID(ST_MakePoint($3, $2), 4326)::geometry
            )
          ) AS closest_point,
          ST_AsGeoJSON(
            ST_LineSubstring(
              (SELECT line FROM geom)::geometry,
              0,
              ST_LineLocatePoint(
                (SELECT line FROM geom)::geometry,
                ST_ClosestPoint(
                  (SELECT line FROM geom)::geometry,
                  ST_SetSRID(ST_MakePoint($3, $2), 4326)::geometry
                )
              )
            )
          ) AS route_to_dropoff`,
      [trip.currentRoutePlanId, destLat, destLng],
    );
    if (!result?.[0]?.closest_point) throw new NotFoundException('No se pudo calcular el punto');
    const dropoff = JSON.parse(result[0].closest_point);
    const routeGeo = JSON.parse(result[0].route_to_dropoff);
    return {
      latitude: dropoff.coordinates[1],
      longitude: dropoff.coordinates[0],
      routeToDropoff: routeGeo.coordinates.map((c: number[]) => ({
        latitude: c[1],
        longitude: c[0],
      })),
      isDetour: false,
    };
  }

  /**
   * Computes a route-preview for a detour booking request.
   *
   * Origin / finalDest / existing stops are all derived from the trip's
   * current active TripRoutePlan legs (plan must already be loaded on `trip`
   * via the caller's `findOne` with relations). The requesting passenger's
   * existing stop is excluded from the intermediate list to avoid feeding
   * Routes API a duplicate waypoint when the same passenger previews twice.
   */
  private async previewRouteWithDetour(
    trip: Trip,
    destLat: number,
    destLng: number,
    passengerId?: string,
  ): Promise<{ latitude: number; longitude: number; routeToDropoff: { latitude: number; longitude: number }[]; isDetour: boolean }> {
    const plan = trip.currentRoutePlan;
    if (!plan?.legs?.length) throw new NotFoundException('No se pudo calcular la ruta');

    const sortedLegs = [...plan.legs].sort((a, b) => a.legIndex - b.legIndex);
    const origin = {
      lat: Number(sortedLegs[0].startLat),
      lng: Number(sortedLegs[0].startLng),
    };
    const finalDest = {
      lat: Number(sortedLegs[sortedLegs.length - 1].endLat),
      lng: Number(sortedLegs[sortedLegs.length - 1].endLng),
    };

    // Resolve the requesting passenger's bookingId so we can exclude their
    // existing stop (null if they have no active booking on this trip yet).
    let passengerBookingId: string | null = null;
    if (passengerId) {
      const pb = await this.bookingsRepository.findOne({
        where: {
          passenger: { id: passengerId },
          trip: { id: trip.id },
          status: In([BookingStatus.PENDING, BookingStatus.ACCEPTED]),
        },
      });
      passengerBookingId = pb?.id ?? null;
    }

    const existingWaypoints = sortedLegs
      .filter(l => l.passengerDropOffId !== null && l.passengerDropOffId !== passengerBookingId)
      .map(l => ({ lat: Number(l.endLat), lng: Number(l.endLng) }));

    const allWaypoints = [origin, ...existingWaypoints, { lat: destLat, lng: destLng }, finalDest];
    const { polylinePoints } = await this.directionsService.getRoute(allWaypoints);

    // Trim the polyline to end at the passenger's drop-off
    let closestIndex = 0;
    let closestDist = Infinity;
    polylinePoints.forEach(([lat, lng], i) => {
      const dist = Math.sqrt(Math.pow(lat - destLat, 2) + Math.pow(lng - destLng, 2));
      if (dist < closestDist) {
        closestDist = dist;
        closestIndex = i;
      }
    });

    const trimmedPoints: [number, number][] = [
      ...polylinePoints.slice(0, closestIndex + 1),
      [destLat, destLng],
    ];

    return {
      latitude: destLat,
      longitude: destLng,
      routeToDropoff: trimmedPoints.map(([lat, lng]) => ({ latitude: lat, longitude: lng })),
      isDetour: true,
    };
  }

  async cancelTrip(tripId: string, driverId: string): Promise<Trip> {
    const trip = await this.tripsRepository.findOne({
      where: { id: tripId },
      relations: ['driver'],
    });

    if (!trip) throw new NotFoundException('Trip no encontrado');
    if (trip.driver.id !== driverId) throw new ForbiddenException('Solo el dueño puede cancelar el viaje');
    // Validates SCHEDULED→CANCELED or ACTIVE→CANCELED (if we ever allow mid-trip cancellation).
    // Business rule on top of the state graph: only before departure.
    TripStateMachine.assertTransition(trip.status, TripStatus.CANCELED);
    if (new Date() >= new Date(trip.departureTime))
      throw new BadRequestException('No puedes cancelar el viaje una vez que ha llegado la hora de salida');

    trip.status = TripStatus.CANCELED;

    const bookingsToCancel = await this.bookingsRepository.find({
      where: { trip: { id: tripId } },
      relations: ['passenger'],
    });

    // P-3: UpdateQueryBuilder cannot JOIN relations in WHERE — reference the FK column directly
    await this.bookingsRepository.createQueryBuilder()
      .update(Booking)
      .set({ status: BookingStatus.CANCELED })
      .where('"tripId" = :tripId', { tripId })
      .andWhere('status IN (:...statuses)', { statuses: [BookingStatus.PENDING, BookingStatus.ACCEPTED] })
      .execute();

    for (const b of bookingsToCancel) {
      if (b.passenger && (b.status === BookingStatus.PENDING || b.status === BookingStatus.ACCEPTED)) {
        this.notificationsService.notifyPassengerTripCanceled(b.passenger.id, { tripId: trip.id });
      }
    }

    return this.tripsRepository.save(trip);
  }
}

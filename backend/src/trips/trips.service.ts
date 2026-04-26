import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, LessThan, Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { Trip, TripStatus } from './entities/trip.entity';
import { CreateTripDto } from './dto/create-trip.dto';
import { UsersService } from '../users/users.service';
import { Booking, BookingStatus } from '../bookings/entities/booking.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { GeoService } from '../geo/geo.service';
import { DirectionsService } from '../geo/directions.service';

@Injectable()
export class TripsService {
  private readonly logger = new Logger(TripsService.name);

  constructor(
    @InjectRepository(Trip)
    private readonly tripsRepository: Repository<Trip>,
    @InjectRepository(Booking)
    private readonly bookingsRepository: Repository<Booking>,
    private readonly usersService: UsersService,
    private readonly notificationsService: NotificationsService,
    private readonly geoService: GeoService,
    private readonly directionsService: DirectionsService,
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

    const origin = { lat: createTripDto.route[0][0], lng: createTripDto.route[0][1] };
    const destination = {
      lat: createTripDto.route[createTripDto.route.length - 1][0],
      lng: createTripDto.route[createTripDto.route.length - 1][1],
    };

    let finalRoute = createTripDto.route;
    let originalDurationSeconds = 0;

    try {
      const { polylinePoints, durationSeconds } = await this.directionsService.getRoute([origin, destination]);
      finalRoute = polylinePoints;
      originalDurationSeconds = durationSeconds;
    } catch (e) {
      this.logger.warn(`DirectionsService falló al crear viaje, usando ruta del frontend: ${e.message}`);
    }

    const trip = this.tripsRepository.create({
      driver: user,
      routePolyline: this.geoService.createLineString(finalRoute),
      departureTime: new Date(createTripDto.departureTime),
      autoAccept: createTripDto.autoAccept || false,
      availableSeats: createTripDto.availableSeats ?? user.vehicle.capacity,
      maxDetourMinutes: createTripDto.maxDetourMinutes ?? 5,
      pricePerSeat: createTripDto.pricePerSeat ?? 0,
      meetingPoint: createTripDto.meetingPoint,
      detourEnabled: createTripDto.detourEnabled ?? false,
      originalDurationSeconds,
      status: TripStatus.SCHEDULED,
    });

    const saved = await this.tripsRepository.save(trip);
    this.notificationsService.notifyTripPublished();
    return saved;
  }

  async findAvailableTrips(lat: number, lng: number, destLat?: number, destLng?: number): Promise<any[]> {
    const buildBase = () =>
      this.tripsRepository.createQueryBuilder('trip')
        .leftJoin('trip.driver', 'driver')
        .leftJoin('driver.vehicle', 'vehicle')
        .addSelect(['driver.id', 'driver.name', 'vehicle.model', 'vehicle.color', 'vehicle.brand', 'vehicle.plate'])
        .where('trip.status = :status', { status: TripStatus.SCHEDULED })
        .andWhere('trip.availableSeats > 0')
        .andWhere('trip.departureTime > :now', { now: new Date() })
        .andWhere(this.geoService.getDWithinCondition('trip."routePolyline"', lat, lng, 500));

    if (destLat === undefined || destLng === undefined) {
      return buildBase().getMany();
    }

    // Non-detour trips: use existing distance-based matching
    const nonDetourQb = buildBase()
      .andWhere('trip.detourEnabled = :detour', { detour: false })
      .addSelect(
        `ST_Distance(trip."routePolyline"::geography, ST_SetSRID(ST_MakePoint(${destLng}, ${destLat}), 4326)::geography)`,
        'distanceToDestination',
      )
      .andWhere(this.geoService.getDWithinCondition('trip."routePolyline"', destLat, destLng, 800));

    // Detour-enabled trips: origin filter only, dest filter done via Directions API
    const detourQb = buildBase()
      .andWhere('trip.detourEnabled = :detour', { detour: true });

    const [{ entities: nonDetourEntities, raw: nonDetourRaw }, detourTrips] = await Promise.all([
      nonDetourQb.getRawAndEntities(),
      detourQb.getMany(),
    ]);

    const nonDetourResults = nonDetourEntities.map((entity, i) => {
      const dist = parseFloat(nonDetourRaw[i].distanceToDestination ?? '9999');
      return {
        ...entity,
        distanceToDestination: Math.round(dist),
        matchType: dist <= 200 ? 'exact' : 'near',
      };
    });

    type DetourResult = Trip & { matchType: string; detourMinutes: number };

    const detourResults = (
      await Promise.all(
        detourTrips.map(async (trip): Promise<DetourResult | null> => {
          try {
            const coords: number[][] = trip.routePolyline?.coordinates;
            if (!coords?.length || coords.length < 2) return null;

            const origin = { lat: coords[0][1], lng: coords[0][0] };
            const finalDest = { lat: coords[coords.length - 1][1], lng: coords[coords.length - 1][0] };
            const existingWaypoints = (trip.passengerWaypoints ?? []).map(w => ({ lat: w.lat, lng: w.lng }));
            const allWaypoints = [origin, ...existingWaypoints, { lat: destLat, lng: destLng }, finalDest];

            const { durationSeconds } = await this.directionsService.getRoute(allWaypoints);
            const detourSeconds = durationSeconds - trip.originalDurationSeconds;
            const detourMinutes = Math.round(detourSeconds / 60);

            if (detourMinutes <= trip.maxDetourMinutes) {
              return { ...trip, matchType: 'detour', detourMinutes };
            }
            return null;
          } catch {
            return null;
          }
        }),
      )
    ).filter((x): x is DetourResult => x !== null);

    type AnyResult = (typeof nonDetourResults[0]) | DetourResult;
    const combined: AnyResult[] = [...nonDetourResults, ...detourResults];

    combined.sort((a, b) => {
      const order: Record<string, number> = { exact: 0, detour: 1, near: 2 };
      const aOrder = order[a.matchType] ?? 3;
      const bOrder = order[b.matchType] ?? 3;
      if (aOrder !== bOrder) return aOrder - bOrder;
      const aDetour = (a as DetourResult).detourMinutes ?? 0;
      const bDetour = (b as DetourResult).detourMinutes ?? 0;
      if (a.matchType === 'detour') return aDetour - bDetour;
      const aDist = (a as typeof nonDetourResults[0]).distanceToDestination ?? 0;
      const bDist = (b as typeof nonDetourResults[0]).distanceToDestination ?? 0;
      return aDist - bDist;
    });

    return combined;
  }

  async getStopsCoverage(stops: Array<{ id: string; lat: number; lng: number }>): Promise<Array<{ id: string; covered: boolean }>> {
    return Promise.all(stops.map(async stop => {
      const count = await this.tripsRepository.createQueryBuilder('trip')
        .where('trip.status = :status', { status: TripStatus.SCHEDULED })
        .andWhere('trip.availableSeats > 0')
        .andWhere('trip.departureTime > :now', { now: new Date() })
        .andWhere(this.geoService.getDWithinCondition('trip."routePolyline"', stop.lat, stop.lng, 600))
        .getCount();
      return { id: stop.id, covered: count > 0 };
    }));
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
    if (trip.status !== TripStatus.SCHEDULED) throw new BadRequestException('El viaje no está en estado SCHEDULED');

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
    if (trip.status !== TripStatus.ACTIVE) throw new BadRequestException('El viaje no está en curso');

    trip.status = TripStatus.COMPLETED;
    const saved = await this.tripsRepository.save(trip);

    await this.bookingsRepository.createQueryBuilder()
      .update(Booking)
      .set({ status: BookingStatus.COMPLETED })
      .where('trip.id = :tripId', { tripId })
      .andWhere('status = :status', { status: BookingStatus.ACCEPTED })
      .execute();

    for (const booking of trip.bookings) {
      if (booking.status === BookingStatus.ACCEPTED) {
        this.notificationsService.notifyPassengerTripFinished(booking.passenger.id, { tripId });
      }
    }

    return saved;
  }

  async getMyTrips(driverId: string): Promise<Trip[]> {
    return this.tripsRepository.find({
      where: { driver: { id: driverId } },
      relations: ['bookings', 'bookings.passenger'],
      order: { departureTime: 'DESC' },
    });
  }

  @Cron('* * * * *')
  async autoCancelEmptyTrips(): Promise<void> {
    const overdueTrips = await this.tripsRepository.find({
      where: { status: TripStatus.SCHEDULED, departureTime: LessThan(new Date()) },
      relations: ['bookings', 'driver'],
    });

    for (const trip of overdueTrips) {
      const hasAccepted = trip.bookings.some(b => b.status === BookingStatus.ACCEPTED);
      if (!hasAccepted) {
        trip.status = TripStatus.CANCELED;
        await this.tripsRepository.save(trip);
        this.notificationsService.notifyDriverTripAutoCanceled(trip.driver.id, { tripId: trip.id });
      }
    }
  }

  async getClosestPoint(
    tripId: string,
    destLat: number,
    destLng: number,
  ): Promise<{ latitude: number; longitude: number; routeToDropoff: { latitude: number; longitude: number }[]; isDetour: boolean }> {
    const trip = await this.tripsRepository.findOne({ where: { id: tripId } });
    if (!trip) throw new NotFoundException('Viaje no encontrado');

    if (trip.detourEnabled) {
      return this.previewRouteWithDetour(trip, destLat, destLng);
    }

    const result = await this.tripsRepository.query(
      `SELECT
          ST_AsGeoJSON(
            ST_ClosestPoint(
              (SELECT "routePolyline" FROM trips WHERE id = $1)::geometry,
              ST_SetSRID(ST_MakePoint($3, $2), 4326)::geometry
            )
          ) AS closest_point,
          ST_AsGeoJSON(
            ST_LineSubstring(
              (SELECT "routePolyline" FROM trips WHERE id = $1)::geometry,
              0,
              ST_LineLocatePoint(
                (SELECT "routePolyline" FROM trips WHERE id = $1)::geometry,
                ST_ClosestPoint(
                  (SELECT "routePolyline" FROM trips WHERE id = $1)::geometry,
                  ST_SetSRID(ST_MakePoint($3, $2), 4326)::geometry
                )
              )
            )
          ) AS route_to_dropoff`,
      [tripId, destLat, destLng],
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

  private async previewRouteWithDetour(
    trip: Trip,
    destLat: number,
    destLng: number,
  ): Promise<{ latitude: number; longitude: number; routeToDropoff: { latitude: number; longitude: number }[]; isDetour: boolean }> {
    const coords: number[][] = trip.routePolyline?.coordinates;
    if (!coords?.length || coords.length < 2) throw new NotFoundException('No se pudo calcular la ruta');

    const origin = { lat: coords[0][1], lng: coords[0][0] };
    const finalDest = { lat: coords[coords.length - 1][1], lng: coords[coords.length - 1][0] };
    const existingWaypoints = (trip.passengerWaypoints ?? []).map(w => ({ lat: w.lat, lng: w.lng }));
    const allWaypoints = [origin, ...existingWaypoints, { lat: destLat, lng: destLng }, finalDest];

    const { polylinePoints } = await this.directionsService.getRoute(allWaypoints);

    // Encontrar el punto del polyline MÁS CERCANO al destino del pasajero
    let closestIndex = 0;
    let closestDist = Infinity;
    polylinePoints.forEach(([lat, lng], i) => {
      const dist = Math.sqrt(Math.pow(lat - destLat, 2) + Math.pow(lng - destLng, 2));
      if (dist < closestDist) {
        closestDist = dist;
        closestIndex = i;
      }
    });

    // Recortar hasta ese punto e incluir el destino exacto del pasajero al final
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
      relations: ['driver']
    });

    if (!trip) throw new NotFoundException('Trip no encontrado');
    if (trip.driver.id !== driverId) throw new ForbiddenException('Solo el dueño puede cancelar el viaje');
    if (new Date() >= new Date(trip.departureTime))
      throw new BadRequestException('No puedes cancelar el viaje una vez que ha llegado la hora de salida');

    trip.status = TripStatus.CANCELED;

    const bookingsToCancel = await this.bookingsRepository.find({
      where: { trip: { id: tripId } },
      relations: ['passenger']
    });

    await this.bookingsRepository.createQueryBuilder()
      .update(Booking)
      .set({ status: BookingStatus.CANCELED })
      .where("trip.id = :tripId", { tripId })
      .andWhere("status IN (:...statuses)", { statuses: [BookingStatus.PENDING, BookingStatus.ACCEPTED] })
      .execute();

    for (const b of bookingsToCancel) {
      if (b.passenger && (b.status === BookingStatus.PENDING || b.status === BookingStatus.ACCEPTED)) {
        this.notificationsService.notifyPassengerTripCanceled(b.passenger.id, { tripId: trip.id });
      }
    }

    return this.tripsRepository.save(trip);
  }
}

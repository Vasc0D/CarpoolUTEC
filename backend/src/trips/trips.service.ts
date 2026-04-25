import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, LessThan, Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { Trip, TripStatus } from './entities/trip.entity';
import { CreateTripDto } from './dto/create-trip.dto';
import { UsersService } from '../users/users.service';
import { Booking, BookingStatus } from '../bookings/entities/booking.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { GeoService } from '../geo/geo.service';

@Injectable()
export class TripsService {
  constructor(
    @InjectRepository(Trip)
    private readonly tripsRepository: Repository<Trip>,
    @InjectRepository(Booking)
    private readonly bookingsRepository: Repository<Booking>,
    private readonly usersService: UsersService,
    private readonly notificationsService: NotificationsService,
    private readonly geoService: GeoService,
  ) { }

  async create(userId: string, createTripDto: CreateTripDto): Promise<Trip> {
    const user = await this.usersService.findByIdWithVehicle(userId);

    // Regla: Debe tener vehículo para publicar viaje
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

    const trip = this.tripsRepository.create({
      driver: user,
      routePolyline: this.geoService.createLineString(createTripDto.route),
      departureTime: new Date(createTripDto.departureTime),
      autoAccept: createTripDto.autoAccept || false,
      availableSeats: createTripDto.availableSeats ?? user.vehicle.capacity,
      maxDetourMinutes: createTripDto.maxDetourMinutes ?? 5,
      pricePerSeat: createTripDto.pricePerSeat ?? 0,
      meetingPoint: createTripDto.meetingPoint,
      status: TripStatus.SCHEDULED,
    });
    // TODO: Integrar Google Maps Directions API para obtener el Polyline real de la ruta antes de guardar.

    return this.tripsRepository.save(trip);
  }

  async findAvailableTrips(lat: number, lng: number, destLat?: number, destLng?: number): Promise<any[]> {
    const qb = this.tripsRepository.createQueryBuilder('trip')
      .leftJoin('trip.driver', 'driver')
      .leftJoin('driver.vehicle', 'vehicle')
      .addSelect(['driver.id', 'driver.name', 'vehicle.model', 'vehicle.color', 'vehicle.brand', 'vehicle.plate'])
      .where('trip.status = :status', { status: TripStatus.SCHEDULED })
      .andWhere('trip.availableSeats > 0')
      .andWhere('trip.departureTime > :now', { now: new Date() })
      .andWhere(this.geoService.getDWithinCondition('trip."routePolyline"', lat, lng, 500));

    if (destLat !== undefined && destLng !== undefined) {
      qb.addSelect(
        `ST_Distance(trip."routePolyline"::geography, ST_SetSRID(ST_MakePoint(${destLng}, ${destLat}), 4326)::geography)`,
        'distanceToDestination',
      ).andWhere(this.geoService.getDWithinCondition('trip."routePolyline"', destLat, destLng, 800));

      const { entities, raw } = await qb.getRawAndEntities();

      const result = entities.map((entity, i) => {
        const dist = parseFloat(raw[i].distanceToDestination ?? '9999');
        return {
          ...entity,
          distanceToDestination: Math.round(dist),
          matchType: dist <= 200 ? 'exact' : 'near',
        };
      });

      result.sort((a, b) => {
        if (a.matchType !== b.matchType) return a.matchType === 'exact' ? -1 : 1;
        return a.distanceToDestination - b.distanceToDestination;
      });

      return result;
    }

    return qb.getMany();
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
      relations: ['bookings'],
    });

    for (const trip of overdueTrips) {
      const hasAccepted = trip.bookings.some(b => b.status === BookingStatus.ACCEPTED);
      if (!hasAccepted) {
        trip.status = TripStatus.CANCELED;
        await this.tripsRepository.save(trip);
      }
    }
  }

  async getClosestPoint(
    tripId: string,
    destLat: number,
    destLng: number,
  ): Promise<{ latitude: number; longitude: number; routeToDropoff: { latitude: number; longitude: number }[] }> {
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
    };
  }

  async cancelTrip(tripId: string, driverId: string): Promise<Trip> {
    const trip = await this.tripsRepository.findOne({
      where: { id: tripId },
      relations: ['driver']
    });

    if (!trip) throw new NotFoundException('Trip no encontrado');
    if (trip.driver.id !== driverId) throw new ForbiddenException('Solo el dueño puede cancelar el viaje');

    trip.status = TripStatus.CANCELED;

    // TODO: Implementar sistema de penalidad por cancelar viajes programados.

    // Cancelación en Cascada
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

    // Notificar a todos los pasajeros en tiempo real
    for (const b of bookingsToCancel) {
      if (b.passenger && (b.status === BookingStatus.PENDING || b.status === BookingStatus.ACCEPTED)) {
        this.notificationsService.notifyPassengerTripCanceled(b.passenger.id, { tripId: trip.id });
      }
    }

    return this.tripsRepository.save(trip);
  }
}

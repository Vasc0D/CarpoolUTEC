import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
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
      meetingPoint: createTripDto.meetingPoint,
      status: TripStatus.SCHEDULED,
    });
    // TODO: Integrar Google Maps Directions API para obtener el Polyline real de la ruta antes de guardar.

    return this.tripsRepository.save(trip);
  }

  async findAvailableTrips(lat: number, lng: number): Promise<any[]> {
    return this.tripsRepository.createQueryBuilder('trip')
      .leftJoin('trip.driver', 'driver')
      .leftJoin('driver.vehicle', 'vehicle')
      .addSelect(['driver.id', 'driver.name', 'vehicle.model', 'vehicle.color'])
      .where('trip.status = :status', { status: TripStatus.SCHEDULED })
      .andWhere('trip.availableSeats > 0')
      .andWhere(this.geoService.getDWithinCondition('trip."routePolyline"', lat, lng, 500))
      .getMany();
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
    if (new Date() < new Date(trip.departureTime)) throw new BadRequestException('Aún no es la hora de salida');

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

import { Injectable, NotFoundException, BadRequestException, ConflictException, ForbiddenException, GoneException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Booking, BookingStatus } from './entities/booking.entity';
import { Trip, TripStatus } from '../trips/entities/trip.entity';
import { UsersService } from '../users/users.service';
import { BookingResponseDto } from './dto/booking-response.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { DirectionsService } from '../geo/directions.service';
import { GeoService } from '../geo/geo.service';

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    @InjectRepository(Booking)
    private readonly bookingsRepository: Repository<Booking>,
    @InjectRepository(Trip)
    private readonly tripsRepository: Repository<Trip>,
    private readonly usersService: UsersService,
    private readonly notificationsService: NotificationsService,
    private readonly directionsService: DirectionsService,
    private readonly geoService: GeoService,
  ) { }

  async solicitSeat(tripId: string, passengerId: string, destLat?: number, destLng?: number): Promise<BookingResponseDto> {
    const trip = await this.tripsRepository.findOne({
      where: { id: tripId },
      relations: ['driver']
    });

    if (!trip) throw new NotFoundException('El viaje no existe');
    if (trip.status !== TripStatus.SCHEDULED) throw new GoneException('Este viaje ya no está disponible');
    if (trip.availableSeats === 0) throw new BadRequestException('El viaje ya está lleno');
    if (trip.driver.id === passengerId) throw new BadRequestException('No puedes reservar tu propio viaje');

    const activeBooking = await this.bookingsRepository.findOne({
      where: {
        passenger: { id: passengerId },
        status: In([BookingStatus.PENDING, BookingStatus.ACCEPTED]),
      },
    });

    if (activeBooking) {
      throw new ConflictException('Ya tienes una reserva activa. Cancélala antes de pedir otro viaje.');
    }

    const passenger = await this.usersService.findById(passengerId);
    if (!passenger) throw new NotFoundException('Pasajero no encontrado');

    const isAutoAccept = trip.autoAccept;
    const booking = this.bookingsRepository.create({
      trip,
      passenger,
      status: isAutoAccept ? BookingStatus.ACCEPTED : BookingStatus.PENDING,
      destLat: destLat ?? null,
      destLng: destLng ?? null,
    });

    if (isAutoAccept) {
      trip.availableSeats -= 1;
      await this.tripsRepository.save(trip);

      if (trip.detourEnabled && destLat != null && destLng != null) {
        await this.recalculateRoute(trip, passengerId, destLat, destLng);
      }
    }

    const savedBooking = await this.bookingsRepository.save(booking);

    this.notificationsService.notifyDriverNewRequest(trip.driver.id, {
      bookingId: savedBooking.id,
      passengerId,
      passengerName: passenger.name,
      tripId,
      autoAccepted: isAutoAccept,
    });

    return this.mapToResponseDto(savedBooking);
  }

  async acceptBooking(bookingId: string, driverId: string): Promise<BookingResponseDto> {
    const booking = await this.bookingsRepository.findOne({
      where: { id: bookingId },
      relations: ['trip', 'trip.driver', 'passenger']
    });

    if (!booking) throw new NotFoundException('Reserva no encontrada');
    if (booking.trip.driver.id !== driverId) throw new ForbiddenException('Solo el conductor puede aceptar reservas');
    if (booking.status !== BookingStatus.PENDING) throw new BadRequestException('La reserva no está pendiente');
    if (booking.trip.availableSeats === 0) throw new BadRequestException('El viaje ya está lleno');

    booking.status = BookingStatus.ACCEPTED;
    booking.trip.availableSeats -= 1;

    await this.tripsRepository.save(booking.trip);

    const destLat = booking.destLat != null ? Number(booking.destLat) : null;
    const destLng = booking.destLng != null ? Number(booking.destLng) : null;

    if (booking.trip.detourEnabled && destLat != null && destLng != null) {
      await this.recalculateRoute(booking.trip, booking.passenger.id, destLat, destLng);
    }

    const savedBooking = await this.bookingsRepository.save(booking);

    this.notificationsService.notifyPassengerStatusChange(booking.passenger.id, {
      bookingId: savedBooking.id,
      status: savedBooking.status
    });

    return this.mapToResponseDto(savedBooking);
  }

  private async recalculateRoute(trip: Trip, passengerId: string, destLat: number, destLng: number): Promise<void> {
    try {
      const coords: number[][] = trip.routePolyline?.coordinates;
      if (!coords?.length || coords.length < 2) return;

      const origin = { lat: coords[0][1], lng: coords[0][0] };
      const finalDest = { lat: coords[coords.length - 1][1], lng: coords[coords.length - 1][0] };
      const existingWaypoints = (trip.passengerWaypoints ?? []).map(w => ({ lat: w.lat, lng: w.lng }));
      const allWaypoints = [origin, ...existingWaypoints, { lat: destLat, lng: destLng }, finalDest];

      const { polylinePoints } = await this.directionsService.getRoute(allWaypoints);
      trip.routePolyline = this.geoService.createLineString(polylinePoints);
      trip.passengerWaypoints = [
        ...(trip.passengerWaypoints ?? []),
        { passengerId, lat: destLat, lng: destLng },
      ];
      await this.tripsRepository.save(trip);
    } catch (e) {
      this.logger.error(`Error recalculando ruta para viaje ${trip.id}: ${e.message}`);
    }
  }

  async rejectBooking(bookingId: string, driverId: string): Promise<BookingResponseDto> {
    const booking = await this.bookingsRepository.findOne({
      where: { id: bookingId },
      relations: ['trip', 'trip.driver', 'passenger']
    });

    if (!booking) throw new NotFoundException('Reserva no encontrada');
    if (booking.trip.driver.id !== driverId) throw new ForbiddenException('Solo el conductor puede rechazar');

    if (booking.status === BookingStatus.ACCEPTED) {
      throw new ForbiddenException('No puedes rechazar a un pasajero que ya ha sido aceptado. El compromiso está hecho.');
    }

    if (booking.status === BookingStatus.PENDING) {
      booking.status = BookingStatus.REJECTED;
    }

    const savedBooking = await this.bookingsRepository.save(booking);

    this.notificationsService.notifyPassengerStatusChange(booking.passenger.id, {
      bookingId: savedBooking.id,
      status: savedBooking.status
    });

    return this.mapToResponseDto(savedBooking);
  }

  async cancelBooking(bookingId: string, passengerId: string): Promise<BookingResponseDto> {
    const booking = await this.bookingsRepository.findOne({
      where: { id: bookingId },
      relations: ['trip', 'passenger'],
    });

    if (!booking) throw new NotFoundException('Reserva no encontrada');
    if (booking.passenger.id !== passengerId)
      throw new ForbiddenException('No puedes cancelar una reserva que no es tuya');
    if ([BookingStatus.CANCELED, BookingStatus.REJECTED].includes(booking.status))
      throw new BadRequestException('No puedes cancelar esta reserva');

    const wasAccepted = booking.status === BookingStatus.ACCEPTED;
    booking.status = BookingStatus.CANCELED;

    if (wasAccepted) {
      booking.trip.availableSeats += 1;
      await this.tripsRepository.save(booking.trip);
    }

    return this.mapToResponseDto(await this.bookingsRepository.save(booking));
  }

  async confirmBoarding(bookingId: string, passengerId: string): Promise<BookingResponseDto> {
    const booking = await this.bookingsRepository.findOne({
      where: { id: bookingId },
      relations: ['trip', 'trip.driver', 'passenger'],
    });

    if (!booking) throw new NotFoundException('Reserva no encontrada');
    if (booking.passenger.id !== passengerId)
      throw new ForbiddenException('Esta reserva no te pertenece');
    if (booking.status !== BookingStatus.ACCEPTED)
      throw new BadRequestException('Solo puedes confirmar subida en una reserva aceptada');

    booking.isBoarded = true;
    const saved = await this.bookingsRepository.save(booking);
    this.notificationsService.notifyDriverPassengerBoarded(booking.trip.driver.id, { bookingId: saved.id });
    return this.mapToResponseDto(saved);
  }

  async markNoShow(bookingId: string, driverId: string): Promise<BookingResponseDto> {
    const booking = await this.bookingsRepository.findOne({
      where: { id: bookingId },
      relations: ['trip', 'trip.driver', 'passenger'],
    });

    if (!booking) throw new NotFoundException('Reserva no encontrada');
    if (booking.trip.driver.id !== driverId)
      throw new ForbiddenException('Solo el conductor puede marcar ausentes');
    if (booking.status !== BookingStatus.ACCEPTED)
      throw new BadRequestException('Solo se pueden marcar como ausentes reservas aceptadas');

    booking.status = BookingStatus.CANCELED;
    booking.trip.availableSeats += 1;
    await this.tripsRepository.save(booking.trip);

    const saved = await this.bookingsRepository.save(booking);
    this.notificationsService.notifyPassengerNoShow(booking.passenger.id, { bookingId: saved.id });
    return this.mapToResponseDto(saved);
  }

  async getMyBookings(passengerId: string): Promise<BookingResponseDto[]> {
    const bookings = await this.bookingsRepository.find({
      where: { passenger: { id: passengerId } },
      relations: ['trip', 'trip.driver', 'trip.driver.vehicle', 'passenger'],
      order: { createdAt: 'DESC' }
    });

    return bookings.map(b => this.mapToResponseDto(b));
  }

  private mapToResponseDto(booking: Booking): BookingResponseDto {
    return {
      id: booking.id,
      status: booking.status,
      isBoarded: booking.isBoarded,
      trip: {
        id: booking.trip.id,
        origin: booking.trip.routePolyline?.coordinates?.[0] || null,
        destination: booking.trip.routePolyline?.coordinates?.[booking.trip.routePolyline?.coordinates?.length - 1] || null,
        departureTime: booking.trip.departureTime,
        driver: {
          id: booking.trip.driver?.id,
          name: booking.trip.driver?.name,
          vehicle: booking.trip.driver?.vehicle ? {
            brand: booking.trip.driver.vehicle.brand,
            model: booking.trip.driver.vehicle.model,
            color: booking.trip.driver.vehicle.color,
            plate: booking.trip.driver.vehicle.plate,
          } : null,
        }
      },
      passenger: {
        id: booking.passenger?.id,
        name: booking.passenger?.name,
      },
      createdAt: booking.createdAt,
    };
  }
}

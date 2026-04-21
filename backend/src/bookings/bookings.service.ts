import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Booking, BookingStatus } from './entities/booking.entity';
import { Trip } from '../trips/entities/trip.entity';
import { UsersService } from '../users/users.service';
import { BookingResponseDto } from './dto/booking-response.dto';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class BookingsService {
  constructor(
    @InjectRepository(Booking)
    private readonly bookingsRepository: Repository<Booking>,
    @InjectRepository(Trip)
    private readonly tripsRepository: Repository<Trip>,
    private readonly usersService: UsersService,
    private readonly notificationsService: NotificationsService,
  ) { }

  async solicitSeat(tripId: string, passengerId: string): Promise<BookingResponseDto> {
    const trip = await this.tripsRepository.findOne({
      where: { id: tripId },
      relations: ['driver']
    });

    if (!trip) throw new NotFoundException('El viaje no existe');
    if (trip.availableSeats === 0) throw new BadRequestException('El viaje ya está lleno');
    if (trip.driver.id === passengerId) throw new BadRequestException('No puedes reservar tu propio viaje');

    const passenger = await this.usersService.findById(passengerId);
    if (!passenger) throw new NotFoundException('Pasajero no encontrado');

    const isAutoAccept = trip.autoAccept;
    const booking = this.bookingsRepository.create({
      trip,
      passenger,
      status: isAutoAccept ? BookingStatus.ACCEPTED : BookingStatus.PENDING,
    });

    if (isAutoAccept) {
      trip.availableSeats -= 1;
      await this.tripsRepository.save(trip);
    }

    const savedBooking = await this.bookingsRepository.save(booking);

    if (!isAutoAccept) {
      this.notificationsService.notifyDriverNewRequest(trip.driver.id, {
        bookingId: savedBooking.id,
        passengerId,
        tripId,
      });
    }

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
    const savedBooking = await this.bookingsRepository.save(booking);

    // Integración Real-Time
    this.notificationsService.notifyPassengerStatusChange(booking.passenger.id, {
      bookingId: savedBooking.id,
      status: savedBooking.status
    });

    return this.mapToResponseDto(savedBooking);
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

    // Integración Real-Time
    this.notificationsService.notifyPassengerStatusChange(booking.passenger.id, {
      bookingId: savedBooking.id,
      status: savedBooking.status
    });

    return this.mapToResponseDto(savedBooking);
  }

  async getMyBookings(passengerId: string): Promise<BookingResponseDto[]> {
    const bookings = await this.bookingsRepository.find({
      where: { passenger: { id: passengerId } },
      relations: ['trip', 'trip.driver', 'passenger'],
      order: { createdAt: 'DESC' }
    });

    return bookings.map(b => this.mapToResponseDto(b));
  }

  private mapToResponseDto(booking: Booking): BookingResponseDto {
    return {
      id: booking.id,
      status: booking.status,
      trip: {
        id: booking.trip.id,
        origin: booking.trip.routePolyline?.coordinates?.[0] || null,
        destination: booking.trip.routePolyline?.coordinates?.[booking.trip.routePolyline?.coordinates?.length - 1] || null,
        departureTime: booking.trip.departureTime,
        driver: {
          id: booking.trip.driver?.id,
          name: booking.trip.driver?.name,
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

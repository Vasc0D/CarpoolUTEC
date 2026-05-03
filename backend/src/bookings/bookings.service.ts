import {
    Injectable, NotFoundException, BadRequestException,
    ConflictException, ForbiddenException, GoneException, Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { Booking, BookingStatus } from './entities/booking.entity';
import { BookingStateMachine } from './booking-state-machine';
import { Trip, TripStatus } from '../trips/entities/trip.entity';
import { UsersService } from '../users/users.service';
import { BookingResponseDto } from './dto/booking-response.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { RouteRecalcQueue } from '../route-recalc/route-recalc.queue';

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
    private readonly dataSource: DataSource,
    private readonly routeRecalcQueue: RouteRecalcQueue,
  ) {}

  async solicitSeat(tripId: string, passengerId: string, destLat?: number, destLng?: number): Promise<BookingResponseDto> {
    const trip = await this.tripsRepository.findOne({
      where: { id: tripId },
      relations: ['driver'],
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

    // Phase 1: atomically reserve the seat and persist the booking. Wrapping
    // both in a single DB transaction means a save() failure rolls back the
    // seat decrement, and a decrement that races against another booking
    // rolls back the booking row — never an orphan seat or orphan booking.
    const savedBooking = await this.dataSource.transaction(async (manager: EntityManager) => {
      if (isAutoAccept) {
        const updateResult = await manager
          .createQueryBuilder()
          .update(Trip)
          .set({ availableSeats: () => '"availableSeats" - 1' })
          .where('id = :id AND "availableSeats" > 0', { id: trip.id })
          .execute();
        if (updateResult.affected === 0) {
          throw new BadRequestException('El viaje ya está lleno');
        }
      }
      return manager.save(Booking, manager.create(Booking, {
        trip,
        passenger,
        status: isAutoAccept ? BookingStatus.ACCEPTED : BookingStatus.PENDING,
        destLat: destLat ?? null,
        destLng: destLng ?? null,
      }));
    });

    // Phase 2: enqueue route recalc instead of running it inline. Returning
    // immediately gets the user a sub-100ms response; the worker handles
    // Routes API latency, retries, and saga compensation if it ultimately
    // fails (cancels the booking + restores the seat + emits
    // `booking_route_failed`). Frontend updates the ETA via the
    // `route_updated` socket event when the worker succeeds.
    if (isAutoAccept && trip.detourEnabled && destLat != null && destLng != null) {
      await this.routeRecalcQueue.enqueue({
        op: 'add',
        tripId: trip.id,
        bookingId: savedBooking.id,
        passengerId,
        destLat,
        destLng,
      });
    }

    this.notificationsService.notifyDriverNewRequest(trip.driver.id, {
      bookingId: savedBooking.id,
      passengerId,
      passengerName: passenger.name,
      tripId,
      autoAccepted: isAutoAccept,
    });

    // Reload with fresh trip + current plan so mapToResponseDto reads from
    // plan.legs rather than the legacy passengerWaypoints/legDurationsSeconds.
    const freshBooking = await this.bookingsRepository.findOne({
      where: { id: savedBooking.id },
      relations: [
        'trip', 'trip.driver', 'trip.driver.vehicle', 'passenger',
        'trip.currentRoutePlan', 'trip.currentRoutePlan.legs',
      ],
    });
    return this.mapToResponseDto(freshBooking ?? savedBooking);
  }

  async acceptBooking(bookingId: string, driverId: string): Promise<BookingResponseDto> {
    const booking = await this.bookingsRepository.findOne({
      where: { id: bookingId },
      relations: ['trip', 'trip.driver', 'passenger'],
    });

    if (!booking) throw new NotFoundException('Reserva no encontrada');
    if (booking.trip.driver.id !== driverId) throw new ForbiddenException('Solo el conductor puede aceptar reservas');
    BookingStateMachine.assertTransition(booking.status, BookingStatus.ACCEPTED);

    // Phase 1: atomic seat decrement + status flip in one DB transaction.
    const savedBooking = await this.dataSource.transaction(async (manager: EntityManager) => {
      const updateResult = await manager
        .createQueryBuilder()
        .update(Trip)
        .set({ availableSeats: () => '"availableSeats" - 1' })
        .where('id = :id AND "availableSeats" > 0', { id: booking.trip.id })
        .execute();
      if (updateResult.affected === 0) {
        throw new BadRequestException('El viaje ya está lleno');
      }
      booking.status = BookingStatus.ACCEPTED;
      return manager.save(Booking, booking);
    });

    const destLat = booking.destLat != null ? Number(booking.destLat) : null;
    const destLng = booking.destLng != null ? Number(booking.destLng) : null;

    // Phase 2: enqueue route recalc so the HTTP response returns immediately.
    // The worker handles Routes API + retries; on terminal failure it cancels
    // this booking and emits `booking_route_failed` to the passenger and
    // `booking_canceled` to the driver. Frontend updates ETA via `route_updated`
    // when the worker succeeds.
    if (booking.trip.detourEnabled && destLat != null && destLng != null) {
      await this.routeRecalcQueue.enqueue({
        op: 'add',
        tripId: booking.trip.id,
        bookingId: savedBooking.id,
        passengerId: booking.passenger.id,
        destLat,
        destLng,
      });
    }

    this.notificationsService.notifyPassengerStatusChange(booking.passenger.id, {
      bookingId: savedBooking.id,
      status: 'ACCEPTED',
    });

    // Reload with fresh trip + current plan so mapToResponseDto reads from
    // plan.legs rather than the legacy passengerWaypoints/legDurationsSeconds.
    const freshBooking = await this.bookingsRepository.findOne({
      where: { id: savedBooking.id },
      relations: [
        'trip', 'trip.driver', 'trip.driver.vehicle', 'passenger',
        'trip.currentRoutePlan', 'trip.currentRoutePlan.legs',
      ],
    });
    return this.mapToResponseDto(freshBooking ?? savedBooking);
  }

  // recalculateRoute, removePassengerFromRoute and compensateAcceptedBooking
  // moved to RouteRecalcProcessor (src/route-recalc/route-recalc.processor.ts)
  // in Phase 1. The booking endpoints now enqueue work and return immediately;
  // the worker handles Routes API, retries, and saga compensation on terminal
  // failure (cancel + restore seat + emit booking_route_failed).

  async rejectBooking(bookingId: string, driverId: string): Promise<BookingResponseDto> {
    const booking = await this.bookingsRepository.findOne({
      where: { id: bookingId },
      relations: [
        'trip', 'trip.driver', 'trip.driver.vehicle', 'passenger',
        'trip.currentRoutePlan', 'trip.currentRoutePlan.legs',
      ],
    });

    if (!booking) throw new NotFoundException('Reserva no encontrada');
    if (booking.trip.driver.id !== driverId) throw new ForbiddenException('Solo el conductor puede rechazar');
    BookingStateMachine.assertTransition(booking.status, BookingStatus.REJECTED);

    booking.status = BookingStatus.REJECTED;
    const savedBooking = await this.bookingsRepository.save(booking);

    this.notificationsService.notifyPassengerStatusChange(booking.passenger.id, {
      bookingId: savedBooking.id,
      status: 'REJECTED', // narrowed literal — we just set this status above
    });

    return this.mapToResponseDto(savedBooking);
  }

  async cancelBooking(bookingId: string, passengerId: string): Promise<BookingResponseDto> {
    const booking = await this.bookingsRepository.findOne({
      where: { id: bookingId },
      relations: [
        'trip', 'trip.driver', 'passenger',
        'trip.currentRoutePlan', 'trip.currentRoutePlan.legs',
      ],
    });

    if (!booking) throw new NotFoundException('Reserva no encontrada');
    if (booking.passenger.id !== passengerId)
      throw new ForbiddenException('No puedes cancelar una reserva que no es tuya');
    BookingStateMachine.assertTransition(booking.status, BookingStatus.CANCELED);

    const wasAccepted = booking.status === BookingStatus.ACCEPTED;
    booking.status = BookingStatus.CANCELED;

    if (wasAccepted) {
      // H-3: atomic increment
      await this.tripsRepository
        .createQueryBuilder()
        .update(Trip)
        .set({ availableSeats: () => '"availableSeats" + 1' })
        .where('id = :id', { id: booking.trip.id })
        .execute();
    }

    const savedBooking = await this.bookingsRepository.save(booking);

    if (wasAccepted && booking.trip.detourEnabled) {
      // Check the current route plan's legs to see if this passenger's booking
      // has an associated drop-off. Legacy passengerWaypoints was dropped in
      // migration 1745900000000; plan + legs are eagerly loaded on this booking.
      const hasWaypoint = booking.trip.currentRoutePlan?.legs?.some(
        l => l.passengerDropOffId === bookingId,
      ) ?? false;
      if (hasWaypoint) {
        // Async — same queue as `add`. The worker emits route_updated to all
        // active passengers on success; the driver gets it via the same
        // emission since notifyPassengerRouteUpdated covers everyone in the
        // active bookings list. (Driver-specific notifyDriverRouteUpdated is
        // no longer needed here because the worker handles broadcast.)
        await this.routeRecalcQueue.enqueue({
          op: 'remove',
          tripId: booking.trip.id,
          bookingId: savedBooking.id,
          passengerId,
        });
      }
    }

    this.notificationsService.notifyDriverBookingCanceled(booking.trip.driver.id, {
      bookingId: savedBooking.id,
      tripId: booking.trip.id,
      passengerName: booking.passenger.name,
    });

    return this.mapToResponseDto(savedBooking);
  }

  async confirmBoarding(bookingId: string, passengerId: string): Promise<BookingResponseDto> {
    const booking = await this.bookingsRepository.findOne({
      where: { id: bookingId },
      relations: [
        'trip', 'trip.driver', 'passenger',
        'trip.currentRoutePlan', 'trip.currentRoutePlan.legs',
      ],
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
      relations: [
        'trip', 'trip.driver', 'passenger',
        'trip.currentRoutePlan', 'trip.currentRoutePlan.legs',
      ],
    });

    if (!booking) throw new NotFoundException('Reserva no encontrada');
    if (booking.trip.driver.id !== driverId)
      throw new ForbiddenException('Solo el conductor puede marcar ausentes');
    // ACCEPTED → CANCELED is the only valid transition from markNoShow.
    BookingStateMachine.assertTransition(booking.status, BookingStatus.CANCELED);

    // H-4: no-show only valid at or after departure time
    if (new Date() < new Date(booking.trip.departureTime)) {
      throw new BadRequestException('Solo puedes marcar ausencia después de la hora de salida');
    }

    booking.status = BookingStatus.CANCELED;

    // H-3: atomic increment
    await this.tripsRepository
      .createQueryBuilder()
      .update(Trip)
      .set({ availableSeats: () => '"availableSeats" + 1' })
      .where('id = :id', { id: booking.trip.id })
      .execute();

    const saved = await this.bookingsRepository.save(booking);
    this.notificationsService.notifyPassengerNoShow(booking.passenger.id, { bookingId: saved.id });
    return this.mapToResponseDto(saved);
  }

  // P-5: paginated — prevents loading entire booking history in one query
  async getMyBookings(passengerId: string, page = 1, limit = 20): Promise<BookingResponseDto[]> {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(Math.max(1, limit), 50);
    const bookings = await this.bookingsRepository.find({
      where: { passenger: { id: passengerId } },
      relations: [
        'trip', 'trip.driver', 'trip.driver.vehicle', 'passenger',
        'trip.currentRoutePlan', 'trip.currentRoutePlan.legs',
      ],
      order: { createdAt: 'DESC' },
      take: safeLimit,
      skip: (safePage - 1) * safeLimit,
    });
    return bookings.map(b => this.mapToResponseDto(b));
  }

  /**
   * ETA from the active TripRoutePlan legs.
   *
   * Finds the TripRouteLeg whose passengerDropOffId matches this booking's id
   * and sums durations for legs[0..dropOff]. Returns plan.totalDurationSeconds
   * if the recalc is still in-flight (passenger not yet wired into any leg)
   * or 0 if the trip has no plan yet (Routes API failed on creation).
   */
  private mapToResponseDto(booking: Booking): BookingResponseDto {
    const plan = booking.trip.currentRoutePlan;
    let passengerEtaSeconds = 0;

    if (plan?.legs?.length) {
      const sortedLegs = [...plan.legs].sort((a, b) => a.legIndex - b.legIndex);
      const dropOffIdx = sortedLegs.findIndex(l => l.passengerDropOffId === booking.id);
      passengerEtaSeconds = dropOffIdx >= 0
        ? sortedLegs.slice(0, dropOffIdx + 1).reduce((s, l) => s + l.durationSeconds, 0)
        : plan.totalDurationSeconds; // recalc in-flight — use whole-trip estimate
    }

    return {
      id: booking.id,
      status: booking.status,
      isBoarded: booking.isBoarded,
      destLat: booking.destLat,
      destLng: booking.destLng,
      trip: {
        id: booking.trip.id,
        departureTime: booking.trip.departureTime,
        passengerEtaSeconds,
        driver: {
          id: booking.trip.driver?.id,
          name: booking.trip.driver?.name,
          vehicle: booking.trip.driver?.vehicle
            ? {
                brand: booking.trip.driver.vehicle.brand,
                model: booking.trip.driver.vehicle.model,
                color: booking.trip.driver.vehicle.color,
                plate: booking.trip.driver.vehicle.plate,
              }
            : null,
        },
      },
      passenger: {
        id: booking.passenger?.id,
        name: booking.passenger?.name,
      },
      createdAt: booking.createdAt,
    };
  }
}

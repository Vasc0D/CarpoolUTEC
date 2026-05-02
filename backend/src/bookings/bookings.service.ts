import {
    Injectable, NotFoundException, BadRequestException,
    ConflictException, ForbiddenException, GoneException,
    InternalServerErrorException, Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { Booking, BookingStatus } from './entities/booking.entity';
import { Trip, TripStatus } from '../trips/entities/trip.entity';
import { UsersService } from '../users/users.service';
import { BookingResponseDto } from './dto/booking-response.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { DirectionsService } from '../geo/directions.service';
import { GeoService } from '../geo/geo.service';
import { KeyedMutex } from '../common/keyed-mutex';

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
    private readonly dataSource: DataSource,
    // Distributed lock (Redis SETNX). Serializes recalcs per tripId across
    // every backend instance. Replaces the in-memory KeyedMutex used in Phase 0.
    private readonly recalcMutex: KeyedMutex,
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

    // Phase 2: recalc the route OUTSIDE the DB transaction (Routes API call
    // would otherwise hold a DB connection for the full HTTP latency). If it
    // fails for an auto-accepted booking, we run a compensating transaction
    // that reverts the booking and restores the seat — leaving the user
    // with a clean error rather than an ACCEPTED booking on a stale route.
    if (isAutoAccept && trip.detourEnabled && destLat != null && destLng != null) {
      try {
        await this.recalculateRoute(trip, passengerId, destLat, destLng);
      } catch (e) {
        await this.compensateAcceptedBooking(savedBooking.id, trip.id);
        this.logger.error(`Booking ${savedBooking.id} reverted: route recalc failed (${e.message})`);
        throw new InternalServerErrorException(
          'No se pudo calcular la ruta para incluir tu parada. Intenta nuevamente en unos segundos.',
        );
      }
    }

    this.notificationsService.notifyDriverNewRequest(trip.driver.id, {
      bookingId: savedBooking.id,
      passengerId,
      passengerName: passenger.name,
      tripId,
      autoAccepted: isAutoAccept,
    });

    // Reload with fresh trip relations so mapToResponseDto sees updated passengerWaypoints/legDurationsSeconds
    const freshBooking = await this.bookingsRepository.findOne({
      where: { id: savedBooking.id },
      relations: ['trip', 'trip.driver', 'trip.driver.vehicle', 'passenger'],
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
    if (booking.status !== BookingStatus.PENDING) throw new BadRequestException('La reserva no está pendiente');

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

    // Phase 2: route recalc outside the DB transaction; compensate on failure.
    if (booking.trip.detourEnabled && destLat != null && destLng != null) {
      try {
        await this.recalculateRoute(booking.trip, booking.passenger.id, destLat, destLng);
      } catch (e) {
        await this.compensateAcceptedBooking(savedBooking.id, booking.trip.id);
        this.logger.error(`Booking ${savedBooking.id} reverted on accept: route recalc failed (${e.message})`);
        throw new InternalServerErrorException(
          'No se pudo calcular la ruta para incluir esta parada. Intenta nuevamente.',
        );
      }
    }

    this.notificationsService.notifyPassengerStatusChange(booking.passenger.id, {
      bookingId: savedBooking.id,
      status: 'ACCEPTED',
    });

    // Reload with fresh trip relations so mapToResponseDto sees updated passengerWaypoints/legDurationsSeconds
    const freshBooking = await this.bookingsRepository.findOne({
      where: { id: savedBooking.id },
      relations: ['trip', 'trip.driver', 'trip.driver.vehicle', 'passenger'],
    });
    return this.mapToResponseDto(freshBooking ?? savedBooking);
  }

  /**
   * Compensating transaction: cancel an accepted booking and restore its seat.
   * Used when route recalculation fails after Phase 1 has already committed —
   * instead of leaving the user with an ACCEPTED booking on a stale route, we
   * roll back to the pre-accept state and surface a clean error.
   */
  private async compensateAcceptedBooking(bookingId: string, tripId: string): Promise<void> {
    await this.dataSource.transaction(async (manager: EntityManager) => {
      await manager.update(Booking, bookingId, { status: BookingStatus.CANCELED });
      await manager
        .createQueryBuilder()
        .update(Trip)
        .set({ availableSeats: () => '"availableSeats" + 1' })
        .where('id = :id', { id: tripId })
        .execute();
    });
  }

  /**
   * Recomputes the trip route to include or remove a passenger's stop.
   * Throws on Routes API failure so callers can run a compensating transaction;
   * earlier versions swallowed the error and left the trip in an inconsistent
   * state (booking ACCEPTED, route still pointing at the old waypoints).
   */
  private async recalculateRoute(trip: Trip, passengerId: string, destLat: number, destLng: number): Promise<void> {
    // Lock by tripId so concurrent recalculations for the same trip serialize.
    // Without this, two near-simultaneous accepts each read passengerWaypoints
    // pre-write and the second save() overwrites the first.
    await this.recalcMutex.run(trip.id, async () => {
      // Re-load the trip inside the lock — relying on the caller's snapshot
      // means we'd miss updates committed by the previous lock holder.
      const fresh = await this.tripsRepository.findOne({ where: { id: trip.id } });
      if (!fresh) throw new Error(`Trip ${trip.id} no longer exists`);

      const coords: number[][] = fresh.routePolyline?.coordinates;
      if (!coords?.length || coords.length < 2) {
        throw new Error(`Trip ${trip.id} has no usable routePolyline`);
      }

      // Use pinned coordinates to prevent drift across recalculations; fall back to polyline for legacy trips
      const origin = fresh.tripOrigin
        ?? { lat: coords[0][1], lng: coords[0][0] };
      const finalDest = fresh.finalDestination
        ?? { lat: coords[coords.length - 1][1], lng: coords[coords.length - 1][0] };

      // Build the full intermediate list (existing stops + new passenger).
      // Filter out any pre-existing waypoint for this passenger so re-entrant calls
      // (double-tap, retries, race conditions) cannot duplicate the same stop.
      const intermediates = [
        ...(fresh.passengerWaypoints ?? []).filter(w => w.passengerId !== passengerId),
        { passengerId, lat: destLat, lng: destLng },
      ];
      const allWaypoints = [origin, ...intermediates.map(w => ({ lat: w.lat, lng: w.lng })), finalDest];

      const { polylinePoints, legDurations, waypointOrder } = await this.directionsService.getRoute(allWaypoints, new Date(fresh.departureTime));
      fresh.routePolyline = this.geoService.createLineString(polylinePoints);
      // Apply Google's optimized order so the saved waypoints match the actual driving sequence
      fresh.passengerWaypoints = waypointOrder.length === intermediates.length
        ? waypointOrder.map(i => intermediates[i])
        : intermediates;
      fresh.legDurationsSeconds = legDurations;
      await this.tripsRepository.save(fresh);

      // Mutate the caller's reference so its post-recalc reads (mapToResponseDto) see fresh data.
      trip.routePolyline = fresh.routePolyline;
      trip.passengerWaypoints = fresh.passengerWaypoints;
      trip.legDurationsSeconds = fresh.legDurationsSeconds;

      // Notify all active passengers to refetch — avoids stale ETA computed server-side
      const activeBookings = await this.bookingsRepository.find({
        where: { trip: { id: fresh.id }, status: In([BookingStatus.PENDING, BookingStatus.ACCEPTED]) },
        relations: ['passenger'],
      });
      for (const b of activeBookings) {
        this.notificationsService.notifyPassengerRouteUpdated(b.passenger.id, { tripId: fresh.id });
      }
    });
  }

  private async removePassengerFromRoute(trip: Trip, passengerId: string): Promise<void> {
    // Same lock as recalculateRoute: cancellation and acceptance can interleave
    // (driver accepts another passenger while one cancels) and both rewrite
    // passengerWaypoints. Serializing both paths through the same mutex is safer
    // than partial guarding.
    await this.recalcMutex.run(trip.id, async () => {
      try {
        const fresh = await this.tripsRepository.findOne({ where: { id: trip.id } });
        if (!fresh) return;

        const remainingWaypoints = (fresh.passengerWaypoints ?? []).filter(w => w.passengerId !== passengerId);
        const coords: number[][] = fresh.routePolyline?.coordinates;
        if (!coords?.length || coords.length < 2) return;

        // Use pinned coordinates to prevent drift across recalculations; fall back to polyline for legacy trips
        const origin = fresh.tripOrigin
          ?? { lat: coords[0][1], lng: coords[0][0] };
        const finalDest = fresh.finalDestination
          ?? { lat: coords[coords.length - 1][1], lng: coords[coords.length - 1][0] };
        const waypointList = [origin, ...remainingWaypoints.map(w => ({ lat: w.lat, lng: w.lng })), finalDest];

        const { polylinePoints, legDurations, waypointOrder } = await this.directionsService.getRoute(waypointList, new Date(fresh.departureTime));
        fresh.routePolyline = this.geoService.createLineString(polylinePoints);
        // Re-apply optimized order after removal
        fresh.passengerWaypoints = waypointOrder.length === remainingWaypoints.length
          ? waypointOrder.map(i => remainingWaypoints[i])
          : remainingWaypoints;
        fresh.legDurationsSeconds = legDurations;
        await this.tripsRepository.save(fresh);

        trip.routePolyline = fresh.routePolyline;
        trip.passengerWaypoints = fresh.passengerWaypoints;
        trip.legDurationsSeconds = fresh.legDurationsSeconds;
      } catch (e) {
        this.logger.error(`Error eliminando parada tras cancelación en viaje ${trip.id}: ${e.message}`);
      }
    });
  }

  async rejectBooking(bookingId: string, driverId: string): Promise<BookingResponseDto> {
    const booking = await this.bookingsRepository.findOne({
      where: { id: bookingId },
      relations: ['trip', 'trip.driver', 'passenger'],
    });

    if (!booking) throw new NotFoundException('Reserva no encontrada');
    if (booking.trip.driver.id !== driverId) throw new ForbiddenException('Solo el conductor puede rechazar');
    // M-1: explicit guard instead of silent fall-through
    if (booking.status !== BookingStatus.PENDING) {
      throw new BadRequestException('Solo puedes rechazar reservas pendientes');
    }

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
      relations: ['trip', 'trip.driver', 'passenger'],
    });

    if (!booking) throw new NotFoundException('Reserva no encontrada');
    if (booking.passenger.id !== passengerId)
      throw new ForbiddenException('No puedes cancelar una reserva que no es tuya');

    // H-2: guard COMPLETED status — history must not be mutable
    const nonCancelable = [BookingStatus.CANCELED, BookingStatus.REJECTED, BookingStatus.COMPLETED];
    if (nonCancelable.includes(booking.status))
      throw new BadRequestException('No puedes cancelar esta reserva');

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
      const hasWaypoint = (booking.trip.passengerWaypoints ?? []).some(w => w.passengerId === passengerId);
      if (hasWaypoint) {
        await this.removePassengerFromRoute(booking.trip, passengerId);
        this.notificationsService.notifyDriverRouteUpdated(booking.trip.driver.id, { tripId: booking.trip.id });
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
      relations: ['trip', 'trip.driver', 'trip.driver.vehicle', 'passenger'],
      order: { createdAt: 'DESC' },
      take: safeLimit,
      skip: (safePage - 1) * safeLimit,
    });
    return bookings.map(b => this.mapToResponseDto(b));
  }

  private mapToResponseDto(booking: Booking): BookingResponseDto {
    const legDurs = booking.trip.legDurationsSeconds ?? [];
    const totalSeconds = legDurs.length > 0
      ? legDurs.reduce((a, b) => a + b, 0)
      : booking.trip.originalDurationSeconds;
    const waypoints = booking.trip.passengerWaypoints ?? [];
    const stopIdx = waypoints.findIndex(w => w.passengerId === booking.passenger?.id);
    const passengerEtaSeconds = stopIdx >= 0 && legDurs.length > 0
      ? legDurs.slice(0, stopIdx + 1).reduce((a, b) => a + b, 0)
      : totalSeconds;

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

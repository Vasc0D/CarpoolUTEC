import {
    WebSocketGateway, WebSocketServer,
    OnGatewayConnection, OnGatewayDisconnect,
    SubscribeMessage, MessageBody, ConnectedSocket,
} from '@nestjs/websockets';
import { Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import { Redis as RedisClient } from 'ioredis';
import { Booking, BookingStatus } from '../bookings/entities/booking.entity';
import { Trip } from '../trips/entities/trip.entity';
import { TripRoutePlan, RoutePlanStatus } from '../trips/entities/trip-route-plan.entity';
import { TripRouteLeg } from '../trips/entities/trip-route-leg.entity';
import { REDIS_CLIENT } from '../common/redis.module';
import type { StoredDriverLocation } from './notifications.types';

// A-3: match the same allowed origins used for HTTP CORS in main.ts
const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['exp://127.0.0.1:8081', 'exp://localhost:8081'];

@WebSocketGateway({ cors: { origin: allowedOrigins } })
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;

    private readonly logger = new Logger(NotificationsGateway.name);

    constructor(
        private readonly jwtService: JwtService,
        @InjectRepository(Booking)
        private readonly bookingsRepository: Repository<Booking>,
        @InjectRepository(Trip)
        private readonly tripsRepository: Repository<Trip>,
        @InjectRepository(TripRoutePlan)
        private readonly plansRepository: Repository<TripRoutePlan>,
        @Inject(REDIS_CLIENT)
        private readonly redis: RedisClient,
    ) { }

    async handleConnection(client: Socket) {
        try {
            const token =
                client.handshake.auth.token ||
                client.handshake.headers['authorization']?.split(' ')[1];
            if (!token) {
                client.disconnect();
                return;
            }
            const payload = this.jwtService.verify(token);
            const userId = payload.sub as string;

            // Store on the socket so handlers can authorise without re-verifying the JWT
            client.data.userId = userId;
            client.join(userId);
            this.logger.log(`Socket connected: user ${userId}`);
        } catch {
            this.logger.warn('Socket auth failed — disconnecting client');
            client.disconnect();
        }
    }

    handleDisconnect(client: Socket) {
        this.logger.log(`Socket disconnected: ${client.id}`);
    }

    /**
     * Driver sends GPS position → gateway:
     *   1. Verifies the socket belongs to the trip's actual driver.
     *   2. Persists the position in Redis (TTL 30 s) so reconnecting clients
     *      can fetch the last known location via REST.
     *   3. Loads the active TripRoutePlan + legs and projects the driver onto
     *      the nearest segment to compute remaining seconds.
     *   4. Emits `driver_location_update` to each accepted passenger with
     *      their personal drop-off ETA, and back to the driver with the total
     *      remaining ETA to the final destination.
     */
    @SubscribeMessage('driver_location')
    async handleDriverLocation(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { tripId: string; lat: number; lng: number; heading?: number },
    ) {
        const userId = client.data.userId as string | undefined;
        if (!userId) return;

        // A-4: verify the emitting socket is the actual driver of this trip
        const trip = await this.tripsRepository.findOne({
            where: { id: data.tripId },
            relations: ['driver'],
        });
        if (!trip || trip.driver.id !== userId) return;

        // 1. Persist in Redis — non-blocking, failure must not stall the broadcast.
        const stored: StoredDriverLocation = {
            lat: data.lat,
            lng: data.lng,
            heading: data.heading ?? null,
            ts: Date.now(),
        };
        this.redis
            .set(`driver_location:${data.tripId}`, JSON.stringify(stored), 'EX', 30)
            .catch(err => this.logger.warn(`Redis set failed for driver_location: ${err.message}`));

        // 2. Load active plan + legs for ETA computation
        const plan = await this.plansRepository.findOne({
            where: { tripId: data.tripId, status: RoutePlanStatus.ACTIVE },
            relations: ['legs'],
        });
        const sortedLegs: TripRouteLeg[] = plan?.legs?.length
            ? [...plan.legs].sort((a, b) => a.legIndex - b.legIndex)
            : [];

        // 3. Find which leg the driver is currently on + how far through it
        const { legIdx, fraction } = sortedLegs.length
            ? this.findCurrentLeg(data.lat, data.lng, sortedLegs)
            : { legIdx: 0, fraction: 0 };

        // 4. Load accepted bookings and emit personalized ETAs
        const bookings = await this.bookingsRepository.find({
            where: { trip: { id: data.tripId }, status: BookingStatus.ACCEPTED },
            relations: ['passenger'],
        });

        for (const booking of bookings) {
            const etaSeconds = sortedLegs.length
                ? this.passengerEta(booking.id, legIdx, fraction, sortedLegs)
                : null;

            this.server.to(booking.passenger.id).emit('driver_location_update', {
                tripId: data.tripId,
                lat: data.lat,
                lng: data.lng,
                heading: data.heading ?? null,
                etaSeconds,
            });
        }

        // Also emit back to driver: total remaining ETA to final destination
        const driverEtaSeconds = sortedLegs.length
            ? this.remainingSeconds(legIdx, fraction, sortedLegs.length - 1, sortedLegs)
            : null;
        this.server.to(userId).emit('driver_location_update', {
            tripId: data.tripId,
            lat: data.lat,
            lng: data.lng,
            heading: data.heading ?? null,
            etaSeconds: driverEtaSeconds,
        });
    }

    // ─── ETA helpers ─────────────────────────────────────────────────────────

    /**
     * Find the plan leg the driver is currently on.
     *
     * For each leg (A→B segment), we project the driver's position P onto the
     * segment and compute the squared distance from P to the nearest point on
     * the segment. The leg with the smallest distance is the current one.
     *
     * We use coordinate-space distances (no geographic correction) which
     * introduces ~0.5% error at Lima's latitude — acceptable for ETA display.
     */
    private findCurrentLeg(
        driverLat: number,
        driverLng: number,
        sortedLegs: TripRouteLeg[],
    ): { legIdx: number; fraction: number } {
        let bestIdx = 0;
        let bestFraction = 0;
        let minDist2 = Infinity;

        for (let i = 0; i < sortedLegs.length; i++) {
            const leg = sortedLegs[i];
            const sLat = Number(leg.startLat);
            const sLng = Number(leg.startLng);
            const eLat = Number(leg.endLat);
            const eLng = Number(leg.endLng);

            const dlat = eLat - sLat;
            const dlng = eLng - sLng;
            const len2 = dlat * dlat + dlng * dlng;

            let t = 0;
            if (len2 > 0) {
                t = ((driverLat - sLat) * dlat + (driverLng - sLng) * dlng) / len2;
                t = Math.max(0, Math.min(1, t));
            }

            const nearLat = sLat + t * dlat;
            const nearLng = sLng + t * dlng;
            const dist2 =
                (driverLat - nearLat) ** 2 + (driverLng - nearLng) ** 2;

            if (dist2 < minDist2) {
                minDist2 = dist2;
                bestIdx = i;
                bestFraction = t;
            }
        }

        return { legIdx: bestIdx, fraction: bestFraction };
    }

    /**
     * Remaining seconds from driver's current position to a given leg's end.
     * Returns 0 if the target leg is already behind the driver.
     */
    private remainingSeconds(
        curLegIdx: number,
        fraction: number,
        targetLegIdx: number,
        sortedLegs: TripRouteLeg[],
    ): number {
        if (targetLegIdx < curLegIdx) return 0;
        const onCurrentLeg = sortedLegs[curLegIdx].durationSeconds * (1 - fraction);
        const subsequent = sortedLegs
            .slice(curLegIdx + 1, targetLegIdx + 1)
            .reduce((s, l) => s + l.durationSeconds, 0);
        return Math.round(onCurrentLeg + subsequent);
    }

    /**
     * Per-passenger ETA: seconds from current driver position to the passenger's
     * drop-off leg. Falls back to the final destination ETA if the booking isn't
     * wired into any leg (recalc in-flight).
     */
    private passengerEta(
        bookingId: string,
        curLegIdx: number,
        fraction: number,
        sortedLegs: TripRouteLeg[],
    ): number {
        const dropOffIdx = sortedLegs.findIndex(l => l.passengerDropOffId === bookingId);
        const targetIdx = dropOffIdx >= 0 ? dropOffIdx : sortedLegs.length - 1;
        return this.remainingSeconds(curLegIdx, fraction, targetIdx, sortedLegs);
    }

    // ─── Redis accessor used by TripsController ───────────────────────────────

    /** Returns the last known driver position, or null if expired / not started. */
    async getLastKnownLocation(tripId: string): Promise<StoredDriverLocation | null> {
        const raw = await this.redis.get(`driver_location:${tripId}`);
        if (!raw) return null;
        try {
            return JSON.parse(raw) as StoredDriverLocation;
        } catch {
            return null;
        }
    }
}

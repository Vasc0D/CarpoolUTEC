import {
    WebSocketGateway, WebSocketServer,
    OnGatewayConnection, OnGatewayDisconnect,
    SubscribeMessage, MessageBody, ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import { Booking, BookingStatus } from '../bookings/entities/booking.entity';
import { Trip } from '../trips/entities/trip.entity';

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
        // A-4: needed to verify driver ownership of a trip before broadcasting location
        @InjectRepository(Trip)
        private readonly tripsRepository: Repository<Trip>,
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

    @SubscribeMessage('driver_location')
    async handleDriverLocation(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { tripId: string; lat: number; lng: number },
    ) {
        // A-4: verify the emitting socket is the actual driver of this trip —
        // any authenticated user who knows a tripId must not be able to spoof location
        const userId = client.data.userId as string | undefined;
        if (!userId) return;

        const trip = await this.tripsRepository.findOne({
            where: { id: data.tripId },
            relations: ['driver'],
        });
        if (!trip || trip.driver.id !== userId) return;

        const bookings = await this.bookingsRepository.find({
            where: { trip: { id: data.tripId }, status: BookingStatus.ACCEPTED },
            relations: ['passenger'],
        });

        for (const booking of bookings) {
            this.server.to(booking.passenger.id).emit('driver_location_update', {
                tripId: data.tripId,
                lat: data.lat,
                lng: data.lng,
            });
        }
    }
}

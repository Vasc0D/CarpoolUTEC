import {
    WebSocketGateway, WebSocketServer,
    OnGatewayConnection, OnGatewayDisconnect,
    SubscribeMessage, MessageBody, ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Booking, BookingStatus } from '../bookings/entities/booking.entity';

@WebSocketGateway({ cors: true })
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;

    constructor(
        private readonly jwtService: JwtService,
        @InjectRepository(Booking)
        private readonly bookingsRepository: Repository<Booking>,
    ) { }

    async handleConnection(client: Socket) {
        try {
            const token = client.handshake.auth.token || client.handshake.headers['authorization']?.split(' ')[1];
            if (!token) {
                client.disconnect();
                return;
            }
            const payload = this.jwtService.verify(token);
            const userId = payload.sub;

            client.join(userId);
            console.log(`Socket Client connected and joined private room: ${userId}`);
        } catch (err) {
            console.error('Socket Auth Error: Invalid token. Disconnecting.');
            client.disconnect();
        }
    }

    handleDisconnect(client: Socket) {
        console.log(`Socket Client disconnected: ${client.id}`);
    }

    @SubscribeMessage('driver_location')
    async handleDriverLocation(
        @ConnectedSocket() _client: Socket,
        @MessageBody() data: { tripId: string; lat: number; lng: number },
    ) {
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

import { WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';

@WebSocketGateway({ cors: true })
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;

    constructor(private readonly jwtService: JwtService) { }

    async handleConnection(client: Socket) {
        try {
            const token = client.handshake.auth.token || client.handshake.headers['authorization']?.split(' ')[1];
            if (!token) {
                client.disconnect();
                return;
            }
            const payload = this.jwtService.verify(token);
            const userId = payload.sub; // id en nuestro payload jwt

            // El cliente se une a su sala privada
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
}

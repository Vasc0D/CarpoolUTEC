import { io, Socket } from 'socket.io-client';

const SOCKET_URL = 'http://localhost:3000';

export const createSocket = (token: string): Socket =>
    io(SOCKET_URL, {
        auth: { token },
        transports: ['websocket'],
        autoConnect: false,
    });

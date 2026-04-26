import { io, Socket } from 'socket.io-client';

// P-6: URL from env — never hardcode localhost in shipped code
const SOCKET_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

export const createSocket = (token: string): Socket =>
    io(SOCKET_URL, {
        auth: { token },
        transports: ['websocket'],
        autoConnect: false,
    });

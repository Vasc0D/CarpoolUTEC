import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import * as crypto from 'crypto';

@Injectable()
export class AuthService {
    // Short-lived auth codes: code → JWT token (TTL: 60 seconds)
    // These are generated server-side after OAuth and exchanged by the mobile app.
    // This avoids passing the JWT in the redirect URL (which would appear in logs/history).
    private readonly pendingTokens = new Map<string, string>();

    constructor(
        private readonly usersService: UsersService,
        private readonly jwtService: JwtService,
    ) {}

    async googleLogin(req: any): Promise<{ code: string }> {
        if (!req.user) {
            throw new UnauthorizedException('No user from Google');
        }

        const { email, name } = req.user as { email: string; name: string };

        let user = await this.usersService.findByEmail(email);
        if (!user) {
            user = await this.usersService.create({ email, name });
        }

        const payload = { email: user.email, sub: user.id };
        const token = this.jwtService.sign(payload);

        // Issue a one-time opaque code; mobile app must exchange it within 60 s
        const code = crypto.randomUUID();
        this.pendingTokens.set(code, token);
        setTimeout(() => this.pendingTokens.delete(code), 60_000);

        return { code };
    }

    exchangeCode(code: string): { access_token: string } {
        const token = this.pendingTokens.get(code);
        if (!token) {
            throw new UnauthorizedException('Invalid or expired auth code');
        }
        this.pendingTokens.delete(code);
        return { access_token: token };
    }
}

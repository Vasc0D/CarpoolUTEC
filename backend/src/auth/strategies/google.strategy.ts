import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
    constructor(private readonly configService: ConfigService) {
        super({
            clientID: configService.get<string>('GOOGLE_CLIENT_ID') || 'test-client-id', // Asegúrate de agregarlo en .env
            clientSecret: configService.get<string>('GOOGLE_CLIENT_SECRET') || 'test-secret',
            callbackURL: configService.get<string>('GOOGLE_CALLBACK_URL') || 'http://localhost:3000/auth/google/callback',
            scope: ['email', 'profile'],
        });
    }

    async validate(accessToken: string, refreshToken: string, profile: any, done: VerifyCallback): Promise<any> {
        const { emails, displayName } = profile;
        const email = emails[0].value;

        // Filtro Crítico: Restringir a dominio universitario
        if (!email.endsWith('@utec.edu.pe')) {
            throw new UnauthorizedException('Solo se permiten cuentas institucionales @utec.edu.pe');
        }

        const user = {
            email,
            name: displayName,
            accessToken,
        };
        done(null, user);
    }
}

import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
    constructor(private readonly configService: ConfigService) {
        super({
            clientID: configService.getOrThrow<string>('GOOGLE_CLIENT_ID'),
            clientSecret: configService.getOrThrow<string>('GOOGLE_CLIENT_SECRET'),
            callbackURL: configService.getOrThrow<string>('GOOGLE_CALLBACK_URL'),
            scope: ['email', 'profile'],
        });
    }

    async validate(_accessToken: string, _refreshToken: string, profile: any, done: VerifyCallback): Promise<any> {
        const { emails, displayName } = profile;
        const email: string = emails[0].value;

        if (!email.endsWith('@utec.edu.pe')) {
            throw new UnauthorizedException('Solo se permiten cuentas institucionales @utec.edu.pe');
        }

        // Only pass what we need — never forward OAuth tokens further into the app
        done(null, { email, name: displayName });
    }
}

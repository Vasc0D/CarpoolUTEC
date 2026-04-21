import { Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import type { Response } from 'express';

@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) { }

    @Get('google')
    @UseGuards(AuthGuard('google'))
    async googleAuth(@Req() req) {
        // Inicia el flujo de OAuth 2.0. Redirige automáticamente a Google.
    }

    @Get('google/callback')
    @UseGuards(AuthGuard('google'))
    async googleAuthRedirect(@Req() req, @Res() res: Response) {
        // Validamos la sesión y firmamos nuestro JWT interno
        const jwt = await this.authService.googleLogin(req);

        // Disparamos un Deep Link puro hacia Expo usando el IP local de la maquina host que sirve la bundler
        // Si compilan la app en la nube o local (distinta subred), asegurense de cambiar esta IP
        const redirectUrl = `exp://127.0.0.1:8081/--/login?token=${jwt.access_token}&user=${encodeURIComponent(JSON.stringify(jwt.user))}`;

        return res.redirect(redirectUrl);
    }
}

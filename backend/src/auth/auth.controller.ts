import { Controller, Get, Post, Body, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { IsString, IsNotEmpty } from 'class-validator';
import { AuthService } from './auth.service';
import type { Response } from 'express';

class ExchangeCodeDto {
    @IsString()
    @IsNotEmpty()
    code: string;
}

@Controller('auth')
export class AuthController {
    constructor(
        private readonly authService: AuthService,
        private readonly configService: ConfigService,
    ) {}

    @Get('google')
    @UseGuards(AuthGuard('google'))
    googleAuth() {
        // Passport redirects to Google automatically — no body needed
    }

    @Get('google/callback')
    @UseGuards(AuthGuard('google'))
    async googleAuthRedirect(@Req() req, @Res() res: Response) {
        const { code } = await this.authService.googleLogin(req);

        // Only the opaque short-lived code goes in the URL — never the JWT itself
        const baseUrl = this.configService.getOrThrow<string>('EXPO_REDIRECT_URL');
        return res.redirect(`${baseUrl}?code=${code}`);
    }

    /**
     * Mobile app calls this with the code received in the deep-link.
     * Returns the JWT. Must be called within 60 seconds of the redirect.
     */
    @Post('token')
    exchangeCode(@Body() dto: ExchangeCodeDto) {
        return this.authService.exchangeCode(dto.code);
    }
}

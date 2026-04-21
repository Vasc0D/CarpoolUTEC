import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';

@Injectable()
export class AuthService {
    constructor(
        private readonly usersService: UsersService,
        private readonly jwtService: JwtService,
    ) { }

    async googleLogin(req: any) {
        if (!req.user) {
            return { message: 'No user from Google' };
        }

        const { email, name } = req.user;

        // 1. Check si el usuario ya existe en base de datos
        let user = await this.usersService.findByEmail(email);

        // 2. Si no existe, lo creamos
        if (!user) {
            user = await this.usersService.create({ email, name });
        }

        // 3. Generar y firmar el JSON Web Token
        const payload = { email: user.email, sub: user.id };
        return {
            message: 'Login Exitoso',
            access_token: this.jwtService.sign(payload),
            user,
        };
    }
}

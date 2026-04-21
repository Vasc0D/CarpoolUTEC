import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UsersService } from './users.service';
import { CreateVehicleDto } from '../vehicles/dto/create-vehicle.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) { }

  @Post('vehicle')
  @UseGuards(AuthGuard('jwt'))
  createVehicle(@Body() createVehicleDto: CreateVehicleDto, @Req() req) {
    // req.user viene del jwt.strategy.ts que valida el bearer token
    return this.usersService.createVehicle(req.user.id, createVehicleDto);
  }
}

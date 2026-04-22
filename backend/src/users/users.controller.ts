import { Controller, Get, Post, Body, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UsersService } from './users.service';
import { CreateVehicleDto } from '../vehicles/dto/create-vehicle.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) { }

  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  getMe(@Req() req) {
    return this.usersService.findByIdWithVehicle(req.user.id);
  }

  @Post('vehicle')
  @UseGuards(AuthGuard('jwt'))
  createVehicle(@Body() createVehicleDto: CreateVehicleDto, @Req() req) {
    return this.usersService.createVehicle(req.user.id, createVehicleDto);
  }
}

import { Controller, Post, Get, Patch, Param, Body, UseGuards, Req, Query, BadRequestException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TripsService } from './trips.service';
import { CreateTripDto } from './dto/create-trip.dto';

@Controller('trips')
@UseGuards(AuthGuard('jwt'))
export class TripsController {
  constructor(private readonly tripsService: TripsService) { }

  @Post()
  create(@Body() createTripDto: CreateTripDto, @Req() req) {
    return this.tripsService.create(req.user.id, createTripDto);
  }

  @Get()
  findAll(@Query('lat') lat: string, @Query('lng') lng: string) {
    if (!lat || !lng) throw new BadRequestException('Se requieren las coordenadas lat y lng');
    return this.tripsService.findAvailableTrips(parseFloat(lat), parseFloat(lng));
  }

  @Patch(':tripId/cancel')
  cancelTrip(@Param('tripId') tripId: string, @Req() req) {
    return this.tripsService.cancelTrip(tripId, req.user.id);
  }
}

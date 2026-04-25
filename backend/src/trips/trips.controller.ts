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
  findAll(
    @Query('lat') lat: string,
    @Query('lng') lng: string,
    @Query('destLat') destLat?: string,
    @Query('destLng') destLng?: string,
  ) {
    if (!lat || !lng) throw new BadRequestException('Se requieren las coordenadas lat y lng');
    return this.tripsService.findAvailableTrips(
      parseFloat(lat),
      parseFloat(lng),
      destLat ? parseFloat(destLat) : undefined,
      destLng ? parseFloat(destLng) : undefined,
    );
  }

  @Get('stops-coverage')
  getStopsCoverage(@Query('stops') stopsJson: string) {
    if (!stopsJson) throw new BadRequestException('Se requiere el parámetro stops');
    try {
      const stops = JSON.parse(stopsJson);
      return this.tripsService.getStopsCoverage(stops);
    } catch {
      throw new BadRequestException('stops debe ser un JSON válido');
    }
  }

  @Get('my-trips')
  getMyTrips(@Req() req) {
    return this.tripsService.getMyTrips(req.user.id);
  }

  @Get(':tripId/closest-point')
  getClosestPoint(
    @Param('tripId') tripId: string,
    @Query('destLat') destLat: string,
    @Query('destLng') destLng: string,
  ) {
    return this.tripsService.getClosestPoint(tripId, parseFloat(destLat), parseFloat(destLng));
  }

  @Get(':tripId')
  findOne(@Param('tripId') tripId: string) {
    return this.tripsService.findOne(tripId);
  }

  @Patch(':tripId/cancel')
  cancelTrip(@Param('tripId') tripId: string, @Req() req) {
    return this.tripsService.cancelTrip(tripId, req.user.id);
  }

  @Patch(':tripId/start')
  startTrip(@Param('tripId') tripId: string, @Req() req) {
    return this.tripsService.startTrip(tripId, req.user.id);
  }

  @Patch(':tripId/finish')
  finishTrip(@Param('tripId') tripId: string, @Req() req) {
    return this.tripsService.finishTrip(tripId, req.user.id);
  }
}

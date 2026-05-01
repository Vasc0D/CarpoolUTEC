import { Controller, Post, Get, Patch, Param, Body, UseGuards, Req, Query, BadRequestException, ParseIntPipe, ParseUUIDPipe, DefaultValuePipe } from '@nestjs/common';
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
    @Req() req,
    @Query('lat') lat: string,
    @Query('lng') lng: string,
    @Query('destLat') destLat?: string,
    @Query('destLng') destLng?: string,
  ) {
    if (!lat || !lng) throw new BadRequestException('Se requieren las coordenadas lat y lng');
    const parsedLat = parseFloat(lat);
    const parsedLng = parseFloat(lng);
    if (isNaN(parsedLat) || parsedLat < -90 || parsedLat > 90)
      throw new BadRequestException('lat debe ser un número entre -90 y 90');
    if (isNaN(parsedLng) || parsedLng < -180 || parsedLng > 180)
      throw new BadRequestException('lng debe ser un número entre -180 y 180');

    let parsedDestLat: number | undefined;
    let parsedDestLng: number | undefined;
    if (destLat !== undefined && destLng !== undefined) {
      parsedDestLat = parseFloat(destLat);
      parsedDestLng = parseFloat(destLng);
      if (isNaN(parsedDestLat) || parsedDestLat < -90 || parsedDestLat > 90)
        throw new BadRequestException('destLat debe ser un número entre -90 y 90');
      if (isNaN(parsedDestLng) || parsedDestLng < -180 || parsedDestLng > 180)
        throw new BadRequestException('destLng debe ser un número entre -180 y 180');
    }

    return this.tripsService.findAvailableTrips(parsedLat, parsedLng, parsedDestLat, parsedDestLng, req.user.id);
  }

  @Get('stops-coverage')
  getStopsCoverage(@Query('stops') stopsJson: string) {
    if (!stopsJson) throw new BadRequestException('Se requiere el parámetro stops');

    // M-4: validate stops shape and coordinate ranges before passing to service
    let stops: Array<{ id: string; lat: number; lng: number }>;
    try {
      stops = JSON.parse(stopsJson);
    } catch {
      throw new BadRequestException('stops debe ser un JSON válido');
    }

    if (!Array.isArray(stops) || stops.length === 0)
      throw new BadRequestException('stops debe ser un array no vacío');
    if (stops.length > 50)
      throw new BadRequestException('stops no puede contener más de 50 elementos');

    for (const s of stops) {
      if (typeof s.id !== 'string' || !s.id.trim())
        throw new BadRequestException('Cada stop debe tener un campo "id" de tipo string');
      if (typeof s.lat !== 'number' || s.lat < -90 || s.lat > 90)
        throw new BadRequestException(`Stop "${s.id}": lat debe ser un número entre -90 y 90`);
      if (typeof s.lng !== 'number' || s.lng < -180 || s.lng > 180)
        throw new BadRequestException(`Stop "${s.id}": lng debe ser un número entre -180 y 180`);
    }

    return this.tripsService.getStopsCoverage(stops);
  }

  @Get('my-trips')
  getMyTrips(
    @Req() req,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.tripsService.getMyTrips(req.user.id, page, limit);
  }

  @Get(':tripId/closest-point')
  getClosestPoint(
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Query('destLat') destLat: string,
    @Query('destLng') destLng: string,
    @Req() req,
  ) {
    const lat = parseFloat(destLat);
    const lng = parseFloat(destLng);
    if (isNaN(lat) || lat < -90 || lat > 90)
      throw new BadRequestException('destLat debe ser un número entre -90 y 90');
    if (isNaN(lng) || lng < -180 || lng > 180)
      throw new BadRequestException('destLng debe ser un número entre -180 y 180');
    return this.tripsService.getClosestPoint(tripId, lat, lng, req.user.id);
  }

  // C-2: ParseUUIDPipe rejects non-UUID strings with a 400 before hitting the DB
  @Get(':tripId')
  findOne(@Param('tripId', ParseUUIDPipe) tripId: string) {
    return this.tripsService.findOne(tripId);
  }

  @Patch(':tripId/cancel')
  cancelTrip(@Param('tripId', ParseUUIDPipe) tripId: string, @Req() req) {
    return this.tripsService.cancelTrip(tripId, req.user.id);
  }

  @Patch(':tripId/start')
  startTrip(@Param('tripId', ParseUUIDPipe) tripId: string, @Req() req) {
    return this.tripsService.startTrip(tripId, req.user.id);
  }

  @Patch(':tripId/finish')
  finishTrip(@Param('tripId', ParseUUIDPipe) tripId: string, @Req() req) {
    return this.tripsService.finishTrip(tripId, req.user.id);
  }
}

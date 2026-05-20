import { Controller, Post, Get, Patch, Param, Body, UseGuards, Req, Query, BadRequestException, NotFoundException, ParseIntPipe, ParseUUIDPipe, DefaultValuePipe } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TripsService } from './trips.service';
import { CreateTripDto } from './dto/create-trip.dto';
import { NotificationsGateway } from '../notifications/notifications.gateway';

@Controller('trips')
@UseGuards(AuthGuard('jwt'))
export class TripsController {
  constructor(
    private readonly tripsService: TripsService,
    private readonly notificationsGateway: NotificationsGateway,
  ) { }

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

  /**
   * Returns the driver's last known GPS position for this trip, stored in
   * Redis by the WebSocket gateway on each location ping (TTL 30 s).
   * Returns 404 when the driver hasn't sent a ping yet or has been silent
   * for more than 30 seconds (i.e. the key expired).
   *
   * Clients use this to render the driver marker immediately on reconnect
   * without waiting for the next socket emission.
   */
  @Get(':tripId/driver-location')
  async getDriverLocation(@Param('tripId', ParseUUIDPipe) tripId: string) {
    const loc = await this.notificationsGateway.getLastKnownLocation(tripId);
    if (!loc) throw new NotFoundException('No hay ubicación disponible del conductor');
    return loc;
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

import { Controller, Post, Patch, Get, Param, UseGuards, Req, Body, Query, DefaultValuePipe, ParseIntPipe } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';

@Controller('bookings')
@UseGuards(AuthGuard('jwt'))
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post(':tripId')
  solicitSeat(
    @Param('tripId') tripId: string,
    @Req() req,
    @Body() dto: CreateBookingDto,
  ) {
    return this.bookingsService.solicitSeat(tripId, req.user.id, dto.destLat, dto.destLng);
  }

  @Patch(':bookingId/accept')
  acceptBooking(@Param('bookingId') bookingId: string, @Req() req) {
    return this.bookingsService.acceptBooking(bookingId, req.user.id);
  }

  @Patch(':bookingId/reject')
  rejectBooking(@Param('bookingId') bookingId: string, @Req() req) {
    return this.bookingsService.rejectBooking(bookingId, req.user.id);
  }

  @Patch(':bookingId/cancel')
  cancelBooking(@Param('bookingId') bookingId: string, @Req() req) {
    return this.bookingsService.cancelBooking(bookingId, req.user.id);
  }

  @Patch(':bookingId/board')
  confirmBoarding(@Param('bookingId') bookingId: string, @Req() req) {
    return this.bookingsService.confirmBoarding(bookingId, req.user.id);
  }

  @Patch(':bookingId/no-show')
  markNoShow(@Param('bookingId') bookingId: string, @Req() req) {
    return this.bookingsService.markNoShow(bookingId, req.user.id);
  }

  @Get('me')
  getMyBookings(
    @Req() req,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.bookingsService.getMyBookings(req.user.id, page, limit);
  }
}

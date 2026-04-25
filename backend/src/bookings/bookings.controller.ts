import { Controller, Post, Patch, Get, Param, UseGuards, Req, Body } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { BookingsService } from './bookings.service';

@Controller('bookings')
@UseGuards(AuthGuard('jwt'))
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) { }

  @Post(':tripId')
  solicitSeat(
    @Param('tripId') tripId: string,
    @Req() req,
    @Body() body: { destLat?: number; destLng?: number },
  ) {
    return this.bookingsService.solicitSeat(tripId, req.user.id, body.destLat, body.destLng);
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
  getMyBookings(@Req() req) {
    return this.bookingsService.getMyBookings(req.user.id);
  }
}

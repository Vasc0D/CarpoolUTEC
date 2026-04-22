import { Controller, Post, Patch, Get, Param, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { BookingsService } from './bookings.service';

@Controller('bookings')
@UseGuards(AuthGuard('jwt'))
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) { }

  @Post(':tripId')
  solicitSeat(@Param('tripId') tripId: string, @Req() req) {
    return this.bookingsService.solicitSeat(tripId, req.user.id);
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

  @Get('me')
  getMyBookings(@Req() req) {
    return this.bookingsService.getMyBookings(req.user.id);
  }
}

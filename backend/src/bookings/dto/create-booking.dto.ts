import { IsDefined, IsNumber, Max, Min, ValidateIf } from 'class-validator';

/**
 * Body for POST /bookings/:tripId.
 *
 * destLat/destLng are paired: either both come or neither comes. Sending only
 * one is rejected (it would silently corrupt downstream route recalculation,
 * which uses both fields together to position the new waypoint).
 *
 * Range checks are kept loose on purpose — a destination over the ocean is
 * not invalid input by itself; Routes API will return ZERO_RESULTS and we
 * surface that as a "no route found" booking failure. We only guard against
 * non-finite numbers (NaN, ±Infinity) and obviously-out-of-globe values.
 */
export class CreateBookingDto {
    @ValidateIf((o: CreateBookingDto) => o.destLat !== undefined || o.destLng !== undefined)
    @IsDefined({ message: 'destLat es requerido cuando se envía destLng' })
    @IsNumber({ allowNaN: false, allowInfinity: false })
    @Min(-90)
    @Max(90)
    destLat?: number;

    @ValidateIf((o: CreateBookingDto) => o.destLat !== undefined || o.destLng !== undefined)
    @IsDefined({ message: 'destLng es requerido cuando se envía destLat' })
    @IsNumber({ allowNaN: false, allowInfinity: false })
    @Min(-180)
    @Max(180)
    destLng?: number;
}

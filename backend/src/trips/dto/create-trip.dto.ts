import {
    IsBoolean, IsDateString, IsNotEmpty, IsArray, ArrayMinSize,
    IsOptional, IsNumber, IsInt, Min, Max,
    registerDecorator, ValidationOptions,
} from 'class-validator';

/**
 * M-1: Custom validator for [lat, lng][] tuples.
 *
 * @ValidateNested + @Type(() => RoutePointDto) does NOT work for plain number
 * tuples — class-transformer cannot map [number, number] onto a class with
 * numeric index keys, so it fires "must be either object or array" for every
 * point in the route. A single inline validator avoids the issue entirely.
 */
function IsRoutePointArray(options?: ValidationOptions) {
    return (object: object, propertyName: string) => {
        registerDecorator({
            name: 'isRoutePointArray',
            target: (object as any).constructor,
            propertyName,
            options: {
                message: 'Cada punto de ruta debe ser un par [latitud, longitud] con rangos válidos (lat −90…90, lng −180…180)',
                ...options,
            },
            validator: {
                validate(value: unknown) {
                    if (!Array.isArray(value)) return false;
                    return value.every(
                        (point) =>
                            Array.isArray(point) &&
                            point.length === 2 &&
                            typeof point[0] === 'number' &&
                            typeof point[1] === 'number' &&
                            point[0] >= -90 && point[0] <= 90 &&
                            point[1] >= -180 && point[1] <= 180,
                    );
                },
            },
        });
    };
}

export class CreateTripDto {
    @IsArray()
    @ArrayMinSize(2)
    @IsRoutePointArray()
    route: [number, number][];

    @IsDateString()
    @IsNotEmpty()
    departureTime: string;

    @IsBoolean()
    @IsOptional()
    autoAccept?: boolean;

    @IsBoolean()
    @IsOptional()
    detourEnabled?: boolean;

    @IsInt()
    @Min(1)
    @Max(8)
    @IsOptional()
    availableSeats?: number;

    @IsInt()
    @Min(0)
    @Max(60)
    @IsOptional()
    maxDetourMinutes?: number;

    @IsNumber()
    @Min(0)
    @Max(999)
    @IsOptional()
    pricePerSeat?: number;

    // meetingPoint removed: pickup is fixed at the UTEC car exit (see
    // backend/src/trips/constants.ts → PICKUP_POINT). Clients must not send it.
}

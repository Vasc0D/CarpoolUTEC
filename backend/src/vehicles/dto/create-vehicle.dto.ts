import { IsString, IsNotEmpty, IsInt, Min, Max, Matches, MaxLength } from 'class-validator';

export class CreateVehicleDto {
  // Peru plate formats: ABC-123 (old) or A1B-234 (new alphanumeric)
  @Matches(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/, {
    message: 'La placa debe tener el formato ABC-123 o A1B-234',
  })
  plate: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  brand: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  model: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  color: string;

  @IsInt()
  @Min(1)
  @Max(8)
  capacity: number;
}

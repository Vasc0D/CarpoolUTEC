import { IsString, IsNotEmpty, IsInt, Min, Max } from 'class-validator';

export class CreateVehicleDto {
  @IsString()
  @IsNotEmpty()
  plate: string;

  @IsString()
  @IsNotEmpty()
  brand: string;

  @IsString()
  @IsNotEmpty()
  model: string;

  @IsString()
  @IsNotEmpty()
  color: string;

  @IsInt()
  @Min(1)
  @Max(8)
  capacity: number;
}
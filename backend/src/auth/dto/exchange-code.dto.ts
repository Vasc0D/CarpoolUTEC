import { IsString, IsNotEmpty } from 'class-validator';

export class ExchangeCodeDto {
  @IsString()
  @IsNotEmpty()
  code: string;
}

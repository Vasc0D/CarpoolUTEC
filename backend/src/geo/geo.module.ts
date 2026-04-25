import { Module } from '@nestjs/common';
import { GeoService } from './geo.service';
import { DirectionsService } from './directions.service';

@Module({
  providers: [GeoService, DirectionsService],
  exports: [GeoService, DirectionsService],
})
export class GeoModule { }

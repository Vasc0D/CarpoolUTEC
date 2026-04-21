import { Injectable } from '@nestjs/common';

@Injectable()
export class GeoService {
  createPoint(lat: number, lng: number) {
    return {
      type: 'Point',
      coordinates: [lng, lat],
    };
  }

  createLineString(coordinates: [number, number][]) {
    // GeoJSON siempre espera [Longitud, Latitud] - PostGIS usa este formato internamente.
    // Si la entrada es [Latitud, Longitud], la mapeamos:
    return {
      type: 'LineString',
      coordinates: coordinates.map(c => [c[1], c[0]]),
    };
  }

  getDWithinCondition(lineColumn: string, lat: number, lng: number, radiusInMeters: number): string {
    return `ST_DWithin(${lineColumn}::geography, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, ${radiusInMeters})`;
  }

  getClosestPointQuery(lineColumn: string, lat: number, lng: number): string {
    return `ST_AsGeoJSON(ST_ClosestPoint(${lineColumn}::geometry, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geometry))`;
  }
}

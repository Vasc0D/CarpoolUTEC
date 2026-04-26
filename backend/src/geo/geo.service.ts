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

  /**
   * Returns a [condition, params] tuple for use with TypeORM QueryBuilder:
   *   .andWhere(...geoService.getDWithinCondition(col, lat, lng, radius, 'key'))
   *
   * The `key` prefix must be unique within a single QueryBuilder instance to
   * prevent parameter name collisions when the method is called multiple times
   * on the same query (e.g. once for pickup, once for dropoff).
   *
   * B-5: named parameters replace raw number interpolation.
   */
  getDWithinCondition(
    lineColumn: string,
    lat: number,
    lng: number,
    radiusInMeters: number,
    key: string,
  ): [string, Record<string, unknown>] {
    return [
      `ST_DWithin(${lineColumn}::geography, ST_SetSRID(ST_MakePoint(:${key}Lng, :${key}Lat), 4326)::geography, :${key}Radius)`,
      { [`${key}Lat`]: lat, [`${key}Lng`]: lng, [`${key}Radius`]: radiusInMeters },
    ];
  }
}

import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class DirectionsService {
  private readonly logger = new Logger(DirectionsService.name);
  private readonly apiKey = process.env.GOOGLE_MAPS_KEY;

  async getRoute(waypoints: { lat: number; lng: number }[]): Promise<{
    polylinePoints: [number, number][];
    durationSeconds: number;
  }> {
    if (waypoints.length < 2) throw new Error('Se necesitan al menos 2 puntos');

    const origin = `${waypoints[0].lat},${waypoints[0].lng}`;
    const destination = `${waypoints[waypoints.length - 1].lat},${waypoints[waypoints.length - 1].lng}`;
    const intermediates = waypoints
      .slice(1, -1)
      .map(w => `${w.lat},${w.lng}`)
      .join('|');

    const params = new URLSearchParams({
      origin,
      destination,
      key: this.apiKey ?? '',
      language: 'es',
      mode: 'driving',
    });
    if (intermediates) params.set('waypoints', intermediates);

    const url = `https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`;
    const res = await fetch(url);
    const data = await res.json() as any;

    if (data.status !== 'OK') {
      this.logger.error(`Directions API error: ${data.status}`);
      throw new Error(`Directions API: ${data.status}`);
    }

    const route = data.routes[0];
    const durationSeconds: number = route.legs.reduce((acc: number, l: any) => acc + l.duration.value, 0);
    const polylinePoints = this.decodePolyline(route.overview_polyline.points);

    return { polylinePoints, durationSeconds };
  }

  private decodePolyline(encoded: string): [number, number][] {
    const points: [number, number][] = [];
    let index = 0, lat = 0, lng = 0;
    while (index < encoded.length) {
      let b: number, shift = 0, result = 0;
      do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      lat += (result & 1) ? ~(result >> 1) : result >> 1;
      shift = 0; result = 0;
      do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      lng += (result & 1) ? ~(result >> 1) : result >> 1;
      points.push([lat / 1e5, lng / 1e5]);
    }
    return points;
  }
}

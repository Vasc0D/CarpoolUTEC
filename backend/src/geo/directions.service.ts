import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class DirectionsService {
  private readonly logger = new Logger(DirectionsService.name);
  // A-5: use ConfigService.getOrThrow so the app refuses to start if the key is absent
  private readonly apiKey: string;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.getOrThrow<string>('GOOGLE_MAPS_KEY');
  }

  async getRoute(waypoints: { lat: number; lng: number }[], departureTime?: Date): Promise<{
    polylinePoints: [number, number][];
    durationSeconds: number;
    legDurations: number[];
    waypointOrder: number[];
  }> {
    if (waypoints.length < 2) throw new Error('Se necesitan al menos 2 puntos');

    const origin = waypoints[0];
    const destination = waypoints[waypoints.length - 1];
    const intermediates = waypoints.slice(1, -1);

    // Google's `optimize:true` is incompatible with `duration_in_traffic`: when both are requested,
    // the legs in the response come without `duration_in_traffic`. We split the work in two calls:
    //   1) one call with optimize:true (no traffic) to get the optimal waypoint order
    //   2) one call with the ordered waypoints (no optimize) WITH departure_time to get duration_in_traffic
    // For 0 or 1 intermediates there is nothing to optimize, so we skip step 1.
    let waypointOrder: number[] = intermediates.map((_, i) => i);
    let orderedIntermediates = intermediates;

    if (intermediates.length > 1) {
      const orderUrl = this.buildUrl(origin, destination, intermediates, { optimize: true });
      const orderData = await this.fetchDirections(orderUrl);
      waypointOrder = orderData.routes[0].waypoint_order ?? waypointOrder;
      orderedIntermediates = waypointOrder.map(i => intermediates[i]);
    }

    const finalUrl = this.buildUrl(origin, destination, orderedIntermediates, {
      optimize: false,
      departureTime,
    });
    const data = await this.fetchDirections(finalUrl);
    const route = data.routes[0];

    const legDurations: number[] = route.legs.map((l: any) =>
      l.duration_in_traffic?.value ?? l.duration.value,
    );
    const durationSeconds = legDurations.reduce((a, b) => a + b, 0);
    const polylinePoints = this.decodePolyline(route.overview_polyline.points);

    return { polylinePoints, durationSeconds, legDurations, waypointOrder };
  }

  private buildUrl(
    origin: { lat: number; lng: number },
    destination: { lat: number; lng: number },
    intermediates: { lat: number; lng: number }[],
    opts: { optimize?: boolean; departureTime?: Date },
  ): string {
    const params = new URLSearchParams({
      origin: `${origin.lat},${origin.lng}`,
      destination: `${destination.lat},${destination.lng}`,
      key: this.apiKey,
      language: 'es',
      mode: 'driving',
    });

    if (intermediates.length > 0) {
      const list = intermediates.map(w => `${w.lat},${w.lng}`).join('|');
      params.set('waypoints', opts.optimize ? `optimize:true|${list}` : list);
    }

    // departure_time only matters in the final (non-optimize) call; including it with optimize:true
    // causes Google to drop duration_in_traffic from the response.
    if (opts.departureTime && !opts.optimize) {
      const nowSec = Math.floor(Date.now() / 1000);
      const unixTs = Math.floor(opts.departureTime.getTime() / 1000);
      params.set('departure_time', unixTs > nowSec ? String(unixTs) : 'now');
      params.set('traffic_model', 'best_guess');
    }

    return `https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`;
  }

  private async fetchDirections(url: string): Promise<any> {
    const res = await fetch(url);
    const data = await res.json() as any;
    if (data.status !== 'OK') {
      this.logger.error(`Directions API error: ${data.status}`);
      throw new Error(`Directions API: ${data.status}`);
    }
    this.logger.debug(`Directions URL: ${url.replace(this.apiKey, 'REDACTED')}`);
    this.logger.debug(`Legs response: ${JSON.stringify(data.routes[0].legs.map((l: any) => ({
      duration: l.duration,
      duration_in_traffic: l.duration_in_traffic,
    })))}`);
    return data;
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

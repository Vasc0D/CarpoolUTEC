import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RouteCache } from './route-cache';

type RouteResult = {
  polylinePoints: [number, number][];
  durationSeconds: number;
  legDurations: number[];
  waypointOrder: number[];
};

/**
 * Routes API v2 client (https://routes.googleapis.com/directions/v2:computeRoutes).
 *
 * Replaces the legacy Directions API because the old endpoint silently drops
 * `duration_in_traffic` from leg responses whenever any intermediate waypoint
 * is present, which made multi-stop ETAs fall back to free-flow estimates.
 * Routes v2 returns traffic-aware leg durations together with optimized
 * waypoint ordering in a single call.
 *
 * Responses are cached for 5 minutes keyed on rounded coordinates and
 * departure-time bucket. Concurrent identical requests still each issue an
 * upstream call (no in-flight dedup yet — that lands with BullMQ in Phase 1);
 * the cache only collapses sequential repeats. Even so, in practice the
 * thundering herd of `findAvailableTrips` previews drops dramatically.
 */
@Injectable()
export class DirectionsService {
  private readonly logger = new Logger(DirectionsService.name);
  private readonly apiKey: string;
  private readonly cache = new RouteCache<RouteResult>(500, 5 * 60 * 1000);

  private static readonly ENDPOINT = 'https://routes.googleapis.com/directions/v2:computeRoutes';
  // Routes v2 requires an explicit field mask; omitting fields here means they won't come back.
  private static readonly FIELD_MASK = [
    'routes.duration',
    'routes.legs.duration',
    'routes.polyline.encodedPolyline',
    'routes.optimizedIntermediateWaypointIndex',
  ].join(',');

  // ~1m precision is plenty for trip routing; finer rounding causes near-identical
  // queries (e.g. 1cm apart) to miss the cache for no functional benefit.
  private static readonly COORD_PRECISION = 5;
  // Bucket departure_time to 5-minute windows so repeated previews collide.
  private static readonly DEPARTURE_BUCKET_MS = 5 * 60 * 1000;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.getOrThrow<string>('GOOGLE_MAPS_KEY');
  }

  async getRoute(waypoints: { lat: number; lng: number }[], departureTime?: Date): Promise<RouteResult> {
    if (waypoints.length < 2) throw new Error('Se necesitan al menos 2 puntos');

    const cacheKey = this.buildCacheKey(waypoints, departureTime);
    const hit = this.cache.get(cacheKey);
    if (hit) {
      this.logger.debug(`Routes cache HIT for key: ${cacheKey}`);
      return hit;
    }

    const origin = waypoints[0];
    const destination = waypoints[waypoints.length - 1];
    const intermediates = waypoints.slice(1, -1);

    const body: Record<string, any> = {
      origin: this.toLatLngWaypoint(origin),
      destination: this.toLatLngWaypoint(destination),
      travelMode: 'DRIVE',
      // TRAFFIC_AWARE: balances accuracy and latency, returns live + historical traffic.
      // Use TRAFFIC_AWARE_OPTIMAL only if higher precision is worth the extra cost.
      routingPreference: 'TRAFFIC_AWARE',
      polylineEncoding: 'ENCODED_POLYLINE',
      languageCode: 'es',
    };

    if (intermediates.length > 0) {
      body.intermediates = intermediates.map(w => this.toLatLngWaypoint(w));
      // No permutation possible with a single intermediate; only opt-in when there's a real choice.
      if (intermediates.length > 1) body.optimizeWaypointOrder = true;
    }

    // departureTime must be in the future for the API to accept it; for "now" or past values
    // Routes v2 implicitly uses the current time when the field is omitted.
    if (departureTime && departureTime.getTime() > Date.now()) {
      body.departureTime = new Date(departureTime.getTime()).toISOString();
    }

    const data = await this.fetchRoute(body);
    const route = data.routes?.[0];
    if (!route) throw new Error('Routes API: no routes returned');

    const legDurations: number[] = (route.legs ?? []).map((l: any) => this.parseDuration(l.duration));
    const durationSeconds = legDurations.length > 0
      ? legDurations.reduce((a, b) => a + b, 0)
      : this.parseDuration(route.duration);
    const polylinePoints = this.decodePolyline(route.polyline?.encodedPolyline ?? '');
    // optimizedIntermediateWaypointIndex is only populated when optimizeWaypointOrder=true was sent.
    const waypointOrder: number[] = route.optimizedIntermediateWaypointIndex
      ?? intermediates.map((_, i) => i);

    const result: RouteResult = { polylinePoints, durationSeconds, legDurations, waypointOrder };
    this.cache.set(cacheKey, result);
    return result;
  }

  private buildCacheKey(waypoints: { lat: number; lng: number }[], departureTime?: Date): string {
    const round = (n: number) => n.toFixed(DirectionsService.COORD_PRECISION);
    const coords = waypoints.map(w => `${round(w.lat)},${round(w.lng)}`).join('|');
    // Bucket the departure window so repeated requests within the same 5-min slice hit cache.
    // For "now"/past values we still bucket on Date.now() so adjacent calls collide.
    const refMs = departureTime && departureTime.getTime() > Date.now()
      ? departureTime.getTime()
      : Date.now();
    const bucket = Math.floor(refMs / DirectionsService.DEPARTURE_BUCKET_MS);
    return `${coords}#${bucket}`;
  }

  private toLatLngWaypoint(p: { lat: number; lng: number }) {
    return { location: { latLng: { latitude: p.lat, longitude: p.lng } } };
  }

  private async fetchRoute(body: Record<string, any>): Promise<any> {
    const res = await fetch(DirectionsService.ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': this.apiKey,
        'X-Goog-FieldMask': DirectionsService.FIELD_MASK,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json() as any;
    if (!res.ok || data.error) {
      const msg = data.error?.message ?? `HTTP ${res.status}`;
      this.logger.error(`Routes API error: ${msg}`);
      throw new Error(`Routes API: ${msg}`);
    }
    this.logger.debug(`Routes request body: ${JSON.stringify(body)}`);
    this.logger.debug(`Routes response legs: ${JSON.stringify(data.routes?.[0]?.legs)}`);
    return data;
  }

  // Routes v2 returns durations as protobuf strings like "1234s" or "1234.5s".
  private parseDuration(s: string | undefined): number {
    if (!s) return 0;
    const match = /^(\d+(?:\.\d+)?)s$/.exec(s);
    return match ? Math.round(parseFloat(match[1])) : 0;
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

/**
 * Full-screen bottom overlay shown to a driver who has an active/scheduled trip.
 * Uses currentRoutePlan.legs to build the route stop list and map polyline —
 * no legacy routePolyline / passengerWaypoints / legDurationsSeconds fields.
 */
import React from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, ScrollView, Linking, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { DriverTripSummary } from '../../api/tripsApi';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const formatTime = (iso: string): string => {
  try {
    return new Date(iso).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
};

const AVATAR_COLORS = ['#10B981', '#F59E0B', '#8B5CF6', '#0EA5E9', '#EF4444', '#EC4899'];
const getAvatarColor = (id: string) => {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash + id.charCodeAt(i)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[hash];
};
const getInitials = (name: string) => {
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
};

// ─── Props ───────────────────────────────────────────────────────────────────

interface DriverTripPanelProps {
  trip: DriverTripSummary;
  tick: number; // incremented every 15 s to re-evaluate time-based conditions
  geocodedAddresses: Record<string, string>;
  startingTrip: boolean;
  finishingTrip: boolean;
  cancelingTrip: boolean;
  onAccept: (bookingId: string) => void;
  onReject: (bookingId: string) => void;
  onStart: () => void;
  onFinish: () => void;
  onCancel: () => void;
}

export const DriverTripPanel: React.FC<DriverTripPanelProps> = ({
  trip, tick, geocodedAddresses,
  startingTrip, finishingTrip, cancelingTrip,
  onAccept, onReject, onStart, onFinish, onCancel,
}) => {
  const insets = useSafeAreaInsets();

  const activeBookings = trip.bookings.filter(
    b => b.status !== 'REJECTED' && b.status !== 'CANCELED',
  );
  const acceptedBookings = trip.bookings.filter(b => b.status === 'ACCEPTED');
  const acceptedCount = acceptedBookings.length;
  const totalSeats = acceptedCount + trip.availableSeats;

  const now = tick >= 0 ? new Date() : new Date();
  const departureMs = new Date(trip.departureTime).getTime();
  const minutesLate = (now.getTime() - departureMs) / 60_000;
  const allBoarded = acceptedBookings.length > 0 && acceptedBookings.every(b => b.isBoarded);
  const graceExpired = minutesLate >= 5;
  const canStart =
    trip.status === 'SCHEDULED' && minutesLate >= 0 && (allBoarded || graceExpired);

  // ── Route stop list from plan legs ─────────────────────────────────────────
  const plan = trip.currentRoutePlan;
  type RouteStop = {
    label: string;
    type: 'origin' | 'passenger' | 'dest';
    names?: string;
    eta?: string;
  };
  const stops: RouteStop[] = [];

  if (plan?.legs?.length) {
    const sorted = [...plan.legs].sort((a, b) => a.legIndex - b.legIndex);
    const departure = new Date(trip.departureTime);

    // Origin
    stops.push({ label: 'UTEC', type: 'origin', eta: formatTime(trip.departureTime) });

    // Passenger drop-offs
    let cumMs = 0;
    for (const leg of sorted) {
      cumMs += Number(leg.durationSeconds) * 1000;
      if (leg.passengerDropOffId) {
        const lat = Number(leg.endLat);
        const lng = Number(leg.endLng);
        const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
        const addr = geocodedAddresses[key] ?? `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
        const etaStr = new Date(departure.getTime() + cumMs)
          .toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
        const booking = acceptedBookings.find(b => b.id === leg.passengerDropOffId);
        const passengerName = booking?.passenger.name.split(' ')[0] ?? '';
        stops.push({ label: addr, type: 'passenger', names: passengerName, eta: etaStr });
      }
    }

    // Final destination
    const lastLeg = sorted[sorted.length - 1];
    const destLat = Number(lastLeg.endLat);
    const destLng = Number(lastLeg.endLng);
    const destKey = `${destLat.toFixed(5)},${destLng.toFixed(5)}`;
    const destAddr =
      geocodedAddresses[destKey] ?? `${destLat.toFixed(4)}, ${destLng.toFixed(4)}`;
    const totalMs = plan.totalDurationSeconds * 1000;
    const finalEta =
      totalMs > 0
        ? new Date(departure.getTime() + totalMs).toLocaleTimeString('es-PE', {
            hour: '2-digit',
            minute: '2-digit',
          })
        : undefined;
    stops.push({ label: destAddr, type: 'dest', eta: finalEta });
  }

  const finalEtaLabel =
    plan?.totalDurationSeconds
      ? new Date(new Date(trip.departureTime).getTime() + plan.totalDurationSeconds * 1000)
          .toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })
      : '--:--';

  return (
    <View style={styles.overlay}>
      <View style={[styles.card, { paddingBottom: insets.bottom }]}>
        {/* Header */}
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Viaje publicado</Text>
          <View style={styles.statusBadge}>
            <Text style={styles.statusText}>
              {trip.status === 'ACTIVE' ? 'En curso' : 'En espera'}
            </Text>
          </View>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 460 }}>
          {/* Route stop list */}
          {stops.length > 0 && (
            <View style={[styles.routeSection, { flexDirection: 'column' }]}>
              {stops.map((stop, i) => (
                <React.Fragment key={i}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <View style={{ width: 12, alignItems: 'center' }}>
                      <View
                        style={
                          stop.type === 'origin'
                            ? styles.originDot
                            : stop.type === 'dest'
                            ? styles.destDot
                            : styles.intermediateDot
                        }
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      {stop.type === 'passenger' && stop.names && (
                        <Text style={styles.intermediateLabel}>Baja: {stop.names}</Text>
                      )}
                      <Text style={styles.routeLabel} numberOfLines={2}>
                        {stop.label}
                      </Text>
                    </View>
                    {stop.eta && (
                      <View style={styles.etaBadge}>
                        <Text style={styles.etaText}>{stop.eta}</Text>
                      </View>
                    )}
                  </View>
                  {i < stops.length - 1 && (
                    <View style={{ flexDirection: 'row', gap: 12 }}>
                      <View style={{ width: 12, alignItems: 'center' }}>
                        {[0, 1, 2].map(j => (
                          <View
                            key={j}
                            style={{
                              width: 2, height: 5,
                              backgroundColor: '#CBD5E1', borderRadius: 1, marginVertical: 1,
                            }}
                          />
                        ))}
                      </View>
                    </View>
                  )}
                </React.Fragment>
              ))}
            </View>
          )}

          {/* Stats */}
          <View style={styles.stats}>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{formatTime(trip.departureTime)}</Text>
              <Text style={styles.statLabel}>Salida</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{finalEtaLabel}</Text>
              <Text style={styles.statLabel}>Llegada final</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{acceptedCount}/{totalSeats}</Text>
              <Text style={styles.statLabel}>Asientos</Text>
            </View>
          </View>

          {/* Passengers */}
          <Text style={styles.passengersLabel}>
            Pasajeros ({acceptedCount} confirmado{acceptedCount !== 1 ? 's' : ''})
          </Text>

          {activeBookings.length === 0 ? (
            <View style={styles.emptyPassengers}>
              <Text style={styles.emptyPassengersText}>Aún no hay pasajeros</Text>
            </View>
          ) : (
            activeBookings.map(b => {
              const bLat = b.destLat != null ? Number(b.destLat) : null;
              const bLng = b.destLng != null ? Number(b.destLng) : null;
              const validDrop = bLat != null && !isNaN(bLat) && bLng != null && !isNaN(bLng);
              const dropKey = validDrop ? `${bLat!.toFixed(5)},${bLng!.toFixed(5)}` : null;
              const dropAddress = dropKey
                ? (geocodedAddresses[dropKey] ?? `${bLat!.toFixed(4)}, ${bLng!.toFixed(4)}`)
                : null;
              const initials = getInitials(b.passenger.name);
              const avatarColor = getAvatarColor(b.passenger.id);

              return (
                <View key={b.id} style={styles.passengerRow}>
                  <View style={[styles.passengerAvatar, { backgroundColor: avatarColor }]}>
                    <Text style={styles.passengerAvatarText}>{initials}</Text>
                  </View>
                  <View style={styles.passengerInfo}>
                    <Text style={styles.passengerName} numberOfLines={1}>
                      {b.passenger.name}
                    </Text>
                    <Text style={styles.passengerDrop} numberOfLines={1}>
                      {dropAddress ? `Baja en ${dropAddress}` : 'Baja en destino final'}
                    </Text>
                  </View>
                  {b.status === 'PENDING' ? (
                    <View style={styles.passengerActions}>
                      <TouchableOpacity
                        style={[styles.actionBtn, { backgroundColor: '#DCFCE7' }]}
                        onPress={() => onAccept(b.id)}
                      >
                        <Ionicons name="checkmark" size={15} color="#16A34A" />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.actionBtn, { backgroundColor: '#FEE2E2' }]}
                        onPress={() => onReject(b.id)}
                      >
                        <Ionicons name="close" size={15} color="#DC2626" />
                      </TouchableOpacity>
                    </View>
                  ) : b.status === 'ACCEPTED' ? (
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <View style={[styles.badge, { backgroundColor: '#DCFCE7' }]}>
                        <Text style={[styles.badgeText, { color: '#16A34A' }]}>Confirmado</Text>
                      </View>
                      <View
                        style={[
                          styles.badge,
                          { backgroundColor: b.isBoarded ? '#DBEAFE' : '#FEF3C7' },
                        ]}
                      >
                        <Text
                          style={[
                            styles.badgeText,
                            { color: b.isBoarded ? '#2563EB' : '#B45309' },
                          ]}
                        >
                          {b.isBoarded ? '✓ A bordo' : ' Sin subir'}
                        </Text>
                      </View>
                    </View>
                  ) : (
                    <View
                      style={[
                        styles.badge,
                        { backgroundColor: b.status === 'COMPLETED' ? '#DBEAFE' : '#F1F5F9' },
                      ]}
                    >
                      <Text
                        style={[
                          styles.badgeText,
                          { color: b.status === 'COMPLETED' ? '#2563EB' : '#64748B' },
                        ]}
                      >
                        {b.status === 'COMPLETED' ? 'Completado' : b.status}
                      </Text>
                    </View>
                  )}
                </View>
              );
            })
          )}

          {/* Boarding wait hint */}
          {trip.status === 'SCHEDULED' &&
            minutesLate >= 0 &&
            !canStart &&
            acceptedBookings.length > 0 && (
              <View style={styles.waitRow}>
                <Ionicons name="time-outline" size={15} color="#F59E0B" />
                <Text style={styles.waitText}>
                  {graceExpired
                    ? 'Puedes iniciar aunque falten pasajeros'
                    : `Esperando que todos suban al auto (${Math.ceil(5 - minutesLate)} min restantes)`}
                </Text>
              </View>
            )}

          {canStart && (
            <TouchableOpacity
              style={[styles.actionLarge, { backgroundColor: '#0EA5E9' }]}
              onPress={onStart}
              disabled={startingTrip}
            >
              {startingTrip ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <>
                  <Ionicons name="play-circle-outline" size={18} color="#FFF" />
                  <Text style={styles.actionLargeText}>Iniciar Viaje</Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {trip.status === 'ACTIVE' && (
            <TouchableOpacity
              style={[styles.actionLarge, { backgroundColor: '#EF4444' }]}
              onPress={onFinish}
              disabled={finishingTrip}
            >
              {finishingTrip ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <>
                  <Ionicons name="flag-outline" size={18} color="#FFF" />
                  <Text style={styles.actionLargeText}>Finalizar Viaje</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </ScrollView>

        {/* Cancel — only while SCHEDULED and before departure */}
        {trip.status === 'SCHEDULED' &&
          tick >= 0 &&
          new Date() < new Date(trip.departureTime) && (
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={onCancel}
              disabled={cancelingTrip}
              activeOpacity={0.75}
            >
              {cancelingTrip ? (
                <ActivityIndicator size="small" color="#EF4444" />
              ) : (
                <>
                  <Ionicons name="close-circle-outline" size={16} color="#EF4444" />
                  <Text style={styles.cancelBtnText}>Cancelar viaje</Text>
                </>
              )}
            </TouchableOpacity>
          )}
      </View>
    </View>
  );
};

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0, top: 0,
    justifyContent: 'flex-end', zIndex: 20,
  },
  card: {
    backgroundColor: '#0F172A',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingTop: 20, paddingHorizontal: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.3, shadowRadius: 20, elevation: 24,
  },
  cardHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16,
  },
  cardTitle: { fontSize: 17, fontWeight: '800', color: '#FFF' },
  statusBadge: {
    backgroundColor: '#1E293B', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20,
  },
  statusText: { fontSize: 11, fontWeight: '600', color: '#94A3B8' },

  routeSection: { marginBottom: 16 },
  originDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#0EA5E9' },
  destDot: { width: 10, height: 10, borderRadius: 2, backgroundColor: '#10B981' },
  intermediateDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#F59E0B' },
  intermediateLabel: { fontSize: 10, color: '#94A3B8', fontWeight: '600' },
  routeLabel: { fontSize: 13, color: '#E2E8F0', fontWeight: '500' },
  etaBadge: {
    backgroundColor: '#1E293B', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8,
  },
  etaText: { fontSize: 11, color: '#94A3B8', fontWeight: '600' },

  stats: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  stat: {
    flex: 1, backgroundColor: '#1E293B', borderRadius: 10, padding: 10, alignItems: 'center',
  },
  statValue: { fontSize: 14, fontWeight: '700', color: '#FFF' },
  statLabel: { fontSize: 10, color: '#64748B', marginTop: 2 },

  passengersLabel: { fontSize: 13, fontWeight: '700', color: '#94A3B8', marginBottom: 8 },
  emptyPassengers: { alignItems: 'center', paddingVertical: 16 },
  emptyPassengersText: { fontSize: 13, color: '#475569' },

  passengerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: '#1E293B',
  },
  passengerAvatar: {
    width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center',
  },
  passengerAvatarText: { color: '#FFF', fontSize: 13, fontWeight: '700' },
  passengerInfo: { flex: 1, gap: 2 },
  passengerName: { fontSize: 14, fontWeight: '600', color: '#F1F5F9' },
  passengerDrop: { fontSize: 11, color: '#64748B' },
  passengerActions: { flexDirection: 'row', gap: 6 },
  actionBtn: { width: 30, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center' },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  badgeText: { fontSize: 10, fontWeight: '600' },

  waitRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FFF7ED', borderRadius: 10, padding: 10, marginTop: 8,
  },
  waitText: { flex: 1, fontSize: 12, color: '#92400E' },

  actionLarge: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 14, borderRadius: 14, marginTop: 10,
  },
  actionLargeText: { color: '#FFF', fontSize: 16, fontWeight: '700' },

  cancelBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 12, marginTop: 8,
    borderTopWidth: 1, borderTopColor: '#1E293B',
  },
  cancelBtnText: { fontSize: 14, color: '#EF4444', fontWeight: '600' },
});

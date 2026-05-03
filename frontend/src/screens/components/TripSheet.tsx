/**
 * Bottom-sheet modal shown when a passenger taps a trip card.
 * Displays driver info, departure/arrival times, and booking CTA.
 */
import React, { useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal,
  ActivityIndicator, Animated, Dimensions, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { TripMarker, ActiveBooking } from '../../api/tripsApi';

const { height } = Dimensions.get('window');

const formatTime = (iso: string): string => {
  try {
    return new Date(iso).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
};

const formatETA = (departureTime: string, durationSeconds?: number): string => {
  if (!durationSeconds) return '';
  const eta = new Date(new Date(departureTime).getTime() + durationSeconds * 1000);
  return eta.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
};

const BOOKING_STATUS_CONFIG = {
  PENDING: {
    icon: 'time-outline' as const,
    color: '#F59E0B',
    title: 'Solicitud enviada',
    subtitle: 'Esperando confirmación del conductor.',
  },
  ACCEPTED: {
    icon: 'checkmark-circle-outline' as const,
    color: '#10B981',
    title: '¡Confirmado!',
    subtitle: 'El conductor ya te espera.',
  },
};

interface TripSheetProps {
  trip: TripMarker | null;
  onClose: () => void;
  onBook: (tripId: string) => void;
  onCancelBooking: (bookingId: string) => void;
  booking: boolean;
  booked: boolean;
  canceling: boolean;
  myBooking: ActiveBooking | null;
}

export const TripSheet: React.FC<TripSheetProps> = ({
  trip, onClose, onBook, onCancelBooking, booking, booked, canceling, myBooking,
}) => {
  const slideAnim = useRef(new Animated.Value(height)).current;
  const successScale = useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (trip) {
      Animated.spring(slideAnim, { toValue: 0, tension: 65, friction: 11, useNativeDriver: true }).start();
    } else {
      Animated.timing(slideAnim, { toValue: height, duration: 250, useNativeDriver: true }).start();
    }
  }, [trip]);

  useEffect(() => {
    if (booked) {
      Animated.spring(successScale, { toValue: 1, tension: 80, friction: 8, useNativeDriver: true }).start();
    } else {
      successScale.setValue(0);
    }
  }, [booked]);

  if (!trip) return null;

  const statusCfg = myBooking ? BOOKING_STATUS_CONFIG[myBooking.status] : null;
  const plan = trip.currentRoutePlan;

  return (
    <Modal transparent visible={!!trip} onRequestClose={onClose} animationType="none">
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <Animated.View
        style={[styles.sheet, { paddingBottom: insets.bottom + 16, transform: [{ translateY: slideAnim }] }]}
      >
        <View style={styles.sheetHandle} />

        {booked ? (
          <View style={styles.successContainer}>
            <Animated.View style={[styles.successIcon, { transform: [{ scale: successScale }] }]}>
              <Ionicons name="checkmark-circle" size={72} color="#10B981" />
            </Animated.View>
            <Text style={styles.successTitle}>¡Solicitud enviada!</Text>
            <Text style={styles.successSubtitle}>
              El conductor revisará tu solicitud y te notificará pronto.
            </Text>
            <TouchableOpacity style={styles.closeSuccessButton} onPress={onClose}>
              <Text style={styles.closeSuccessText}>Entendido</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={styles.sheetHeader}>
              <View style={styles.driverAvatar}>
                <Text style={styles.driverAvatarText}>
                  {trip.driver.name?.[0]?.toUpperCase() ?? '?'}
                </Text>
              </View>
              <View style={styles.driverInfo}>
                <Text style={styles.driverName}>{trip.driver.name}</Text>
                {trip.driver.vehicle && (
                  <Text style={styles.vehicleText}>
                    {trip.driver.vehicle.brand} · {trip.driver.vehicle.model} · {trip.driver.vehicle.color} · {trip.driver.vehicle.plate}
                  </Text>
                )}
              </View>
            </View>

            <View style={styles.infoRow}>
              <View style={styles.infoCard}>
                <Ionicons name="people-outline" size={22} color="#0EA5E9" />
                <Text style={styles.infoValue}>{trip.availableSeats}</Text>
                <Text style={styles.infoLabel}>Asientos</Text>
              </View>
              <View style={styles.infoCard}>
                <Ionicons name="time-outline" size={22} color="#0EA5E9" />
                <Text style={styles.infoValue}>{formatTime(trip.departureTime)}</Text>
                <Text style={styles.infoLabel}>Salida</Text>
              </View>
              <View style={styles.infoCard}>
                <Ionicons name="flag-outline" size={22} color="#10B981" />
                <Text style={styles.infoValue}>
                  {plan ? formatETA(trip.departureTime, plan.totalDurationSeconds) : '--:--'}
                </Text>
                <Text style={styles.infoLabel}>Llegada final</Text>
              </View>
            </View>

            {statusCfg && myBooking ? (
              <View style={[styles.bookingStatusCard, { borderColor: statusCfg.color + '40' }]}>
                <View style={styles.bookingStatusHeader}>
                  <Ionicons name={statusCfg.icon} size={22} color={statusCfg.color} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.bookingStatusTitle, { color: statusCfg.color }]}>
                      {statusCfg.title}
                    </Text>
                    <Text style={styles.bookingStatusSubtitle}>{statusCfg.subtitle}</Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={styles.cancelBookingBtn}
                  onPress={() => onCancelBooking(myBooking.id)}
                  disabled={canceling}
                  activeOpacity={0.75}
                >
                  {canceling
                    ? <ActivityIndicator size="small" color="#EF4444" />
                    : <>
                        <Ionicons name="close-circle-outline" size={16} color="#EF4444" />
                        <Text style={styles.cancelBookingBtnText}>Cancelar reserva</Text>
                      </>
                  }
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={[
                  styles.bookButton,
                  (booking || trip.availableSeats === 0) && styles.bookButtonDisabled,
                ]}
                onPress={() => onBook(trip.id)}
                disabled={booking || trip.availableSeats === 0}
                activeOpacity={0.85}
              >
                {booking ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <>
                    <Ionicons name="car-sport-outline" size={20} color="#FFF" style={{ marginRight: 8 }} />
                    <Text style={styles.bookButtonText}>
                      {trip.availableSeats === 0 ? 'Sin asientos disponibles' : 'Solicitar Asiento'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            )}
          </ScrollView>
        )}
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    paddingHorizontal: 20,
    maxHeight: '85%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 24,
  },
  sheetHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: '#E2E8F0', alignSelf: 'center', marginBottom: 16,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  driverAvatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: '#0F172A', justifyContent: 'center', alignItems: 'center',
  },
  driverAvatarText: { color: '#38BDF8', fontSize: 18, fontWeight: '900' },
  driverInfo: { flex: 1 },
  driverName: { fontSize: 17, fontWeight: '700', color: '#0F172A' },
  vehicleText: { fontSize: 12, color: '#64748B', marginTop: 2 },
  infoRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  infoCard: {
    flex: 1, backgroundColor: '#F8FAFC', borderRadius: 12,
    padding: 12, alignItems: 'center', gap: 4,
    borderWidth: 1, borderColor: '#E2E8F0',
  },
  infoValue: { fontSize: 15, fontWeight: '700', color: '#0F172A' },
  infoLabel: { fontSize: 11, color: '#94A3B8' },
  bookingStatusCard: {
    borderRadius: 12, borderWidth: 1.5, padding: 14, marginBottom: 12, gap: 12,
  },
  bookingStatusHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  bookingStatusTitle: { fontSize: 14, fontWeight: '700' },
  bookingStatusSubtitle: { fontSize: 12, color: '#64748B', marginTop: 2 },
  cancelBookingBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 10, borderRadius: 10,
    borderWidth: 1, borderColor: '#FECACA', backgroundColor: '#FEF2F2',
  },
  cancelBookingBtnText: { fontSize: 14, color: '#EF4444', fontWeight: '600' },
  bookButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#0EA5E9', paddingVertical: 16, borderRadius: 16, gap: 4, marginBottom: 8,
  },
  bookButtonDisabled: { backgroundColor: '#94A3B8' },
  bookButtonText: { color: '#FFF', fontSize: 17, fontWeight: '700' },
  successContainer: { alignItems: 'center', paddingVertical: 24, gap: 12 },
  successIcon: { marginBottom: 8 },
  successTitle: { fontSize: 22, fontWeight: '800', color: '#0F172A' },
  successSubtitle: { fontSize: 14, color: '#64748B', textAlign: 'center', lineHeight: 20 },
  closeSuccessButton: {
    marginTop: 8, backgroundColor: '#0F172A',
    paddingVertical: 14, paddingHorizontal: 40, borderRadius: 14,
  },
  closeSuccessText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
});

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    View, Text, StyleSheet, FlatList, TouchableOpacity,
    ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import type { Socket } from 'socket.io-client';
import { axiosClient } from '../api/axiosClient';
import { createSocket } from '../api/socketClient';
import { useAuthStore } from '../store/authStore';

// ─── Types ───────────────────────────────────────────────────────────────────

interface BookingItem {
    id: string;
    status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELED';
    passenger: { id: string; name: string };
    createdAt: string;
}

interface DriverTrip {
    id: string;
    departureTime: string;
    status: 'SCHEDULED' | 'ACTIVE' | 'COMPLETED' | 'CANCELED';
    availableSeats: number;
    autoAccept: boolean;
    bookings: BookingItem[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const formatDateTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('es-PE', { weekday: 'short', day: 'numeric', month: 'short' })
        + ' · '
        + d.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
};

const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });

const STATUS_LABEL: Record<DriverTrip['status'], string> = {
    SCHEDULED: 'Programado',
    ACTIVE: 'En curso',
    COMPLETED: 'Completado',
    CANCELED: 'Cancelado',
};

const STATUS_COLOR: Record<DriverTrip['status'], string> = {
    SCHEDULED: '#10B981',
    ACTIVE: '#0EA5E9',
    COMPLETED: '#64748B',
    CANCELED: '#EF4444',
};

// ─── Booking Row ─────────────────────────────────────────────────────────────

interface BookingRowProps {
    booking: BookingItem;
    onAccept: (id: string) => void;
    onReject: (id: string) => void;
    busy: boolean;
}

const BookingRow: React.FC<BookingRowProps> = ({ booking, onAccept, onReject, busy }) => (
    <View style={styles.bookingRow}>
        <View style={styles.passengerAvatar}>
            <Text style={styles.passengerAvatarText}>
                {booking.passenger.name?.[0]?.toUpperCase() ?? '?'}
            </Text>
        </View>
        <Text style={styles.passengerName} numberOfLines={1}>{booking.passenger.name}</Text>
        <View style={styles.bookingActions}>
            <TouchableOpacity
                style={[styles.actionBtn, styles.rejectBtn]}
                onPress={() => onReject(booking.id)}
                disabled={busy}
            >
                {busy ? <ActivityIndicator size="small" color="#EF4444" /> : <Ionicons name="close" size={18} color="#EF4444" />}
            </TouchableOpacity>
            <TouchableOpacity
                style={[styles.actionBtn, styles.acceptBtn]}
                onPress={() => onAccept(booking.id)}
                disabled={busy}
            >
                {busy ? <ActivityIndicator size="small" color="#FFF" /> : <Ionicons name="checkmark" size={18} color="#FFF" />}
            </TouchableOpacity>
        </View>
    </View>
);

// ─── Trip Card ────────────────────────────────────────────────────────────────

interface TripCardProps {
    trip: DriverTrip;
    busyBookingId: string | null;
    cancelingTripId: string | null;
    startingTripId: string | null;
    finishingTripId: string | null;
    onAccept: (bookingId: string, tripId: string) => void;
    onReject: (bookingId: string, tripId: string) => void;
    onCancel: (tripId: string) => void;
    onStart: (tripId: string) => void;
    onFinish: (tripId: string) => void;
}

const TripCard: React.FC<TripCardProps> = ({
    trip, busyBookingId, cancelingTripId, startingTripId, finishingTripId,
    onAccept, onReject, onCancel, onStart, onFinish,
}) => {
    const pending = trip.bookings.filter(b => b.status === 'PENDING');
    const accepted = trip.bookings.filter(b => b.status === 'ACCEPTED').length;
    const isCanceling = cancelingTripId === trip.id;
    const isStarting = startingTripId === trip.id;
    const isFinishing = finishingTripId === trip.id;
    const canStart = trip.status === 'SCHEDULED' && new Date() >= new Date(trip.departureTime);

    return (
        <View style={styles.card}>
            {/* Card header */}
            <View style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                    <Text style={styles.cardTime}>{formatDateTime(trip.departureTime)}</Text>
                    <View style={styles.cardMeta}>
                        <Ionicons name="people-outline" size={13} color="#64748B" />
                        <Text style={styles.cardMetaText}>{trip.availableSeats} asientos libres · {accepted} aceptado{accepted !== 1 ? 's' : ''}</Text>
                    </View>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 6 }}>
                    <View style={[styles.statusBadge, { backgroundColor: STATUS_COLOR[trip.status] + '20' }]}>
                        <Text style={[styles.statusText, { color: STATUS_COLOR[trip.status] }]}>
                            {STATUS_LABEL[trip.status]}
                        </Text>
                    </View>
                    <View style={styles.modeBadge}>
                        <Ionicons
                            name={trip.autoAccept ? 'flash-outline' : 'hand-left-outline'}
                            size={11}
                            color="#64748B"
                        />
                        <Text style={styles.modeText}>{trip.autoAccept ? 'Automático' : 'Manual'}</Text>
                    </View>
                </View>
            </View>

            {/* Pending bookings */}
            {pending.length > 0 ? (
                <View style={styles.pendingSection}>
                    <Text style={styles.pendingTitle}>
                        {pending.length} solicitud{pending.length !== 1 ? 'es' : ''} pendiente{pending.length !== 1 ? 's' : ''}
                    </Text>
                    {pending.map(b => (
                        <BookingRow
                            key={b.id}
                            booking={b}
                            onAccept={id => onAccept(id, trip.id)}
                            onReject={id => onReject(id, trip.id)}
                            busy={busyBookingId === b.id}
                        />
                    ))}
                </View>
            ) : (
                <View style={styles.emptyBookings}>
                    <Ionicons name="checkmark-circle-outline" size={15} color="#94A3B8" />
                    <Text style={styles.emptyBookingsText}>Sin solicitudes pendientes</Text>
                </View>
            )}

            {/* Start / Finish buttons */}
            {trip.status === 'SCHEDULED' && (
                canStart ? (
                    <TouchableOpacity
                        style={styles.startTripBtn}
                        onPress={() => onStart(trip.id)}
                        disabled={isStarting}
                        activeOpacity={0.75}
                    >
                        {isStarting ? (
                            <ActivityIndicator size="small" color="#FFF" />
                        ) : (
                            <>
                                <Ionicons name="play-circle-outline" size={15} color="#FFF" />
                                <Text style={styles.startTripBtnText}>Iniciar Viaje</Text>
                            </>
                        )}
                    </TouchableOpacity>
                ) : (
                    <View style={styles.startTripBtnDisabled}>
                        <Ionicons name="time-outline" size={15} color="#94A3B8" />
                        <Text style={styles.startTripBtnDisabledText}>Disponible a las {formatTime(trip.departureTime)}</Text>
                    </View>
                )
            )}

            {trip.status === 'ACTIVE' && (
                <TouchableOpacity
                    style={styles.finishTripBtn}
                    onPress={() => onFinish(trip.id)}
                    disabled={isFinishing}
                    activeOpacity={0.75}
                >
                    {isFinishing ? (
                        <ActivityIndicator size="small" color="#FFF" />
                    ) : (
                        <>
                            <Ionicons name="checkmark-circle-outline" size={15} color="#FFF" />
                            <Text style={styles.finishTripBtnText}>Finalizar Viaje</Text>
                        </>
                    )}
                </TouchableOpacity>
            )}

            {/* Cancel — only while SCHEDULED */}
            {trip.status === 'SCHEDULED' && (
                <TouchableOpacity
                    style={styles.cancelTripBtn}
                    onPress={() => onCancel(trip.id)}
                    disabled={isCanceling}
                    activeOpacity={0.75}
                >
                    {isCanceling ? (
                        <ActivityIndicator size="small" color="#EF4444" />
                    ) : (
                        <>
                            <Ionicons name="close-circle-outline" size={15} color="#EF4444" />
                            <Text style={styles.cancelTripBtnText}>Cancelar viaje</Text>
                        </>
                    )}
                </TouchableOpacity>
            )}
        </View>
    );
};

// ─── Main Screen ──────────────────────────────────────────────────────────────

export const DriverTripsScreen = () => {
    const insets = useSafeAreaInsets();
    const { token } = useAuthStore();
    const socketRef = useRef<Socket | null>(null);
    const locationWatcherRef = useRef<Location.LocationSubscription | null>(null);

    const [trips, setTrips] = useState<DriverTrip[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [busyBookingId, setBusyBookingId] = useState<string | null>(null);
    const [cancelingTripId, setCancelingTripId] = useState<string | null>(null);
    const [startingTripId, setStartingTripId] = useState<string | null>(null);
    const [finishingTripId, setFinishingTripId] = useState<string | null>(null);

    const fetchTrips = useCallback(async (silent = false) => {
        if (!silent) setLoading(true);
        try {
            const { data } = await axiosClient.get('/trips/my-trips');
            setTrips(data ?? []);
        } catch {
            Alert.alert('Error', 'No se pudieron cargar tus viajes.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => { fetchTrips(); }, [fetchTrips]);

    // ── Emit driver location every 5s while a trip is ACTIVE ─────────────────
    const activeTrip = trips.find(t => t.status === 'ACTIVE');

    useEffect(() => {
        if (!activeTrip || !token) return;

        const socket = createSocket(token);
        socketRef.current = socket;
        socket.connect();

        let unmounted = false;
        Location.requestForegroundPermissionsAsync().then(({ status }) => {
            if (status !== 'granted' || unmounted) return;
            Location.watchPositionAsync(
                { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 0 },
                (loc) => {
                    socketRef.current?.emit('driver_location', {
                        tripId: activeTrip.id,
                        lat: loc.coords.latitude,
                        lng: loc.coords.longitude,
                    });
                }
            ).then(sub => {
                if (unmounted) { sub.remove(); return; }
                locationWatcherRef.current = sub;
            });
        });

        return () => {
            unmounted = true;
            locationWatcherRef.current?.remove();
            locationWatcherRef.current = null;
            socket.disconnect();
            socketRef.current = null;
        };
    }, [activeTrip?.id, token]);

    // ── Handlers ─────────────────────────────────────────────────────────────

    const handleAccept = async (bookingId: string, tripId: string) => {
        setBusyBookingId(bookingId);
        try {
            await axiosClient.patch(`/bookings/${bookingId}/accept`);
            setTrips(prev => prev.map(t => t.id !== tripId ? t : {
                ...t,
                availableSeats: t.availableSeats - 1,
                bookings: t.bookings.map(b =>
                    b.id === bookingId ? { ...b, status: 'ACCEPTED' as const } : b
                ),
            }));
        } catch (error: any) {
            const msg = error.response?.data?.message || 'No se pudo aceptar la solicitud.';
            Alert.alert('Error', Array.isArray(msg) ? msg.join('\n') : msg);
        } finally {
            setBusyBookingId(null);
        }
    };

    const handleReject = async (bookingId: string, tripId: string) => {
        setBusyBookingId(bookingId);
        try {
            await axiosClient.patch(`/bookings/${bookingId}/reject`);
            setTrips(prev => prev.map(t => t.id !== tripId ? t : {
                ...t,
                bookings: t.bookings.map(b =>
                    b.id === bookingId ? { ...b, status: 'REJECTED' as const } : b
                ),
            }));
        } catch (error: any) {
            const msg = error.response?.data?.message || 'No se pudo rechazar la solicitud.';
            Alert.alert('Error', Array.isArray(msg) ? msg.join('\n') : msg);
        } finally {
            setBusyBookingId(null);
        }
    };

    const handleCancelTrip = (tripId: string) => {
        Alert.alert(
            'Cancelar viaje',
            'Se cancelarán todas las reservas activas y se notificará a los pasajeros. ¿Continuar?',
            [
                { text: 'No', style: 'cancel' },
                {
                    text: 'Sí, cancelar',
                    style: 'destructive',
                    onPress: async () => {
                        setCancelingTripId(tripId);
                        try {
                            await axiosClient.patch(`/trips/${tripId}/cancel`);
                            setTrips(prev => prev.map(t =>
                                t.id === tripId ? { ...t, status: 'CANCELED' as const } : t
                            ));
                        } catch (error: any) {
                            const msg = error.response?.data?.message || 'No se pudo cancelar el viaje.';
                            Alert.alert('Error', Array.isArray(msg) ? msg.join('\n') : msg);
                        } finally {
                            setCancelingTripId(null);
                        }
                    },
                },
            ]
        );
    };

    const handleStartTrip = async (tripId: string) => {
        setStartingTripId(tripId);
        try {
            await axiosClient.patch(`/trips/${tripId}/start`);
            setTrips(prev => prev.map(t =>
                t.id === tripId ? { ...t, status: 'ACTIVE' as const } : t
            ));
        } catch (error: any) {
            const msg = error.response?.data?.message || 'No se pudo iniciar el viaje.';
            Alert.alert('Error', Array.isArray(msg) ? msg.join('\n') : msg);
        } finally {
            setStartingTripId(null);
        }
    };

    const handleFinishTrip = (tripId: string) => {
        Alert.alert(
            'Finalizar viaje',
            '¿Confirmas que el viaje ha terminado?',
            [
                { text: 'No', style: 'cancel' },
                {
                    text: 'Sí, finalizar',
                    style: 'destructive',
                    onPress: async () => {
                        setFinishingTripId(tripId);
                        try {
                            await axiosClient.patch(`/trips/${tripId}/finish`);
                            locationWatcherRef.current?.remove();
                            locationWatcherRef.current = null;
                            socketRef.current?.disconnect();
                            socketRef.current = null;
                            setTrips(prev => prev.map(t =>
                                t.id === tripId ? { ...t, status: 'COMPLETED' as const } : t
                            ));
                        } catch (error: any) {
                            const msg = error.response?.data?.message || 'No se pudo finalizar el viaje.';
                            Alert.alert('Error', Array.isArray(msg) ? msg.join('\n') : msg);
                        } finally {
                            setFinishingTripId(null);
                        }
                    },
                },
            ]
        );
    };

    if (loading) {
        return (
            <View style={styles.centered}>
                <ActivityIndicator size="large" color="#10B981" />
            </View>
        );
    }

    return (
        <FlatList
            data={trips}
            keyExtractor={t => t.id}
            contentContainerStyle={[
                styles.list,
                { paddingBottom: insets.bottom + 24 },
                trips.length === 0 && styles.listEmpty,
            ]}
            refreshControl={
                <RefreshControl
                    refreshing={refreshing}
                    onRefresh={() => { setRefreshing(true); fetchTrips(true); }}
                    tintColor="#10B981"
                />
            }
            renderItem={({ item }) => (
                <TripCard
                    trip={item}
                    busyBookingId={busyBookingId}
                    cancelingTripId={cancelingTripId}
                    startingTripId={startingTripId}
                    finishingTripId={finishingTripId}
                    onAccept={handleAccept}
                    onReject={handleReject}
                    onCancel={handleCancelTrip}
                    onStart={handleStartTrip}
                    onFinish={handleFinishTrip}
                />
            )}
            ListEmptyComponent={
                <View style={styles.emptyState}>
                    <Ionicons name="car-outline" size={52} color="#CBD5E1" />
                    <Text style={styles.emptyTitle}>Sin viajes publicados</Text>
                    <Text style={styles.emptySubtitle}>Publica tu primer viaje desde la pantalla principal.</Text>
                </View>
            }
        />
    );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    list: { padding: 16, gap: 12 },
    listEmpty: { flex: 1, justifyContent: 'center' },

    card: {
        backgroundColor: '#FFF',
        borderRadius: 20,
        padding: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.07,
        shadowRadius: 8,
        elevation: 3,
    },
    cardHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
    cardTime: { fontSize: 15, fontWeight: '700', color: '#0F172A', marginBottom: 4 },
    cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    cardMetaText: { fontSize: 12, color: '#64748B' },

    statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
    statusText: { fontSize: 11, fontWeight: '700' },
    modeBadge: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    modeText: { fontSize: 11, color: '#64748B' },

    pendingSection: { borderTopWidth: 1, borderTopColor: '#F1F5F9', paddingTop: 12, gap: 8 },
    pendingTitle: { fontSize: 12, fontWeight: '700', color: '#F59E0B', marginBottom: 2 },

    bookingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    passengerAvatar: {
        width: 34, height: 34, borderRadius: 17,
        backgroundColor: '#0F172A', justifyContent: 'center', alignItems: 'center',
    },
    passengerAvatarText: { color: '#38BDF8', fontSize: 14, fontWeight: '800' },
    passengerName: { flex: 1, fontSize: 14, fontWeight: '600', color: '#1E293B' },
    bookingActions: { flexDirection: 'row', gap: 8 },
    actionBtn: {
        width: 36, height: 36, borderRadius: 18,
        justifyContent: 'center', alignItems: 'center',
    },
    rejectBtn: { backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA' },
    acceptBtn: { backgroundColor: '#10B981' },

    startTripBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
        borderRadius: 12, paddingVertical: 10, backgroundColor: '#10B981', marginTop: 4,
    },
    startTripBtnText: { fontSize: 13, fontWeight: '700', color: '#FFF' },
    startTripBtnDisabled: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
        borderRadius: 12, paddingVertical: 10, backgroundColor: '#F1F5F9', marginTop: 4,
    },
    startTripBtnDisabledText: { fontSize: 13, fontWeight: '600', color: '#94A3B8' },

    finishTripBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
        borderRadius: 12, paddingVertical: 10, backgroundColor: '#0EA5E9', marginTop: 4,
    },
    finishTripBtnText: { fontSize: 13, fontWeight: '700', color: '#FFF' },

    cancelTripBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
        borderWidth: 1, borderColor: '#FECACA', borderRadius: 12,
        paddingVertical: 10, backgroundColor: '#FFF5F5', marginTop: 4,
    },
    cancelTripBtnText: { fontSize: 13, fontWeight: '700', color: '#EF4444' },

    emptyBookings: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        borderTopWidth: 1, borderTopColor: '#F1F5F9', paddingTop: 10,
    },
    emptyBookingsText: { fontSize: 12, color: '#94A3B8' },

    emptyState: { alignItems: 'center', gap: 10, paddingHorizontal: 40 },
    emptyTitle: { fontSize: 18, fontWeight: '800', color: '#334155' },
    emptySubtitle: { fontSize: 14, color: '#94A3B8', textAlign: 'center', lineHeight: 20 },
});

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    View, Text, StyleSheet, FlatList, TouchableOpacity,
    ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import type { Socket } from 'socket.io-client';
import { createSocket } from '../api/socketClient';
import { useAuthStore } from '../store/authStore';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { axiosClient } from '../api/axiosClient';

// ─── Types ───────────────────────────────────────────────────────────────────

type BookingStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELED' | 'ACTIVE' | 'COMPLETED';

interface MyBooking {
    id: string;
    status: BookingStatus;
    isBoarded?: boolean;
    canceledByDriver?: boolean;
    trip: {
        id: string;
        departureTime: string;
        driver: {
            id: string;
            name: string;
            vehicle: { brand: string; model: string; color: string; plate: string } | null;
        };
    };
    createdAt: string;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<BookingStatus, { label: string; color: string; icon: keyof typeof Ionicons.glyphMap }> = {
    ACTIVE:    { label: 'En curso',    color: '#0EA5E9', icon: 'navigate-outline' },
    PENDING:   { label: 'Pendiente',   color: '#F59E0B', icon: 'time-outline' },
    ACCEPTED:  { label: 'Aceptado',    color: '#10B981', icon: 'checkmark-circle-outline' },
    REJECTED:  { label: 'Rechazado',   color: '#EF4444', icon: 'close-circle-outline' },
    CANCELED:  { label: 'Cancelado',   color: '#94A3B8', icon: 'ban-outline' },
    COMPLETED: { label: 'Finalizado',  color: '#3B82F6', icon: 'flag-outline' },
};

const STATUS_ORDER: Record<BookingStatus, number> = {
    ACTIVE:    0,
    PENDING:   1,
    ACCEPTED:  1,
    REJECTED:  2,
    CANCELED:  2,
    COMPLETED: 2,
};

const formatDateTime = (iso: string) => {
    const d = new Date(iso);
    return (
        d.toLocaleDateString('es-PE', { weekday: 'short', day: 'numeric', month: 'short' }) +
        ' · ' +
        d.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })
    );
};

// ─── Booking Card ─────────────────────────────────────────────────────────────

interface BookingCardProps {
    booking: MyBooking;
    canceling: boolean;
    boarding: boolean;
    onCancel: (id: string) => void;
    onBoard: (id: string) => void;
}

const BookingCard: React.FC<BookingCardProps> = ({ booking, canceling, boarding, onCancel, onBoard }) => {
    const cfg = STATUS_CONFIG[booking.status];
    const isAccepted = booking.status === 'ACCEPTED';
    const isCanceledByDriver = booking.status === 'CANCELED' && booking.canceledByDriver;
    const canCancel = booking.status === 'PENDING' || (isAccepted && !booking.isBoarded);
    const { vehicle } = booking.trip.driver;

    return (
        <View style={styles.card}>
            {/* Driver row */}
            <View style={styles.cardHeader}>
                <View style={styles.driverAvatar}>
                    <Text style={styles.driverAvatarText}>
                        {booking.trip.driver.name?.[0]?.toUpperCase() ?? '?'}
                    </Text>
                </View>
                <View style={{ flex: 1 }}>
                    <Text style={styles.driverName}>{booking.trip.driver.name}</Text>
                    {vehicle && (
                        <Text style={styles.vehicleText}>
                            {vehicle.brand} · {vehicle.model} · {vehicle.color} · {vehicle.plate}
                        </Text>
                    )}
                    <Text style={styles.cardTime}>{formatDateTime(booking.trip.departureTime)}</Text>
                </View>
                {/* Status badge */}
                <View style={[styles.statusBadge, { backgroundColor: cfg.color + '20' }]}>
                    <Ionicons name={cfg.icon} size={13} color={cfg.color} />
                    <Text style={[styles.statusText, { color: cfg.color }]}>{cfg.label}</Text>
                </View>
            </View>

            {/* Canceled by driver banner */}
            {isCanceledByDriver && (
                <View style={styles.canceledByDriverRow}>
                    <Ionicons name="warning-outline" size={15} color="#EF4444" />
                    <Text style={styles.canceledByDriverText}>Viaje Cancelado por Conductor</Text>
                </View>
            )}

            {/* Boarding confirmation */}
            {isAccepted && (
                booking.isBoarded ? (
                    <View style={styles.boardedRow}>
                        <Ionicons name="checkmark-circle" size={16} color="#10B981" />
                        <Text style={styles.boardedText}>Ya estás a bordo</Text>
                    </View>
                ) : (
                    <TouchableOpacity
                        style={styles.boardBtn}
                        onPress={() => onBoard(booking.id)}
                        disabled={boarding}
                        activeOpacity={0.75}
                    >
                        {boarding ? (
                            <ActivityIndicator size="small" color="#FFF" />
                        ) : (
                            <>
                                <Ionicons name="car-outline" size={16} color="#FFF" />
                                <Text style={styles.boardBtnText}>Confirmar subida al auto</Text>
                            </>
                        )}
                    </TouchableOpacity>
                )
            )}

            {/* Cancel button */}
            {canCancel && (
                <TouchableOpacity
                    style={styles.cancelBtn}
                    onPress={() => onCancel(booking.id)}
                    disabled={canceling}
                    activeOpacity={0.75}
                >
                    {canceling ? (
                        <ActivityIndicator size="small" color="#EF4444" />
                    ) : (
                        <>
                            <Ionicons name="close-circle-outline" size={16} color="#EF4444" />
                            <Text style={styles.cancelBtnText}>Cancelar reserva</Text>
                        </>
                    )}
                </TouchableOpacity>
            )}
        </View>
    );
};

// ─── Screen ───────────────────────────────────────────────────────────────────

export const MyTripsScreen = () => {
    const insets = useSafeAreaInsets();
    const { token } = useAuthStore();
    const socketRef = useRef<Socket | null>(null);
    const [bookings, setBookings] = useState<MyBooking[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [cancelingId, setCancelingId] = useState<string | null>(null);
    const [boardingId, setBoardingId] = useState<string | null>(null);

    const fetchBookings = useCallback(async (silent = false) => {
        if (!silent) setLoading(true);
        try {
            const { data } = await axiosClient.get('/bookings/me');
            const sorted = (data ?? []).slice().sort(
                (a: MyBooking, b: MyBooking) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status],
            );
            setBookings(sorted);
        } catch {
            Alert.alert('Error', 'No se pudieron cargar tus reservas.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => { fetchBookings(); }, [fetchBookings]);

    // Real-time: trip canceled by driver or no-show by driver
    useEffect(() => {
        if (!token) return;
        const socket = createSocket(token);
        socketRef.current = socket;
        socket.connect();

        socket.on('trip_canceled', (data: { tripId: string }) => {
            setBookings(prev => prev.map(b =>
                b.trip.id === data.tripId && (b.status === 'PENDING' || b.status === 'ACCEPTED')
                    ? { ...b, status: 'CANCELED' as const, canceledByDriver: true }
                    : b
            ));
        });

        socket.on('noShowUpdated', (data: { bookingId: string }) => {
            setBookings(prev => prev.map(b =>
                b.id === data.bookingId ? { ...b, status: 'CANCELED' as const } : b
            ));
        });

        return () => { socket.disconnect(); socketRef.current = null; };
    }, [token]);

    const handleBoard = async (bookingId: string) => {
        setBoardingId(bookingId);
        try {
            await axiosClient.patch(`/bookings/${bookingId}/board`);
            setBookings(prev =>
                prev.map(b => b.id === bookingId ? { ...b, isBoarded: true } : b)
            );
        } catch (error: any) {
            const msg = error.response?.data?.message || 'No se pudo confirmar la subida.';
            Alert.alert('Error', Array.isArray(msg) ? msg.join('\n') : msg);
        } finally {
            setBoardingId(null);
        }
    };

    const handleCancel = (bookingId: string) => {
        Alert.alert(
            'Cancelar reserva',
            '¿Seguro que quieres cancelar esta reserva?',
            [
                { text: 'No', style: 'cancel' },
                {
                    text: 'Sí, cancelar',
                    style: 'destructive',
                    onPress: async () => {
                        setCancelingId(bookingId);
                        try {
                            await axiosClient.patch(`/bookings/${bookingId}/cancel`);
                            setBookings(prev =>
                                prev.map(b =>
                                    b.id === bookingId ? { ...b, status: 'CANCELED' as const } : b
                                )
                            );
                        } catch (error: any) {
                            const msg = error.response?.data?.message || 'No se pudo cancelar la reserva.';
                            Alert.alert('Error', Array.isArray(msg) ? msg.join('\n') : msg);
                        } finally {
                            setCancelingId(null);
                        }
                    },
                },
            ]
        );
    };

    if (loading) {
        return (
            <View style={styles.centered}>
                <ActivityIndicator size="large" color="#0EA5E9" />
            </View>
        );
    }

    return (
        <FlatList
            data={bookings}
            keyExtractor={b => b.id}
            contentContainerStyle={[
                styles.list,
                { paddingBottom: insets.bottom + 24 },
                bookings.length === 0 && styles.listEmpty,
            ]}
            refreshControl={
                <RefreshControl
                    refreshing={refreshing}
                    onRefresh={() => { setRefreshing(true); fetchBookings(true); }}
                    tintColor="#0EA5E9"
                />
            }
            renderItem={({ item }) => (
                <BookingCard
                    booking={item}
                    canceling={cancelingId === item.id}
                    boarding={boardingId === item.id}
                    onCancel={handleCancel}
                    onBoard={handleBoard}
                />
            )}
            ListEmptyComponent={
                <View style={styles.emptyState}>
                    <Ionicons name="bookmark-outline" size={52} color="#CBD5E1" />
                    <Text style={styles.emptyTitle}>Sin reservas</Text>
                    <Text style={styles.emptySubtitle}>
                        Cuando solicites un viaje, aparecerá aquí.
                    </Text>
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
        backgroundColor: '#FFF', borderRadius: 20, padding: 16, gap: 12,
        shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.07, shadowRadius: 8, elevation: 3,
    },
    cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    driverAvatar: {
        width: 42, height: 42, borderRadius: 21,
        backgroundColor: '#0F172A', justifyContent: 'center', alignItems: 'center',
    },
    driverAvatarText: { color: '#38BDF8', fontSize: 16, fontWeight: '800' },
    driverName: { fontSize: 15, fontWeight: '700', color: '#0F172A' },
    vehicleText: { fontSize: 11, color: '#64748B', marginTop: 1 },
    cardTime: { fontSize: 12, color: '#64748B', marginTop: 2 },

    statusBadge: {
        flexDirection: 'row', alignItems: 'center', gap: 4,
        paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20,
    },
    statusText: { fontSize: 11, fontWeight: '700' },

    canceledByDriverRow: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        backgroundColor: '#FFF5F5', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10,
    },
    canceledByDriverText: { fontSize: 13, fontWeight: '700', color: '#EF4444' },

    boardBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
        borderRadius: 12, paddingVertical: 10, backgroundColor: '#10B981',
    },
    boardBtnText: { fontSize: 14, fontWeight: '700', color: '#FFF' },
    boardedRow: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        paddingVertical: 8, justifyContent: 'center',
    },
    boardedText: { fontSize: 14, fontWeight: '700', color: '#10B981' },

    cancelBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
        borderWidth: 1, borderColor: '#FECACA', borderRadius: 12,
        paddingVertical: 10, backgroundColor: '#FFF5F5',
    },
    cancelBtnText: { fontSize: 14, fontWeight: '700', color: '#EF4444' },

    emptyState: { alignItems: 'center', gap: 10, paddingHorizontal: 40 },
    emptyTitle: { fontSize: 18, fontWeight: '800', color: '#334155' },
    emptySubtitle: { fontSize: 14, color: '#94A3B8', textAlign: 'center', lineHeight: 20 },
});

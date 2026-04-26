import React, { useCallback, useEffect, useState } from 'react';
import {
    View, Text, StyleSheet, FlatList,
    ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { axiosClient } from '../api/axiosClient';

// ─── Types ───────────────────────────────────────────────────────────────────

type BookingStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELED';

interface MyBooking {
    id: string;
    status: BookingStatus;
    trip: {
        id: string;
        departureTime: string;
        driver: { id: string; name: string };
    };
    createdAt: string;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<BookingStatus, { label: string; color: string; icon: keyof typeof Ionicons.glyphMap }> = {
    PENDING:  { label: 'Pendiente',  color: '#F59E0B', icon: 'time-outline' },
    ACCEPTED: { label: 'Aceptado',   color: '#10B981', icon: 'checkmark-circle-outline' },
    REJECTED: { label: 'Rechazado',  color: '#EF4444', icon: 'close-circle-outline' },
    CANCELED: { label: 'Cancelado',  color: '#94A3B8', icon: 'ban-outline' },
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
}

const BookingCard: React.FC<BookingCardProps> = ({ booking }) => {
    const cfg = STATUS_CONFIG[booking.status];

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
                    <Text style={styles.cardTime}>{formatDateTime(booking.trip.departureTime)}</Text>
                </View>
                {/* Status badge */}
                <View style={[styles.statusBadge, { backgroundColor: cfg.color + '20' }]}>
                    <Ionicons name={cfg.icon} size={13} color={cfg.color} />
                    <Text style={[styles.statusText, { color: cfg.color }]}>{cfg.label}</Text>
                </View>
            </View>
        </View>
    );
};

// ─── Screen ───────────────────────────────────────────────────────────────────

export const MyBookingsScreen = () => {
    const insets = useSafeAreaInsets();
    const [bookings, setBookings] = useState<MyBooking[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const fetchBookings = useCallback(async (silent = false) => {
        if (!silent) setLoading(true);
        try {
            const { data } = await axiosClient.get('/bookings/me');
            setBookings(data ?? []);
        } catch {
            Alert.alert('Error', 'No se pudieron cargar tus reservas.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => { fetchBookings(); }, [fetchBookings]);

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
                <BookingCard booking={item} />
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
        backgroundColor: '#FFF', borderRadius: 20, padding: 16,
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
    cardTime: { fontSize: 12, color: '#64748B', marginTop: 2 },

    statusBadge: {
        flexDirection: 'row', alignItems: 'center', gap: 4,
        paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20,
    },
    statusText: { fontSize: 11, fontWeight: '700' },

    emptyState: { alignItems: 'center', gap: 10, paddingHorizontal: 40 },
    emptyTitle: { fontSize: 18, fontWeight: '800', color: '#334155' },
    emptySubtitle: { fontSize: 14, color: '#94A3B8', textAlign: 'center', lineHeight: 20 },
});

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, RefreshControl, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { axiosClient } from '../api/axiosClient';

// ─── Types ───────────────────────────────────────────────────────────────────

interface BookingItem {
    id: string;
    status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELED' | 'COMPLETED';
    passenger: { id: string; name: string };
}

interface DriverTrip {
    id: string;
    departureTime: string;
    status: 'SCHEDULED' | 'ACTIVE' | 'COMPLETED' | 'CANCELED';
    availableSeats: number;
    bookings: BookingItem[];
    routePolyline?: { coordinates: number[][] };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const formatDateTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('es-PE', { weekday: 'short', day: 'numeric', month: 'short' })
        + ' · '
        + d.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
};

const STATUS_LABEL: Record<'COMPLETED' | 'CANCELED', string> = {
    COMPLETED: 'Completado',
    CANCELED: 'Cancelado',
};

const STATUS_COLOR: Record<'COMPLETED' | 'CANCELED', string> = {
    COMPLETED: '#64748B',
    CANCELED: '#EF4444',
};

// ─── Trip Card ────────────────────────────────────────────────────────────────

const TripCard: React.FC<{ trip: DriverTrip }> = ({ trip }) => {
    const accepted = trip.bookings.filter(b => b.status === 'ACCEPTED' || b.status === 'COMPLETED');
    const coords = trip.routePolyline?.coordinates;
    const destCoords = coords ? coords[coords.length - 1] : null;
    const statusKey = trip.status as 'COMPLETED' | 'CANCELED';

    return (
        <View style={styles.card}>
            <View style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                    <Text style={styles.cardTime}>{formatDateTime(trip.departureTime)}</Text>
                    {destCoords && (
                        <View style={styles.cardMeta}>
                            <Ionicons name="location-outline" size={13} color="#64748B" />
                            <Text style={styles.cardMetaText} numberOfLines={1}>
                                {destCoords[1].toFixed(4)}, {destCoords[0].toFixed(4)}
                            </Text>
                        </View>
                    )}
                </View>
                <View style={[styles.statusBadge, { backgroundColor: STATUS_COLOR[statusKey] + '20' }]}>
                    <Text style={[styles.statusText, { color: STATUS_COLOR[statusKey] }]}>
                        {STATUS_LABEL[statusKey]}
                    </Text>
                </View>
            </View>
            <View style={styles.cardMeta}>
                <Ionicons name="people-outline" size={13} color="#64748B" />
                <Text style={styles.cardMetaText}>
                    {accepted.length} pasajero{accepted.length !== 1 ? 's' : ''} confirmado{accepted.length !== 1 ? 's' : ''}
                </Text>
            </View>
        </View>
    );
};

// ─── Main Screen ──────────────────────────────────────────────────────────────

export const DriverTripsScreen = () => {
    const insets = useSafeAreaInsets();

    const [trips, setTrips] = useState<DriverTrip[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const fetchTrips = useCallback(async (silent = false) => {
        if (!silent) setLoading(true);
        try {
            const { data } = await axiosClient.get('/trips/my-trips');
            const history = (data as DriverTrip[]).filter(
                t => t.status === 'COMPLETED' || t.status === 'CANCELED'
            );
            setTrips(history);
        } catch {
            // M-2: surface errors instead of showing a silent empty list
            Alert.alert('Error', 'No se pudo cargar el historial de viajes.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => { fetchTrips(); }, [fetchTrips]);

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
            renderItem={({ item }) => <TripCard trip={item} />}
            ListEmptyComponent={
                <View style={styles.emptyState}>
                    <Ionicons name="time-outline" size={52} color="#CBD5E1" />
                    <Text style={styles.emptyTitle}>Sin historial</Text>
                    <Text style={styles.emptySubtitle}>
                        Aquí aparecerán tus viajes completados y cancelados.
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
        backgroundColor: '#FFF',
        borderRadius: 16,
        padding: 16,
        gap: 10,
        borderWidth: 1,
        borderColor: '#F1F5F9',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 4,
        elevation: 2,
    },
    cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    cardTime: { fontSize: 14, fontWeight: '700', color: '#0F172A', marginBottom: 4 },
    cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    cardMetaText: { fontSize: 12, color: '#64748B' },

    statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
    statusText: { fontSize: 11, fontWeight: '700' },

    emptyState: { alignItems: 'center', gap: 10, paddingHorizontal: 40 },
    emptyTitle: { fontSize: 18, fontWeight: '800', color: '#334155' },
    emptySubtitle: { fontSize: 14, color: '#94A3B8', textAlign: 'center', lineHeight: 20 },
});

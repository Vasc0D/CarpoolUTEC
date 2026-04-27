import React, { useEffect, useRef, useState } from 'react';
import {
    View, Text, StyleSheet, Modal, TouchableOpacity, ActivityIndicator, Alert, Linking,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { Socket } from 'socket.io-client';
import { axiosClient } from '../api/axiosClient';
import { createSocket } from '../api/socketClient';
import { useAuthStore } from '../store/authStore';
import type { RootStackParamList } from '../navigation/AppNavigator';

type ActiveTripRouteProp = RouteProp<RootStackParamList, 'ActiveTrip'>;

// ─── Types ───────────────────────────────────────────────────────────────────

interface TripDetail {
    id: string;
    departureTime: string;
    originalDurationSeconds?: number;
    meetingPoint: string | null;
    driver: { id: string; name: string };
    routePolyline: { coordinates: number[][] } | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });

const formatETA = (departureTime: string, durationSeconds?: number): string => {
    if (!durationSeconds) return '';
    const eta = new Date(new Date(departureTime).getTime() + durationSeconds * 1000);
    return eta.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
};

const UTEC_COORDS = { latitude: -12.135, longitude: -77.023 };

// ─── Screen ───────────────────────────────────────────────────────────────────

export const ActiveTripScreen = () => {
    const navigation = useNavigation<any>();
    const route = useRoute<ActiveTripRouteProp>();
    const { tripId } = route.params;
    const { token } = useAuthStore();
    const insets = useSafeAreaInsets();
    const mapRef = useRef<MapView>(null);
    const socketRef = useRef<Socket | null>(null);

    const [trip, setTrip] = useState<TripDetail | null>(null);
    const [driverCoords, setDriverCoords] = useState<{ latitude: number; longitude: number } | null>(null);
    const [showFinishedModal, setShowFinishedModal] = useState(false);

    // Fetch trip details on mount
    useEffect(() => {
        // P-7: keep the timer ID so we can cancel it if the component unmounts before it fires
        let fitTimer: ReturnType<typeof setTimeout>;
        axiosClient.get(`/trips/${tripId}`)
            .then(res => {
                setTrip(res.data);
                const coords = res.data.routePolyline?.coordinates;
                if (coords?.length) {
                    const mapped = coords.map((c: number[]) => ({ latitude: c[1], longitude: c[0] }));
                    fitTimer = setTimeout(() => {
                        mapRef.current?.fitToCoordinates(mapped, {
                            edgePadding: { top: 60, right: 40, bottom: 220, left: 40 },
                            animated: true,
                        });
                    }, 500);
                }
            })
            .catch(() => Alert.alert('Error', 'No se pudo cargar la información del viaje.'));
        return () => clearTimeout(fitTimer);
    }, [tripId]);

    // Socket: driver location updates + trip finished
    useEffect(() => {
        if (!token) return;
        const socket = createSocket(token);
        socketRef.current = socket;
        socket.connect();

        socket.on('driver_location_update', (data: { tripId: string; lat: number; lng: number }) => {
            if (data.tripId !== tripId) return;
            const coords = { latitude: data.lat, longitude: data.lng };
            setDriverCoords(coords);
            mapRef.current?.animateCamera({ center: coords }, { duration: 800 });
        });

        socket.on('trip_finished', (data: { tripId: string }) => {
            if (data.tripId !== tripId) return;
            setShowFinishedModal(true);
        });

        return () => { socket.disconnect(); socketRef.current = null; };
    }, [token, tripId]);

    const routeCoords = trip?.routePolyline?.coordinates.map((c: number[]) => ({
        latitude: c[1], longitude: c[0],
    })) ?? [];

    const handleOpenNavigation = async () => {
        const coords = trip?.routePolyline?.coordinates;
        if (!coords?.length) return;
        const last = coords[coords.length - 1];
        const lat = last[1];
        const lng = last[0];

        const wazeUrl = `waze://?ll=${lat},${lng}&navigate=yes`;
        const googleUrl = `comgooglemaps://?daddr=${lat},${lng}&directionsmode=driving`;
        const googleFallback = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;

        const [wazeOk, googleOk] = await Promise.all([
            Linking.canOpenURL(wazeUrl),
            Linking.canOpenURL(googleUrl),
        ]);

        const options: { text: string; onPress: () => void }[] = [];
        if (googleOk) options.push({ text: 'Google Maps', onPress: () => Linking.openURL(googleUrl) });
        else options.push({ text: 'Google Maps (web)', onPress: () => Linking.openURL(googleFallback) });
        if (wazeOk) options.push({ text: 'Waze', onPress: () => Linking.openURL(wazeUrl) });
        options.push({ text: 'Cancelar', onPress: () => {} });

        Alert.alert('¿Qué mapa deseas usar?', undefined, options.map(o => ({ text: o.text, onPress: o.onPress })));
    };

    return (
        <View style={styles.container}>
            {/* Full-screen map */}
            <MapView
                ref={mapRef}
                provider={PROVIDER_DEFAULT}
                style={StyleSheet.absoluteFillObject}
                initialRegion={{ ...UTEC_COORDS, latitudeDelta: 0.05, longitudeDelta: 0.05 }}
                showsUserLocation
            >
                {routeCoords.length > 0 && (
                    <Polyline
                        coordinates={routeCoords}
                        strokeColor="#0EA5E9"
                        strokeWidth={4}
                    />
                )}
                {driverCoords && (
                    <Marker coordinate={driverCoords} title="Conductor" anchor={{ x: 0.5, y: 0.5 }}>
                        <View style={styles.carMarker}>
                            <Ionicons name="car-sport" size={20} color="#FFF" />
                        </View>
                    </Marker>
                )}
            </MapView>

            {/* Loading overlay while trip details load */}
            {!trip && (
                <View style={styles.loadingOverlay}>
                    <ActivityIndicator size="large" color="#0EA5E9" />
                </View>
            )}

            {/* Bottom info card */}
            {trip && (
                <View style={[styles.infoCard, { paddingBottom: insets.bottom + 16 }]}>
                    <View style={styles.activeRow}>
                        <View style={styles.activeDot} />
                        <Text style={styles.activeLabel}>Viaje en curso</Text>
                    </View>

                    <View style={styles.driverRow}>
                        <View style={styles.driverAvatar}>
                            <Text style={styles.driverAvatarText}>
                                {trip.driver.name?.[0]?.toUpperCase() ?? '?'}
                            </Text>
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.driverName}>{trip.driver.name}</Text>
                            <Text style={styles.driverSubLabel}>Conductor</Text>
                        </View>
                        <View style={{ gap: 4 }}>
                            <View style={styles.timeBadge}>
                                <Ionicons name="time-outline" size={13} color="#0EA5E9" />
                                <Text style={styles.timeText}>{formatTime(trip.departureTime)}</Text>
                            </View>
                            {!!formatETA(trip.departureTime, trip.originalDurationSeconds) && (
                                <View style={[styles.timeBadge, { backgroundColor: '#ECFDF5' }]}>
                                    <Ionicons name="flag-outline" size={13} color="#10B981" />
                                    <Text style={[styles.timeText, { color: '#10B981' }]}>
                                        ~{formatETA(trip.departureTime, trip.originalDurationSeconds)}
                                    </Text>
                                </View>
                            )}
                        </View>
                    </View>

                    {trip.meetingPoint && (
                        <View style={styles.meetingRow}>
                            <Ionicons name="location-outline" size={14} color="#10B981" />
                            <Text style={styles.meetingText} numberOfLines={2}>
                                Frente a la salida de carros UTEC
                            </Text>
                        </View>
                    )}

                    {!driverCoords && (
                        <View style={styles.waitingRow}>
                            <ActivityIndicator size="small" color="#94A3B8" />
                            <Text style={styles.waitingText}>Esperando ubicación del conductor...</Text>
                        </View>
                    )}

                    <TouchableOpacity style={styles.navBtn} onPress={handleOpenNavigation} activeOpacity={0.8}>
                        <Ionicons name="navigate-outline" size={16} color="#FFF" />
                        <Text style={styles.navBtnText}>Navegar al destino</Text>
                    </TouchableOpacity>
                </View>
            )}

            {/* Finished modal */}
            <Modal visible={showFinishedModal} transparent animationType="fade">
                <View style={styles.modalBackdrop}>
                    <View style={styles.modalCard}>
                        <Ionicons name="checkmark-circle" size={64} color="#10B981" />
                        <Text style={styles.modalTitle}>¡Llegaste!</Text>
                        <Text style={styles.modalSubtitle}>
                            El conductor ha finalizado el viaje. Que tengas un buen día.
                        </Text>
                        <TouchableOpacity
                            style={styles.modalBtn}
                            onPress={() => {
                                setShowFinishedModal(false);
                                navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
                            }}
                        >
                            <Text style={styles.modalBtnText}>Volver al inicio</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>
        </View>
    );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    container: { flex: 1 },

    loadingOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(255,255,255,0.7)',
        justifyContent: 'center',
        alignItems: 'center',
    },

    // Driver car marker
    carMarker: {
        width: 40, height: 40, borderRadius: 20,
        backgroundColor: '#0EA5E9',
        justifyContent: 'center', alignItems: 'center',
        shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3, shadowRadius: 4, elevation: 5,
    },

    // Bottom info card
    infoCard: {
        position: 'absolute', bottom: 0, left: 0, right: 0,
        backgroundColor: '#FFF',
        borderTopLeftRadius: 24, borderTopRightRadius: 24,
        padding: 20,
        gap: 14,
        shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.1, shadowRadius: 12, elevation: 12,
    },
    activeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    activeDot: {
        width: 8, height: 8, borderRadius: 4, backgroundColor: '#0EA5E9',
    },
    activeLabel: { fontSize: 12, fontWeight: '700', color: '#0EA5E9', textTransform: 'uppercase', letterSpacing: 0.8 },

    driverRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    driverAvatar: {
        width: 44, height: 44, borderRadius: 22,
        backgroundColor: '#0F172A', justifyContent: 'center', alignItems: 'center',
    },
    driverAvatarText: { color: '#38BDF8', fontSize: 18, fontWeight: '800' },
    driverName: { fontSize: 16, fontWeight: '700', color: '#0F172A' },
    driverSubLabel: { fontSize: 12, color: '#94A3B8', marginTop: 2 },

    timeBadge: {
        flexDirection: 'row', alignItems: 'center', gap: 4,
        backgroundColor: '#EFF6FF', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20,
    },
    timeText: { fontSize: 13, fontWeight: '700', color: '#0EA5E9' },

    meetingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    meetingText: { flex: 1, fontSize: 13, color: '#475569', fontWeight: '600' },

    waitingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    waitingText: { fontSize: 12, color: '#94A3B8' },

    navBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
        backgroundColor: '#0EA5E9', borderRadius: 14, paddingVertical: 12,
    },
    navBtnText: { fontSize: 14, fontWeight: '700', color: '#FFF' },

    // Finished modal
    modalBackdrop: {
        flex: 1, backgroundColor: 'rgba(0,0,0,0.55)',
        justifyContent: 'center', alignItems: 'center', padding: 32,
    },
    modalCard: {
        backgroundColor: '#FFF', borderRadius: 28, padding: 32,
        alignItems: 'center', gap: 12, width: '100%',
    },
    modalTitle: { fontSize: 26, fontWeight: '900', color: '#0F172A' },
    modalSubtitle: { fontSize: 14, color: '#64748B', textAlign: 'center', lineHeight: 20 },
    modalBtn: {
        backgroundColor: '#10B981', borderRadius: 16,
        paddingVertical: 14, paddingHorizontal: 32, marginTop: 8,
    },
    modalBtnText: { color: '#FFF', fontSize: 16, fontWeight: '800' },
});

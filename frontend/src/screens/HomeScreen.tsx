import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, Modal,
    ActivityIndicator, Animated, Dimensions, ScrollView, Alert
} from 'react-native';
import * as Location from 'expo-location';
import MapView, { Marker, PROVIDER_DEFAULT, Polyline } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../store/authStore';
import { axiosClient } from '../api/axiosClient';
import { createSocket } from '../api/socketClient';
import type { Socket } from 'socket.io-client';

const { height } = Dimensions.get('window');

// ─── Types ───────────────────────────────────────────────────────────────────

interface TripMarker {
    id: string;
    driver: { id: string; name: string };
    vehicle?: { model: string; color: string };
    availableSeats: number;
    departureTime: string;
    meetingPoint: string | null; // GeoJSON string from backend
    routePolyline: { coordinates: number[][] };
}

interface MeetingPointCoords {
    latitude: number;
    longitude: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const parseMeetingPoint = (meetingPoint: string | null): MeetingPointCoords | null => {
    if (!meetingPoint) return null;
    try {
        const geoJson = typeof meetingPoint === 'string' ? JSON.parse(meetingPoint) : meetingPoint;
        // GeoJSON coordinates are [lng, lat]
        return {
            latitude: geoJson.coordinates[1],
            longitude: geoJson.coordinates[0],
        };
    } catch {
        return null;
    }
};

const formatTime = (iso: string): string => {
    try {
        return new Date(iso).toLocaleTimeString('es-PE', {
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return iso;
    }
};

// ─── Bottom Sheet Modal ───────────────────────────────────────────────────────

interface TripSheetProps {
    trip: TripMarker | null;
    onClose: () => void;
    onBook: (tripId: string) => void;
    booking: boolean;
    booked: boolean;
}

const TripSheet: React.FC<TripSheetProps> = ({ trip, onClose, onBook, booking, booked }) => {
    const slideAnim = useRef(new Animated.Value(height)).current;
    const successScale = useRef(new Animated.Value(0)).current;
    const insets = useSafeAreaInsets();

    useEffect(() => {
        if (trip) {
            Animated.spring(slideAnim, {
                toValue: 0,
                tension: 65,
                friction: 11,
                useNativeDriver: true,
            }).start();
        } else {
            Animated.timing(slideAnim, {
                toValue: height,
                duration: 250,
                useNativeDriver: true,
            }).start();
        }
    }, [trip]);

    useEffect(() => {
        if (booked) {
            Animated.spring(successScale, {
                toValue: 1,
                tension: 80,
                friction: 8,
                useNativeDriver: true,
            }).start();
        } else {
            successScale.setValue(0);
        }
    }, [booked]);

    if (!trip) return null;

    const meetingCoords = parseMeetingPoint(trip.meetingPoint);

    return (
        <Modal transparent visible={!!trip} onRequestClose={onClose} animationType="none">
            {/* Backdrop */}
            <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />

            <Animated.View
                style={[
                    styles.sheet,
                    { paddingBottom: insets.bottom + 16, transform: [{ translateY: slideAnim }] }
                ]}
            >
                {/* Handle */}
                <View style={styles.sheetHandle} />

                {booked ? (
                    // ── Éxito ──────────────────────────────────────────────
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
                    // ── Detalle del viaje ──────────────────────────────────
                    <ScrollView showsVerticalScrollIndicator={false}>
                        {/* Header */}
                        <View style={styles.sheetHeader}>
                            <View style={styles.driverAvatar}>
                                <Text style={styles.driverAvatarText}>
                                    {trip.driver.name?.[0]?.toUpperCase() ?? '?'}
                                </Text>
                            </View>
                            <View style={styles.driverInfo}>
                                <Text style={styles.driverName}>{trip.driver.name}</Text>
                                {trip.vehicle && (
                                    <Text style={styles.vehicleText}>
                                        {trip.vehicle.color} · {trip.vehicle.model}
                                    </Text>
                                )}
                            </View>
                        </View>

                        {/* Info Cards */}
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
                                <Ionicons name="location-outline" size={22} color="#10B981" />
                                <Text style={styles.infoValue} numberOfLines={1}>
                                    {meetingCoords
                                        ? `${meetingCoords.latitude.toFixed(4)},\n${meetingCoords.longitude.toFixed(4)}`
                                        : 'En ruta'}
                                </Text>
                                <Text style={styles.infoLabel}>Punto de encuentro</Text>
                            </View>
                        </View>

                        {/* CTA */}
                        <TouchableOpacity
                            style={[styles.bookButton, (booking || trip.availableSeats === 0) && styles.bookButtonDisabled]}
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
                    </ScrollView>
                )}
            </Animated.View>
        </Modal>
    );
};

// ─── Main Screen ──────────────────────────────────────────────────────────────

export const HomeScreen = () => {
    const insets = useSafeAreaInsets();
    const navigation = useNavigation<any>();
    const { appMode, setAppMode, isDriver, token } = useAuthStore();
    const socketRef = useRef<Socket | null>(null);

    const [location, setLocation] = useState<Location.LocationObject | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    // Passenger state
    const [trips, setTrips] = useState<TripMarker[]>([]);
    const [loadingTrips, setLoadingTrips] = useState(false);
    const [selectedTrip, setSelectedTrip] = useState<TripMarker | null>(null);
    const [bookingTripId, setBookingTripId] = useState<string | null>(null);
    const [bookedTripId, setBookedTripId] = useState<string | null>(null);

    // ── Location ────────────────────────────────────────────────────────────
    useEffect(() => {
        (async () => {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                setErrorMsg('El permiso de ubicación fue denegado');
                return;
            }
            const currentLocation = await Location.getCurrentPositionAsync({});
            setLocation(currentLocation);
        })();
    }, []);

    // ── Fetch trips when in passenger mode and location is ready ────────────
    const fetchTrips = useCallback(async () => {
        if (!location || appMode !== 'passenger') return;

        setLoadingTrips(true);
        try {
            const { latitude, longitude } = location.coords;
            const response = await axiosClient.get('/trips', {
                params: { lat: latitude, lng: longitude },
            });
            setTrips(response.data ?? []);
        } catch (error: any) {
            console.error('Error fetching trips:', error.response?.data || error.message);
            // Don't alert on every refresh — just show empty state
        } finally {
            setLoadingTrips(false);
        }
    }, [location, appMode]);

    useEffect(() => {
        fetchTrips();
    }, [fetchTrips]);

    // ── Driver: real-time booking notifications ──────────────────────────────
    useEffect(() => {
        if (appMode !== 'driver' || !token) return;

        const socket = createSocket(token);
        socketRef.current = socket;
        socket.connect();

        socket.on('new_booking_request', (data: { passengerName: string; tripId: string }) => {
            Alert.alert(
                'Nueva solicitud de asiento',
                `${data.passengerName} quiere unirse a tu viaje.`,
            );
        });

        return () => {
            socket.disconnect();
            socketRef.current = null;
        };
    }, [appMode, token]);

    // ── Book seat ────────────────────────────────────────────────────────────
    const handleBookSeat = async (tripId: string) => {
        setBookingTripId(tripId);
        try {
            // TODO: Emitir evento por Socket.io para que el conductor reciba
            // una notificación push en tiempo real cuando alguien reserve.
            await axiosClient.post(`/bookings/${tripId}`);

            // Optimistic update: decrement seat count in local state
            setTrips(prev =>
                prev.map(t =>
                    t.id === tripId
                        ? { ...t, availableSeats: Math.max(0, t.availableSeats - 1) }
                        : t
                )
            );
            // Update selected trip too so the sheet reflects the change
            setSelectedTrip(prev =>
                prev?.id === tripId
                    ? { ...prev, availableSeats: Math.max(0, prev.availableSeats - 1) }
                    : prev
            );

            setBookedTripId(tripId);
        } catch (error: any) {
            const msg = error.response?.data?.message || 'No se pudo solicitar el asiento. Intenta de nuevo.';
            Alert.alert('Error', Array.isArray(msg) ? msg.join('\n') : msg);
        } finally {
            setBookingTripId(null);
        }
    };

    const handleCloseSheet = () => {
        setSelectedTrip(null);
        setBookedTripId(null);
    };

    // ── Mode toggle ──────────────────────────────────────────────────────────
    const toggleAppMode = (mode: 'driver' | 'passenger') => {
        setAppMode(mode);
        if (mode === 'passenger' && location) {
            // Refresh trips when switching to passenger mode
            fetchTrips();
        }
    };

    // ── Map markers for available trips ──────────────────────────────────────
    const tripMarkers = trips.map(trip => {
        const coords = parseMeetingPoint(trip.meetingPoint);
        if (!coords) return null;
        return (
            <Marker
                key={trip.id}
                coordinate={coords}
                onPress={() => {
                    setBookedTripId(null);
                    setSelectedTrip(trip);
                }}
            >
                <View style={styles.tripMarker}>
                    <Ionicons name="car-sport" size={16} color="#FFF" />
                    <Text style={styles.tripMarkerText}>{trip.availableSeats}</Text>
                </View>
            </Marker>
        );
    }).filter(Boolean);

    // ─── Render ───────────────────────────────────────────────────────────────
    return (
        <View style={styles.container}>
            {/* Map */}
            {location ? (
<MapView
                    provider={PROVIDER_DEFAULT}
                    style={StyleSheet.absoluteFillObject}
                    initialRegion={{
                        latitude: location.coords.latitude,
                        longitude: location.coords.longitude,
                        latitudeDelta: 0.01,
                        longitudeDelta: 0.01,
                    }}
                    showsUserLocation
                >
                    {/* Rutas de los viajes (Líneas) */}
                    {appMode === 'passenger' && trips.map(trip => {
                        if (!trip.routePolyline?.coordinates) return null;
                        
                        // Convertir el formato GeoJSON [lng, lat] al formato del mapa {latitude, longitude}
                        const routeCoords = trip.routePolyline.coordinates.map((coord: any) => ({
                            latitude: coord[1],
                            longitude: coord[0]
                        }));

                        // Si el viaje está seleccionado, la línea será más gruesa y fuerte
                        const isSelected = selectedTrip?.id === trip.id;

                        return (
                            <Polyline
                                key={`route-${trip.id}`}
                                coordinates={routeCoords}
                                strokeColor={isSelected ? "#0EA5E9" : "rgba(14, 165, 233, 0.3)"}
                                strokeWidth={isSelected ? 5 : 3}
                            />
                        );
                    })}

                    {/* Pines de los viajes (Marcadores) */}
                    {appMode === 'passenger' && tripMarkers}
                </MapView>
            ) : (
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color="#0EA5E9" />
                    <Text style={styles.loadingText}>{errorMsg || 'Cargando mapa...'}</Text>
                </View>
            )}

            {/* Mode Toggle (top) */}
            <View style={[styles.overlay, { top: insets.top + 16 }]}>
                <View style={styles.card}>
                    <TouchableOpacity
                        style={[styles.toggleButton, appMode === 'passenger' && styles.activePassenger]}
                        onPress={() => toggleAppMode('passenger')}
                    >
                        <Text style={[styles.toggleText, appMode === 'passenger' && styles.activeText]}>
                            Soy Pasajero
                        </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.toggleButton, appMode === 'driver' && styles.activeDriver]}
                        onPress={() => toggleAppMode('driver')}
                    >
                        <Text style={[styles.toggleText, appMode === 'driver' && styles.activeText]}>
                            Soy Conductor
                        </Text>
                    </TouchableOpacity>
                </View>
            </View>

            {/* Passenger: loading indicator + refresh */}
            {appMode === 'passenger' && (
                <View style={[styles.passengerBar, { top: insets.top + 80 }]}>
                    {loadingTrips ? (
                        <View style={styles.pill}>
                            <ActivityIndicator size="small" color="#0EA5E9" />
                            <Text style={styles.pillText}>Buscando viajes...</Text>
                        </View>
                    ) : trips.length > 0 ? (
                        <View style={styles.pill}>
                            <Ionicons name="car-outline" size={14} color="#10B981" />
                            <Text style={[styles.pillText, { color: '#10B981' }]}>
                                {trips.length} viaje{trips.length !== 1 ? 's' : ''} disponible{trips.length !== 1 ? 's' : ''}
                            </Text>
                            <TouchableOpacity onPress={fetchTrips} style={styles.refreshButton}>
                                <Ionicons name="refresh-outline" size={14} color="#64748B" />
                            </TouchableOpacity>
                        </View>
                    ) : (
                        <View style={styles.pill}>
                            <Ionicons name="search-outline" size={14} color="#94A3B8" />
                            <Text style={[styles.pillText, { color: '#94A3B8' }]}>
                                No hay viajes cerca
                            </Text>
                            <TouchableOpacity onPress={fetchTrips} style={styles.refreshButton}>
                                <Ionicons name="refresh-outline" size={14} color="#64748B" />
                            </TouchableOpacity>
                        </View>
                    )}
                </View>
            )}

            {/* Driver: FAB bottom */}
            {appMode === 'driver' && (
                <View style={[styles.bottomOverlay, { bottom: insets.bottom + 20 }]}>
                    {isDriver ? (
                        <TouchableOpacity
                            style={styles.fab}
                            onPress={() => navigation.navigate('CreateTrip')}
                        >
                            <Text style={styles.fabText}>Publicar Viaje</Text>
                        </TouchableOpacity>
                    ) : (
                        <TouchableOpacity
                            style={[styles.fab, { backgroundColor: '#38BDF8' }]}
                            onPress={() => navigation.navigate('AddVehicle')}
                        >
                            <Text style={styles.fabText}>Registrar Vehículo</Text>
                        </TouchableOpacity>
                    )}
                </View>
            )}

            {/* Trip Detail Sheet */}
            <TripSheet
                trip={selectedTrip}
                onClose={handleCloseSheet}
                onBook={handleBookSeat}
                booking={bookingTripId === selectedTrip?.id}
                booked={bookedTripId === selectedTrip?.id}
            />
        </View>
    );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#fff' },
    loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
    loadingText: { fontSize: 14, color: '#64748B' },

    // Mode toggle
    overlay: { position: 'absolute', width: '100%', paddingHorizontal: 20, zIndex: 10 },
    card: {
        flexDirection: 'row', backgroundColor: '#fff', borderRadius: 30, padding: 4,
        shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15, shadowRadius: 12, elevation: 8,
    },
    toggleButton: { flex: 1, paddingVertical: 12, borderRadius: 26, alignItems: 'center' },
    toggleText: { fontSize: 16, fontWeight: '600', color: '#64748B' },
    activePassenger: { backgroundColor: '#0EA5E9' },
    activeDriver: { backgroundColor: '#10B981' },
    activeText: { color: '#FFF' },

    // Passenger status pill
    passengerBar: { position: 'absolute', width: '100%', paddingHorizontal: 20, zIndex: 10 },
    pill: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        alignSelf: 'center', backgroundColor: '#FFF',
        paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20,
        shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1, shadowRadius: 6, elevation: 4,
    },
    pillText: { fontSize: 13, fontWeight: '600', color: '#334155' },
    refreshButton: { marginLeft: 4, padding: 2 },

    // Driver FAB
    bottomOverlay: { position: 'absolute', width: '100%', paddingHorizontal: 20, alignItems: 'center' },
    fab: {
        backgroundColor: '#10B981', paddingVertical: 16, paddingHorizontal: 40, borderRadius: 30,
        shadowColor: '#10B981', shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.3, shadowRadius: 10, elevation: 10,
    },
    fabText: { color: '#FFF', fontSize: 18, fontWeight: '800' },

    // Trip marker on map
    tripMarker: {
        flexDirection: 'row', alignItems: 'center', gap: 4,
        backgroundColor: '#0EA5E9', borderRadius: 20,
        paddingVertical: 6, paddingHorizontal: 10,
        shadowColor: '#0EA5E9', shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.4, shadowRadius: 6, elevation: 6,
    },
    tripMarkerText: { color: '#FFF', fontSize: 12, fontWeight: '800' },

    // Bottom sheet
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
    sheet: {
        position: 'absolute', bottom: 0, left: 0, right: 0,
        backgroundColor: '#FFF', borderTopLeftRadius: 28, borderTopRightRadius: 28,
        paddingTop: 12, paddingHorizontal: 24,
        shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.12, shadowRadius: 16, elevation: 20,
        minHeight: height * 0.4,
    },
    sheetHandle: {
        width: 40, height: 4, backgroundColor: '#E2E8F0',
        borderRadius: 2, alignSelf: 'center', marginBottom: 20,
    },

    // Sheet: driver header
    sheetHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 20, gap: 14 },
    driverAvatar: {
        width: 52, height: 52, borderRadius: 26,
        backgroundColor: '#0F172A', justifyContent: 'center', alignItems: 'center',
    },
    driverAvatarText: { color: '#38BDF8', fontSize: 22, fontWeight: '900' },
    driverInfo: { flex: 1 },
    driverName: { fontSize: 20, fontWeight: '800', color: '#0F172A' },
    vehicleText: { fontSize: 14, color: '#64748B', marginTop: 2 },

    // Sheet: info cards
    infoRow: { flexDirection: 'row', gap: 10, marginBottom: 24 },
    infoCard: {
        flex: 1, backgroundColor: '#F8FAFC', borderRadius: 16,
        padding: 14, alignItems: 'center', gap: 4,
        borderWidth: 1, borderColor: '#E2E8F0',
    },
    infoValue: { fontSize: 13, fontWeight: '800', color: '#0F172A', textAlign: 'center' },
    infoLabel: { fontSize: 11, color: '#94A3B8', textAlign: 'center' },

    // Sheet: CTA
    bookButton: {
        backgroundColor: '#0EA5E9', paddingVertical: 18, borderRadius: 16,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        shadowColor: '#0EA5E9', shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
    },
    bookButtonDisabled: { backgroundColor: '#94A3B8', shadowOpacity: 0 },
    bookButtonText: { color: '#FFF', fontSize: 17, fontWeight: '800' },

    // Sheet: success state
    successContainer: { alignItems: 'center', paddingVertical: 32, gap: 12 },
    successIcon: { marginBottom: 8 },
    successTitle: { fontSize: 24, fontWeight: '900', color: '#0F172A' },
    successSubtitle: { fontSize: 15, color: '#64748B', textAlign: 'center', lineHeight: 22 },
    closeSuccessButton: {
        marginTop: 16, backgroundColor: '#10B981', paddingVertical: 14,
        paddingHorizontal: 40, borderRadius: 14,
    },
    closeSuccessText: { color: '#FFF', fontSize: 16, fontWeight: '800' },
});
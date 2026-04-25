import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, Modal,
    ActivityIndicator, Animated, Dimensions, ScrollView, FlatList, Alert
} from 'react-native';
import * as Location from 'expo-location';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { GooglePlacesAutocomplete } from 'react-native-google-places-autocomplete';
import { useAuthStore } from '../store/authStore';
import { axiosClient } from '../api/axiosClient';
import { createSocket } from '../api/socketClient';
import type { Socket } from 'socket.io-client';

const GOOGLE_MAPS_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY || 'DUMMY_KEY';

const { height } = Dimensions.get('window');

// ─── Types ───────────────────────────────────────────────────────────────────

interface TripMarker {
    id: string;
    driver: { id: string; name: string; vehicle?: { model: string; color: string; brand: string; plate: string } };
    availableSeats: number;
    departureTime: string;
    meetingPoint: string | null;
    routePolyline: { coordinates: number[][] };
    pricePerSeat: number;
    distanceToDestination?: number;
    matchType?: 'exact' | 'near' | 'detour';
    detourMinutes?: number;
}

interface MeetingPointCoords {
    latitude: number;
    longitude: number;
}

interface ActiveBooking {
    id: string;
    tripId: string;
    status: 'PENDING' | 'ACCEPTED';
}

interface DriverTripSummary {
    id: string;
    departureTime: string;
    status: 'SCHEDULED' | 'ACTIVE';
    availableSeats: number;
    pricePerSeat: number;
    routePolyline?: { coordinates: number[][] };
    bookings: Array<{
        id: string;
        status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELED' | 'COMPLETED';
        passenger: { id: string; name: string };
    }>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const parseMeetingPoint = (meetingPoint: string | null): MeetingPointCoords | null => {
    if (!meetingPoint) return null;
    try {
        const geoJson = typeof meetingPoint === 'string' ? JSON.parse(meetingPoint) : meetingPoint;
        return { latitude: geoJson.coordinates[1], longitude: geoJson.coordinates[0] };
    } catch {
        return null;
    }
};

const formatTime = (iso: string): string => {
    try {
        return new Date(iso).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
    } catch {
        return iso;
    }
};

const POPULAR_STOPS = [
    { id: 'jockey', name: 'Jockey Plaza', lat: -12.0869, lng: -76.9750 },
    { id: 'rambla', name: 'La Rambla San Borja', lat: -12.0956, lng: -76.9997 },
    { id: 'arequipa_jp', name: 'Arequipa con Javier Prado', lat: -12.0887, lng: -77.0283 },
    { id: 'san_luis', name: 'San Luis', lat: -12.0750, lng: -76.9820 },
];

// ─── Trip Sheet Modal ─────────────────────────────────────────────────────────

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

const TripSheet: React.FC<TripSheetProps> = ({
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

    const meetingCoords = parseMeetingPoint(trip.meetingPoint);
    const statusCfg = myBooking ? BOOKING_STATUS_CONFIG[myBooking.status] : null;

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

                        <View style={styles.priceMatchRow}>
                            <View style={styles.priceTag}>
                                <Ionicons name="cash-outline" size={14} color="#0EA5E9" />
                                <Text style={styles.priceAmount}>
                                    S/ {Number(trip.pricePerSeat ?? 0).toFixed(2)}
                                </Text>
                                {trip.matchType === 'near' && (
                                    <View style={styles.discountHint}>
                                        <Ionicons name="pricetag-outline" size={11} color="#16A34A" />
                                        <Text style={styles.discountHintText}>más barato</Text>
                                    </View>
                                )}
                            </View>
                            {trip.matchType && (
                                <View style={[
                                    styles.matchBadge,
                                    {
                                        backgroundColor:
                                            trip.matchType === 'exact' ? '#DCFCE7' :
                                            trip.matchType === 'detour' ? '#FFF7ED' :
                                            '#FEF9C3',
                                    },
                                ]}>
                                    <Ionicons
                                        name={
                                            trip.matchType === 'exact' ? 'location' :
                                            trip.matchType === 'detour' ? 'git-branch-outline' :
                                            'navigate-outline'
                                        }
                                        size={12}
                                        color={
                                            trip.matchType === 'exact' ? '#16A34A' :
                                            trip.matchType === 'detour' ? '#F97316' :
                                            '#CA8A04'
                                        }
                                    />
                                    <Text style={[
                                        styles.matchBadgeText,
                                        {
                                            color:
                                                trip.matchType === 'exact' ? '#16A34A' :
                                                trip.matchType === 'detour' ? '#F97316' :
                                                '#CA8A04',
                                        },
                                    ]}>
                                        {trip.matchType === 'exact' ? 'Te deja ahí' :
                                         trip.matchType === 'detour' ? `Se desvía ~${trip.detourMinutes}min` :
                                         'Pasa cerca'}
                                    </Text>
                                </View>
                            )}
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
                                <Ionicons name="location-outline" size={22} color="#10B981" />
                                <Text style={styles.infoValue} numberOfLines={2}>
                                    {meetingCoords
                                        ? `${meetingCoords.latitude.toFixed(4)},\n${meetingCoords.longitude.toFixed(4)}`
                                        : 'En ruta'}
                                </Text>
                                <Text style={styles.infoLabel}>Punto de encuentro</Text>
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

// ─── Main Screen ──────────────────────────────────────────────────────────────

export const HomeScreen = () => {
    const insets = useSafeAreaInsets();
    const navigation = useNavigation<any>();
    const { appMode, setAppMode, isDriver, token, user } = useAuthStore();
    const socketRef = useRef<Socket | null>(null);
    const mapRef = useRef<MapView>(null);

    const [location, setLocation] = useState<Location.LocationObject | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    const [destLat, setDestLat] = useState<number | null>(null);
    const [destLng, setDestLng] = useState<number | null>(null);
    const destInputRef = useRef<any>(null);

    const [coveredStops, setCoveredStops] = useState<string[]>([]);

    const [trips, setTrips] = useState<TripMarker[]>([]);
    const [loadingTrips, setLoadingTrips] = useState(false);
    const [selectedTrip, setSelectedTrip] = useState<TripMarker | null>(null);
    const [bookingTripId, setBookingTripId] = useState<string | null>(null);
    const [bookedTripId, setBookedTripId] = useState<string | null>(null);

    const [myActiveBooking, setMyActiveBooking] = useState<ActiveBooking | null>(null);
    const [cancelingBooking, setCancelingBooking] = useState(false);

    const [activeDriverTrip, setActiveDriverTrip] = useState<DriverTripSummary | null>(null);
    const [cancelingDriverTrip, setCancelingDriverTrip] = useState(false);

    const [previewTrip, setPreviewTrip] = useState<TripMarker | null>(null);
    const [dropoffPoint, setDropoffPoint] = useState<{ latitude: number; longitude: number } | null>(null);
    const [routeToDropoff, setRouteToDropoff] = useState<{ latitude: number; longitude: number }[]>([]);

    // ── Location ─────────────────────────────────────────────────────────────
    useEffect(() => {
        (async () => {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') { setErrorMsg('El permiso de ubicación fue denegado'); return; }
            setLocation(await Location.getCurrentPositionAsync({}));
        })();
    }, []);

    // ── Fetch active booking ──────────────────────────────────────────────────
    const fetchMyActiveBooking = useCallback(async () => {
        if (appMode !== 'passenger') return;
        try {
            const { data } = await axiosClient.get('/bookings/me');
            const active = (data as any[]).find(b => b.status === 'PENDING' || b.status === 'ACCEPTED');
            setMyActiveBooking(active ? { id: active.id, tripId: active.trip.id, status: active.status } : null);
        } catch {
            // silent
        }
    }, [appMode]);

    // ── Fetch trips — only runs when a destination is known ──────────────────
    const fetchTrips = useCallback(async (overrideLat?: number, overrideLng?: number) => {
        if (!location || appMode !== 'passenger') return;
        const eLat = overrideLat ?? destLat;
        const eLng = overrideLng ?? destLng;
        if (eLat === null || eLng === null) return;
        setLoadingTrips(true);
        try {
            const { latitude, longitude } = location.coords;
            const { data } = await axiosClient.get('/trips', {
                params: { lat: latitude, lng: longitude, destLat: eLat, destLng: eLng },
            });
            setTrips(data ?? []);
        } catch (error: any) {
            console.error('Error fetching trips:', error.response?.data || error.message);
        } finally {
            setLoadingTrips(false);
        }
    }, [location, appMode, destLat, destLng]);

    const fetchStopsCoverage = useCallback(async () => {
        if (appMode !== 'passenger') return;
        try {
            const stops = POPULAR_STOPS.map(s => ({ id: s.id, lat: s.lat, lng: s.lng }));
            const { data } = await axiosClient.get('/trips/stops-coverage', {
                params: { stops: JSON.stringify(stops) },
            });
            setCoveredStops(
                (data as Array<{ id: string; covered: boolean }>)
                    .filter(s => s.covered)
                    .map(s => s.id),
            );
        } catch {
            // silent
        }
    }, [appMode]);

    const fetchActiveDriverTrip = useCallback(async () => {
        if (appMode !== 'driver' || !isDriver) return;
        try {
            const { data } = await axiosClient.get('/trips/my-trips');
            const active = (data as DriverTripSummary[]).find(
                t => t.status === 'SCHEDULED' || t.status === 'ACTIVE'
            );
            setActiveDriverTrip(active ?? null);
        } catch {
            // silent
        }
    }, [appMode, isDriver]);

    const handlePreviewRoute = async (trip: TripMarker) => {
        setDropoffPoint(null);
        setRouteToDropoff([]);
        setPreviewTrip(trip);
        if (destLat !== null && destLng !== null) {
            try {
                const { data } = await axiosClient.get(`/trips/${trip.id}/closest-point`, {
                    params: { destLat, destLng },
                });
                setDropoffPoint({ latitude: data.latitude, longitude: data.longitude });
                const route: { latitude: number; longitude: number }[] = data.routeToDropoff ?? [];
                setRouteToDropoff(route);
                if (route.length) {
                    mapRef.current?.fitToCoordinates(route, {
                        edgePadding: { top: 80, right: 40, bottom: 300, left: 40 },
                        animated: true,
                    });
                }
            } catch {
                // silent — no polyline or marker if endpoint fails
            }
        }
    };

    const handleClearPreview = () => {
        setPreviewTrip(null);
        setDropoffPoint(null);
        setRouteToDropoff([]);
    };

    const handleClearDest = () => {
        setDestLat(null);
        setDestLng(null);
        setTrips([]);
        setSelectedTrip(null);
        setPreviewTrip(null);
        setDropoffPoint(null);
        setRouteToDropoff([]);
        destInputRef.current?.clear();
    };

    const handleStopTap = (stop: typeof POPULAR_STOPS[0]) => {
        setDestLat(stop.lat);
        setDestLng(stop.lng);
        destInputRef.current?.setAddressText(stop.name);
    };

    useEffect(() => {
        fetchTrips();
        fetchMyActiveBooking();
        fetchStopsCoverage();
        fetchActiveDriverTrip();
    }, [fetchTrips, fetchMyActiveBooking, fetchStopsCoverage, fetchActiveDriverTrip]);

    // ── Driver socket ─────────────────────────────────────────────────────────
    useEffect(() => {
        if (appMode !== 'driver' || !token) return;
        const socket = createSocket(token);
        socketRef.current = socket;
        socket.connect();

        socket.on('new_booking_request', (data: { passengerName: string; tripId: string; autoAccepted: boolean }) => {
            Alert.alert(
                data.autoAccepted ? '¡Nuevo pasajero!' : '¡Nueva solicitud!',
                data.autoAccepted
                    ? `${data.passengerName} se unió a tu viaje automáticamente.`
                    : `${data.passengerName} quiere unirse a tu viaje. Acepta o rechaza en Mis Viajes.`,
            );
        });

        return () => { socket.disconnect(); socketRef.current = null; };
    }, [appMode, token]);

    // ── Passenger socket ──────────────────────────────────────────────────────
    useEffect(() => {
        if (appMode !== 'passenger' || !token) return;
        const socket = createSocket(token);
        socketRef.current = socket;
        socket.connect();

        socket.on('booking_status_changed', (data: { bookingId: string; status: 'ACCEPTED' | 'REJECTED' }) => {
            if (data.status === 'ACCEPTED') {
                Alert.alert('¡Reserva aceptada!', 'El conductor te confirmó el viaje.');
                setMyActiveBooking(prev =>
                    prev?.id === data.bookingId ? { ...prev, status: 'ACCEPTED' } : prev
                );
            } else {
                Alert.alert('Reserva rechazada', 'El conductor no pudo aceptarte. Puedes buscar otro viaje.');
                setMyActiveBooking(null);
            }
        });

        socket.on('trip_canceled', (data: { tripId: string }) => {
            Alert.alert('Viaje cancelado', 'El conductor canceló el viaje. Puedes buscar otra opción.');
            setMyActiveBooking(prev => (prev?.tripId === data.tripId ? null : prev));
            setTrips(prev => prev.filter(t => t.id !== data.tripId));
        });

        socket.on('trip_started', (data: { tripId: string }) => {
            Alert.alert(
                '¡Tu viaje comenzó!',
                'El conductor ya está en camino.',
                [{ text: 'Ver viaje', onPress: () => navigation.navigate('ActiveTrip', { tripId: data.tripId }) }],
            );
        });

        return () => { socket.disconnect(); socketRef.current = null; };
    }, [appMode, token]);

    // ── Book seat ─────────────────────────────────────────────────────────────
    const handleBookSeat = async (tripId: string) => {
        setBookingTripId(tripId);
        try {
            const { data } = await axiosClient.post(`/bookings/${tripId}`, {
                destLat: destLat ?? undefined,
                destLng: destLng ?? undefined,
            });
            setTrips(prev =>
                prev.map(t => t.id === tripId ? { ...t, availableSeats: Math.max(0, t.availableSeats - 1) } : t)
            );
            setSelectedTrip(prev =>
                prev?.id === tripId ? { ...prev, availableSeats: Math.max(0, prev.availableSeats - 1) } : prev
            );
            setMyActiveBooking({ id: data.id, tripId, status: data.status === 'ACCEPTED' ? 'ACCEPTED' : 'PENDING' });
            setBookedTripId(tripId);
        } catch (error: any) {
            const msg = error.response?.data?.message || 'No se pudo solicitar el asiento. Intenta de nuevo.';
            Alert.alert('Error', Array.isArray(msg) ? msg.join('\n') : msg);
        } finally {
            setBookingTripId(null);
        }
    };

    // ── Cancel booking ────────────────────────────────────────────────────────
    const handleCancelBooking = async (bookingId: string) => {
        setCancelingBooking(true);
        try {
            await axiosClient.patch(`/bookings/${bookingId}/cancel`);
            setMyActiveBooking(null);
            if (selectedTrip) {
                setTrips(prev =>
                    prev.map(t => t.id === selectedTrip.id ? { ...t, availableSeats: t.availableSeats + 1 } : t)
                );
                setSelectedTrip(prev => prev ? { ...prev, availableSeats: prev.availableSeats + 1 } : prev);
            }
        } catch (error: any) {
            const msg = error.response?.data?.message || 'No se pudo cancelar la reserva.';
            Alert.alert('Error', Array.isArray(msg) ? msg.join('\n') : msg);
        } finally {
            setCancelingBooking(false);
        }
    };

    const handleCancelDriverTrip = (tripId: string) => {
        Alert.alert(
            'Cancelar viaje',
            'Se cancelarán todas las reservas activas. ¿Continuar?',
            [
                { text: 'No', style: 'cancel' },
                {
                    text: 'Sí, cancelar',
                    style: 'destructive',
                    onPress: async () => {
                        setCancelingDriverTrip(true);
                        try {
                            await axiosClient.patch(`/trips/${tripId}/cancel`);
                            setActiveDriverTrip(null);
                        } catch (error: any) {
                            const msg = error.response?.data?.message || 'No se pudo cancelar el viaje.';
                            Alert.alert('Error', Array.isArray(msg) ? msg.join('\n') : msg);
                        } finally {
                            setCancelingDriverTrip(false);
                        }
                    },
                },
            ]
        );
    };

    const handleCloseSheet = () => {
        setSelectedTrip(null);
        setBookedTripId(null);
    };

    const toggleAppMode = (mode: 'driver' | 'passenger') => {
        setAppMode(mode);
        if (mode === 'passenger' && location) fetchTrips();
    };

    // ─── Render ───────────────────────────────────────────────────────────────
    return (
        <View style={styles.container}>
            {/* Map area — fixed height in passenger mode, fills screen in driver mode */}
            <View style={appMode === 'passenger' ? styles.mapAreaPassenger : styles.mapAreaDriver}>
                {location ? (
                    <MapView
                        ref={mapRef}
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
                        {appMode === 'passenger' && POPULAR_STOPS
                            .filter(s => coveredStops.includes(s.id))
                            .map(stop => (
                                <Marker
                                    key={`stop-${stop.id}`}
                                    coordinate={{ latitude: stop.lat, longitude: stop.lng }}
                                    onPress={() => handleStopTap(stop)}
                                >
                                    <View style={styles.stopMarker}>
                                        <Ionicons name="location" size={13} color="#FFF" />
                                        <Text style={styles.stopMarkerText} numberOfLines={1}>
                                            {stop.name.split(' ')[0]}
                                        </Text>
                                    </View>
                                </Marker>
                            ))
                        }
                        {routeToDropoff.length > 0 && (
                            <Polyline
                                coordinates={routeToDropoff}
                                strokeColor="#0EA5E9"
                                strokeWidth={5}
                            />
                        )}
                        {dropoffPoint && (
                            <Marker coordinate={dropoffPoint} anchor={{ x: 0.5, y: 0.5 }}>
                                <View style={styles.dropoffMarker}>
                                    <Ionicons name="location" size={14} color="#FFF" />
                                    <Text style={styles.dropoffMarkerText}>Te bajan aquí</Text>
                                </View>
                            </Marker>
                        )}
                    </MapView>
                ) : (
                    <View style={styles.loadingContainer}>
                        <ActivityIndicator size="large" color="#0EA5E9" />
                        <Text style={styles.loadingText}>{errorMsg || 'Cargando mapa...'}</Text>
                    </View>
                )}
            </View>

            {/* Mode Toggle + Avatar — absolute over map */}
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
                <TouchableOpacity
                    style={styles.avatarBtn}
                    onPress={() => navigation.navigate('Profile')}
                    activeOpacity={0.8}
                >
                    <Text style={styles.avatarBtnText}>{user?.name?.[0]?.toUpperCase() ?? '?'}</Text>
                </TouchableOpacity>
            </View>

            {/* Passenger: destination search — absolute over map */}
            {appMode === 'passenger' && (
                <View style={[styles.passengerBar, { top: insets.top + 80 }]}>
                    <View style={styles.destSearchContainer}>
                        <GooglePlacesAutocomplete
                            ref={destInputRef}
                            placeholder="¿A dónde vas?"
                            onPress={(_data, details = null) => {
                                if (details) {
                                    const lat = details.geometry.location.lat;
                                    const lng = details.geometry.location.lng;
                                    setDestLat(lat);
                                    setDestLng(lng);
                                    fetchTrips(lat, lng);
                                }
                            }}
                            query={{ key: GOOGLE_MAPS_KEY, language: 'es' }}
                            fetchDetails={true}
                            styles={{
                                textInput: styles.destInput,
                                listView: {
                                    position: 'absolute', top: 48, zIndex: 100,
                                    borderRadius: 12, backgroundColor: '#FFF', elevation: 8,
                                },
                            }}
                            keyboardShouldPersistTaps="handled"
                        />
                        {destLat !== null && (
                            <TouchableOpacity style={styles.destClearBtn} onPress={handleClearDest}>
                                <Ionicons name="close-circle" size={20} color="#64748B" />
                            </TouchableOpacity>
                        )}
                    </View>
                </View>
            )}

            {/* Passenger: static bottom panel */}
            {appMode === 'passenger' && (
                <View style={styles.bottomPanel}>
                    <View style={styles.panelHeader}>
                        <View>
                            <Text style={styles.panelTitle}>
                                {destLat !== null ? 'Resultados para destino' : 'Viajes disponibles'}
                            </Text>
                            {!loadingTrips && destLat !== null && (
                                <Text style={styles.panelSubtitle}>
                                    {trips.length} viaje{trips.length !== 1 ? 's' : ''} encontrado{trips.length !== 1 ? 's' : ''}
                                </Text>
                            )}
                        </View>
                        <TouchableOpacity
                            style={[styles.myBookingsBtn, myActiveBooking && styles.myBookingsBtnActive]}
                            onPress={() => navigation.navigate('MyBookings')}
                            activeOpacity={0.8}
                        >
                            <Ionicons
                                name={myActiveBooking ? 'bookmark' : 'bookmark-outline'}
                                size={13}
                                color={myActiveBooking ? '#0EA5E9' : '#64748B'}
                            />
                            <Text style={[styles.myBookingsBtnText, myActiveBooking && styles.myBookingsBtnTextActive]}>
                                {myActiveBooking
                                    ? myActiveBooking.status === 'ACCEPTED' ? 'Reserva confirmada' : 'Reserva pendiente'
                                    : 'Mis Reservas'}
                            </Text>
                        </TouchableOpacity>
                    </View>

                    {loadingTrips ? (
                        <View style={styles.loadingPanel}>
                            <ActivityIndicator size="large" color="#0EA5E9" />
                            <Text style={styles.loadingPanelText}>Buscando viajes...</Text>
                        </View>
                    ) : trips.length === 0 ? (
                        destLat === null ? (
                            <View style={styles.emptyState}>
                                <Ionicons name="search-outline" size={44} color="#CBD5E1" />
                                <Text style={styles.inviteTitle}>¿A dónde vas hoy?</Text>
                                <Text style={styles.inviteSubtitle}>
                                    Escribe tu destino arriba para ver conductores disponibles
                                </Text>
                            </View>
                        ) : (
                            <View style={styles.emptyState}>
                                <Ionicons name="car-outline" size={40} color="#CBD5E1" />
                                <Text style={styles.emptyStateText}>No hay viajes disponibles</Text>
                                <TouchableOpacity onPress={() => fetchTrips()} style={styles.retryBtn}>
                                    <Ionicons name="refresh-outline" size={14} color="#64748B" />
                                    <Text style={styles.retryBtnText}>Reintentar</Text>
                                </TouchableOpacity>
                            </View>
                        )
                    ) : (
                        <FlatList
                            data={trips}
                            keyExtractor={item => item.id}
                            showsVerticalScrollIndicator={false}
                            contentContainerStyle={styles.tripListContent}
                            ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
                            renderItem={({ item: trip }) => {
                                const isMyBooked = myActiveBooking?.tripId === trip.id;
                                const isBusy = bookingTripId === trip.id;
                                return (
                                    <TouchableOpacity
                                        style={[styles.tripCard, isMyBooked && styles.tripCardBooked]}
                                        onPress={() => { setBookedTripId(null); setSelectedTrip(trip); }}
                                        activeOpacity={0.85}
                                    >
                                        <View style={styles.tripCardHeader}>
                                            <View style={styles.tripCardAvatar}>
                                                <Text style={styles.tripCardAvatarText}>
                                                    {trip.driver.name?.[0]?.toUpperCase() ?? '?'}
                                                </Text>
                                            </View>
                                            <View style={{ flex: 1 }}>
                                                <Text style={styles.tripCardDriverName} numberOfLines={1}>
                                                    {trip.driver.name}
                                                </Text>
                                                {trip.driver.vehicle && (
                                                    <Text style={styles.tripCardVehicle} numberOfLines={1}>
                                                        {trip.driver.vehicle.brand} · {trip.driver.vehicle.model} · {trip.driver.vehicle.color}
                                                    </Text>
                                                )}
                                            </View>
                                            {trip.matchType && (
                                                <View style={[
                                                    styles.tripCardBadge,
                                                    {
                                                        backgroundColor:
                                                            trip.matchType === 'exact' ? '#DCFCE7' :
                                                            trip.matchType === 'detour' ? '#FFF7ED' :
                                                            '#FEF9C3',
                                                    },
                                                ]}>
                                                    <Text style={[
                                                        styles.tripCardBadgeText,
                                                        {
                                                            color:
                                                                trip.matchType === 'exact' ? '#10B981' :
                                                                trip.matchType === 'detour' ? '#F97316' :
                                                                '#F59E0B',
                                                        },
                                                    ]}>
                                                        {trip.matchType === 'exact' ? 'Te deja ahí' :
                                                         trip.matchType === 'detour' ? `Se desvía ~${trip.detourMinutes}min` :
                                                         'Pasa cerca'}
                                                    </Text>
                                                </View>
                                            )}
                                        </View>

                                        <View style={styles.tripCardInfo}>
                                            <View style={styles.tripCardInfoItem}>
                                                <Ionicons name="time-outline" size={13} color="#64748B" />
                                                <Text style={styles.tripCardInfoText}>
                                                    {formatTime(trip.departureTime)}
                                                </Text>
                                            </View>
                                            <View style={styles.tripCardInfoItem}>
                                                <Ionicons name="people-outline" size={13} color="#64748B" />
                                                <Text style={styles.tripCardInfoText}>
                                                    {trip.availableSeats} asiento{trip.availableSeats !== 1 ? 's' : ''}
                                                </Text>
                                            </View>
                                            <View style={styles.tripCardInfoItem}>
                                                <Ionicons name="cash-outline" size={13} color="#0EA5E9" />
                                                <Text style={[styles.tripCardInfoText, { color: '#0EA5E9', fontWeight: '700' }]}>
                                                    S/ {Number(trip.pricePerSeat ?? 0).toFixed(2)}
                                                </Text>
                                            </View>
                                        </View>

                                        <View style={styles.tripCardActions}>
                                            <TouchableOpacity
                                                style={[
                                                    styles.tripCardRouteBtn,
                                                    previewTrip?.id === trip.id && styles.tripCardRouteBtnActive,
                                                ]}
                                                onPress={() => previewTrip?.id === trip.id
                                                    ? handleClearPreview()
                                                    : handlePreviewRoute(trip)
                                                }
                                            >
                                                <Ionicons
                                                    name="map-outline"
                                                    size={13}
                                                    color={previewTrip?.id === trip.id ? '#FFF' : '#0EA5E9'}
                                                />
                                                <Text style={[
                                                    styles.tripCardRouteBtnText,
                                                    previewTrip?.id === trip.id && styles.tripCardRouteBtnTextActive,
                                                ]}>
                                                    Ver ruta
                                                </Text>
                                            </TouchableOpacity>
                                            <TouchableOpacity
                                                style={[
                                                    styles.tripCardBookBtn,
                                                    (trip.availableSeats === 0 || (!!myActiveBooking && !isMyBooked)) && styles.tripCardBookBtnDisabled,
                                                    isMyBooked && styles.tripCardBookBtnBooked,
                                                ]}
                                                onPress={() => handleBookSeat(trip.id)}
                                                disabled={isBusy || trip.availableSeats === 0 || !!myActiveBooking}
                                            >
                                                {isBusy
                                                    ? <ActivityIndicator size="small" color="#FFF" />
                                                    : <Text style={styles.tripCardBookBtnText}>
                                                        {trip.availableSeats === 0 ? 'Lleno' : isMyBooked ? 'Reservado' : 'Solicitar'}
                                                      </Text>
                                                }
                                            </TouchableOpacity>
                                        </View>
                                    </TouchableOpacity>
                                );
                            }}
                        />
                    )}
                </View>
            )}

            {/* Driver: bottom panel */}
            {appMode === 'driver' && (
                <View style={[styles.bottomOverlay, { bottom: insets.bottom + 16 }]}>
                    {isDriver ? (
                        activeDriverTrip ? (() => {
                            const accepted = activeDriverTrip.bookings.filter(b => b.status === 'ACCEPTED');
                            const total = activeDriverTrip.availableSeats + accepted.length;
                            const visibleBookings = activeDriverTrip.bookings.filter(
                                b => b.status === 'PENDING' || b.status === 'ACCEPTED'
                            );
                            return (
                                <View style={styles.driverTripCard}>
                                    {/* Header */}
                                    <View style={styles.driverTripCardHeader}>
                                        <View style={styles.driverTripCardTitleRow}>
                                            <Ionicons name="car-sport-outline" size={16} color="#FFF" />
                                            <Text style={styles.driverTripCardTitle}>Viaje publicado</Text>
                                        </View>
                                        <View style={[
                                            styles.driverTripStatusBadge,
                                            { backgroundColor: activeDriverTrip.status === 'ACTIVE' ? '#DBEAFE' : '#DCFCE7' },
                                        ]}>
                                            <Text style={[
                                                styles.driverTripStatusText,
                                                { color: activeDriverTrip.status === 'ACTIVE' ? '#2563EB' : '#16A34A' },
                                            ]}>
                                                {activeDriverTrip.status === 'ACTIVE' ? 'En curso' : 'En espera'}
                                            </Text>
                                        </View>
                                    </View>

                                    <ScrollView style={{ maxHeight: 220 }} showsVerticalScrollIndicator={false}>
                                        {/* Route visual */}
                                        <View style={styles.driverTripRoute}>
                                            <View style={styles.driverTripRouteDots}>
                                                <View style={styles.driverTripOriginDot} />
                                                <View style={styles.driverTripRouteLine} />
                                                <View style={styles.driverTripDestDot} />
                                            </View>
                                            <View style={{ flex: 1, justifyContent: 'space-between', height: 36 }}>
                                                <Text style={styles.driverTripRouteLabel}>UTEC</Text>
                                                <Text style={styles.driverTripRouteLabel}>Destino</Text>
                                            </View>
                                        </View>

                                        {/* Metadata */}
                                        <View style={styles.driverTripMeta}>
                                            <View style={styles.driverTripMetaItem}>
                                                <Ionicons name="time-outline" size={13} color="#64748B" />
                                                <Text style={styles.driverTripMetaText}>
                                                    {formatTime(activeDriverTrip.departureTime)}
                                                </Text>
                                            </View>
                                            <View style={styles.driverTripMetaItem}>
                                                <Ionicons name="cash-outline" size={13} color="#64748B" />
                                                <Text style={styles.driverTripMetaText}>
                                                    S/ {Number(activeDriverTrip.pricePerSeat ?? 0).toFixed(2)}
                                                </Text>
                                            </View>
                                            <View style={styles.driverTripMetaItem}>
                                                <Ionicons name="people-outline" size={13} color="#64748B" />
                                                <Text style={styles.driverTripMetaText}>
                                                    {accepted.length}/{total}
                                                </Text>
                                            </View>
                                        </View>

                                        {/* Passenger list */}
                                        {visibleBookings.map(b => (
                                            <View key={b.id} style={styles.driverTripPassengerRow}>
                                                <View style={styles.driverTripPassengerAvatar}>
                                                    <Text style={styles.driverTripPassengerAvatarText}>
                                                        {b.passenger.name?.[0]?.toUpperCase() ?? '?'}
                                                    </Text>
                                                </View>
                                                <Text style={styles.driverTripPassengerName} numberOfLines={1}>
                                                    {b.passenger.name}
                                                </Text>
                                                <View style={[
                                                    styles.driverTripPassengerBadge,
                                                    { backgroundColor: b.status === 'ACCEPTED' ? '#DCFCE7' : '#FEF9C3' },
                                                ]}>
                                                    <Text style={[
                                                        styles.driverTripPassengerBadgeText,
                                                        { color: b.status === 'ACCEPTED' ? '#16A34A' : '#B45309' },
                                                    ]}>
                                                        {b.status === 'ACCEPTED' ? 'Confirmado' : 'Pendiente'}
                                                    </Text>
                                                </View>
                                            </View>
                                        ))}

                                        {/* Seat slots */}
                                        <View style={styles.driverTripSlots}>
                                            {Array.from({ length: total }).map((_, i) => (
                                                <View
                                                    key={i}
                                                    style={[
                                                        styles.driverTripSlot,
                                                        i < accepted.length && styles.driverTripSlotFilled,
                                                    ]}
                                                />
                                            ))}
                                        </View>
                                    </ScrollView>

                                    {/* Cancel button */}
                                    <TouchableOpacity
                                        style={styles.driverTripCancelBtn}
                                        onPress={() => handleCancelDriverTrip(activeDriverTrip.id)}
                                        disabled={cancelingDriverTrip}
                                        activeOpacity={0.75}
                                    >
                                        {cancelingDriverTrip ? (
                                            <ActivityIndicator size="small" color="#EF4444" />
                                        ) : (
                                            <>
                                                <Ionicons name="close-circle-outline" size={15} color="#EF4444" />
                                                <Text style={styles.driverTripCancelBtnText}>Cancelar viaje</Text>
                                            </>
                                        )}
                                    </TouchableOpacity>
                                </View>
                            );
                        })() : (
                            <TouchableOpacity style={styles.fab} onPress={() => navigation.navigate('CreateTrip')}>
                                <Text style={styles.fabText}>Publicar Viaje</Text>
                            </TouchableOpacity>
                        )
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
                onCancelBooking={handleCancelBooking}
                booking={bookingTripId === selectedTrip?.id}
                booked={bookedTripId === selectedTrip?.id}
                canceling={cancelingBooking}
                myBooking={
                    selectedTrip && myActiveBooking?.tripId === selectedTrip.id
                        ? myActiveBooking
                        : null
                }
            />
        </View>
    );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#F8FAFC' },
    loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, backgroundColor: '#F8FAFC' },
    loadingText: { fontSize: 14, color: '#64748B' },

    // Map areas
    mapAreaPassenger: { height: height * 0.52 },
    mapAreaDriver: { flex: 1 },

    // Mode toggle overlay
    overlay: {
        position: 'absolute', width: '100%', paddingHorizontal: 20, zIndex: 10,
        flexDirection: 'row', alignItems: 'center', gap: 10,
    },
    card: {
        flex: 1, flexDirection: 'row', backgroundColor: '#fff', borderRadius: 30, padding: 4,
        shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15, shadowRadius: 12, elevation: 8,
    },
    toggleButton: { flex: 1, paddingVertical: 12, borderRadius: 26, alignItems: 'center' },
    toggleText: { fontSize: 16, fontWeight: '600', color: '#64748B' },
    activePassenger: { backgroundColor: '#0EA5E9' },
    activeDriver: { backgroundColor: '#10B981' },
    activeText: { color: '#FFF' },
    avatarBtn: {
        width: 48, height: 48, borderRadius: 24,
        backgroundColor: '#0F172A', justifyContent: 'center', alignItems: 'center',
        shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.2, shadowRadius: 6, elevation: 6,
    },
    avatarBtnText: { color: '#38BDF8', fontSize: 18, fontWeight: '900' },

    // Destination search overlay
    passengerBar: { position: 'absolute', width: '100%', paddingHorizontal: 20, zIndex: 10 },
    destSearchContainer: { position: 'relative', zIndex: 20 },
    destInput: {
        height: 44, borderRadius: 22, backgroundColor: '#FFF', paddingHorizontal: 16,
        fontSize: 14, color: '#0F172A',
        shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1, shadowRadius: 6, elevation: 4,
    },
    destClearBtn: { position: 'absolute', right: 12, top: 12, zIndex: 21 },

    // Bottom panel
    bottomPanel: {
        flex: 1, backgroundColor: '#FFF',
        borderTopLeftRadius: 24, borderTopRightRadius: 24,
        paddingTop: 16,
        shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.08, shadowRadius: 12, elevation: 16,
    },
    panelHeader: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20, paddingBottom: 12,
        borderBottomWidth: 1, borderBottomColor: '#F1F5F9',
    },
    panelTitle: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
    panelSubtitle: { fontSize: 12, color: '#94A3B8', marginTop: 2 },
    loadingPanel: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
    loadingPanelText: { fontSize: 14, color: '#64748B' },
    emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
    emptyStateText: { fontSize: 15, color: '#94A3B8', fontWeight: '500' },
    inviteTitle: { fontSize: 17, fontWeight: '700', color: '#1E293B', textAlign: 'center' },
    inviteSubtitle: { fontSize: 13, color: '#94A3B8', textAlign: 'center', lineHeight: 20, paddingHorizontal: 24 },
    retryBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        paddingVertical: 8, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0',
    },
    retryBtnText: { fontSize: 13, color: '#64748B', fontWeight: '600' },
    tripListContent: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 20 },

    // Trip cards (vertical list)
    tripCard: {
        backgroundColor: '#FFF', borderRadius: 16, padding: 14, gap: 10,
        borderWidth: 1, borderColor: '#F1F5F9',
        shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
    },
    tripCardBooked: { borderWidth: 1.5, borderColor: '#BAE6FD', backgroundColor: '#F0F9FF' },
    tripCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    tripCardAvatar: {
        width: 36, height: 36, borderRadius: 18,
        backgroundColor: '#0F172A', justifyContent: 'center', alignItems: 'center',
    },
    tripCardAvatarText: { color: '#38BDF8', fontSize: 14, fontWeight: '800' },
    tripCardDriverName: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
    tripCardVehicle: { fontSize: 11, color: '#94A3B8', marginTop: 1 },
    tripCardBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
    tripCardBadgeText: { fontSize: 10, fontWeight: '700' },
    tripCardInfo: { flexDirection: 'row', gap: 14, flexWrap: 'wrap' },
    tripCardInfoItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    tripCardInfoText: { fontSize: 12, color: '#64748B' },
    tripCardActions: { flexDirection: 'row', gap: 8 },
    tripCardRouteBtn: {
        flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
        paddingVertical: 10, borderRadius: 10,
        borderWidth: 1.5, borderColor: '#0EA5E9', backgroundColor: 'transparent',
    },
    tripCardRouteBtnActive: { backgroundColor: '#0EA5E9', borderColor: '#0EA5E9' },
    tripCardRouteBtnText: { fontSize: 13, fontWeight: '700', color: '#0EA5E9' },
    tripCardRouteBtnTextActive: { color: '#FFF' },
    tripCardBookBtn: {
        flex: 1, paddingVertical: 10, borderRadius: 10,
        backgroundColor: '#0EA5E9', alignItems: 'center',
    },
    tripCardBookBtnDisabled: { backgroundColor: '#CBD5E1' },
    tripCardBookBtnBooked: { backgroundColor: '#10B981' },
    tripCardBookBtnText: { fontSize: 13, fontWeight: '700', color: '#FFF' },

    // Mis Reservas button (in panel header)
    myBookingsBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        backgroundColor: '#FFF', paddingVertical: 7, paddingHorizontal: 12, borderRadius: 20,
        borderWidth: 1, borderColor: '#E2E8F0',
    },
    myBookingsBtnActive: { borderColor: '#BAE6FD', backgroundColor: '#F0F9FF' },
    myBookingsBtnText: { fontSize: 12, fontWeight: '600', color: '#64748B' },
    myBookingsBtnTextActive: { color: '#0EA5E9' },

    // Driver FAB
    bottomOverlay: { position: 'absolute', width: '100%', paddingHorizontal: 20, alignItems: 'center' },
    fabGroup: { alignItems: 'center', gap: 10 },
    fab: {
        backgroundColor: '#10B981', paddingVertical: 16, paddingHorizontal: 40, borderRadius: 30,
        shadowColor: '#10B981', shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.3, shadowRadius: 10, elevation: 10,
    },
    fabText: { color: '#FFF', fontSize: 18, fontWeight: '800' },
    fabSecondary: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        backgroundColor: '#FFF', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 20,
        borderWidth: 1.5, borderColor: '#10B981',
        shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08, shadowRadius: 6, elevation: 4,
    },
    fabSecondaryText: { color: '#10B981', fontSize: 14, fontWeight: '700' },

    // Active driver trip card
    driverTripCard: {
        width: '100%',
        backgroundColor: '#FFF',
        borderRadius: 20,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.12,
        shadowRadius: 16,
        elevation: 20,
    },
    driverTripCardHeader: {
        backgroundColor: '#10B981',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    driverTripCardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    driverTripCardTitle: { fontSize: 15, fontWeight: '800', color: '#FFF' },
    driverTripStatusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
    driverTripStatusText: { fontSize: 11, fontWeight: '700' },
    driverTripRoute: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 16,
        paddingVertical: 10,
    },
    driverTripRouteDots: { alignItems: 'center', gap: 0 },
    driverTripOriginDot: {
        width: 10, height: 10, borderRadius: 5, backgroundColor: '#10B981',
    },
    driverTripRouteLine: {
        width: 2, height: 16, backgroundColor: '#E2E8F0',
    },
    driverTripDestDot: {
        width: 10, height: 10, borderRadius: 5, backgroundColor: '#EF4444',
    },
    driverTripRouteLabel: { fontSize: 13, fontWeight: '600', color: '#0F172A' },
    driverTripMeta: {
        flexDirection: 'row',
        gap: 14,
        paddingHorizontal: 16,
        paddingBottom: 8,
    },
    driverTripMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    driverTripMetaText: { fontSize: 12, color: '#64748B', fontWeight: '600' },
    driverTripPassengerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 16,
        paddingVertical: 7,
        borderTopWidth: 1,
        borderTopColor: '#F1F5F9',
    },
    driverTripPassengerAvatar: {
        width: 28, height: 28, borderRadius: 14,
        backgroundColor: '#0F172A', justifyContent: 'center', alignItems: 'center',
    },
    driverTripPassengerAvatarText: { color: '#38BDF8', fontSize: 11, fontWeight: '800' },
    driverTripPassengerName: { flex: 1, fontSize: 13, fontWeight: '600', color: '#1E293B' },
    driverTripPassengerBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
    driverTripPassengerBadgeText: { fontSize: 10, fontWeight: '700' },
    driverTripSlots: {
        flexDirection: 'row',
        gap: 6,
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderTopWidth: 1,
        borderTopColor: '#F1F5F9',
    },
    driverTripSlot: {
        width: 22, height: 22, borderRadius: 11,
        borderWidth: 1.5, borderColor: '#CBD5E1', backgroundColor: 'transparent',
    },
    driverTripSlotFilled: { backgroundColor: '#10B981', borderColor: '#10B981' },
    driverTripCancelBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        borderWidth: 1,
        borderColor: '#FECACA',
        borderRadius: 12,
        paddingVertical: 10,
        backgroundColor: '#FFF5F5',
        marginHorizontal: 16,
        marginTop: 4,
        marginBottom: 14,
    },
    driverTripCancelBtnText: { fontSize: 13, fontWeight: '700', color: '#EF4444' },

    // Dropoff point marker on map
    dropoffMarker: {
        flexDirection: 'row', alignItems: 'center', gap: 4,
        backgroundColor: '#10B981', borderRadius: 20,
        paddingVertical: 6, paddingHorizontal: 10,
        shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3, shadowRadius: 4, elevation: 6,
    },
    dropoffMarkerText: { color: '#FFF', fontSize: 11, fontWeight: '700' },

    // Stop markers on map
    stopMarker: {
        flexDirection: 'row', alignItems: 'center', gap: 3,
        backgroundColor: '#0EA5E9', borderRadius: 14, paddingVertical: 5, paddingHorizontal: 8,
        shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3, shadowRadius: 4, elevation: 5,
    },
    stopMarkerText: { color: '#FFF', fontSize: 10, fontWeight: '700', maxWidth: 70 },

    // Bottom sheet (TripSheet modal)
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
    sheetHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 20, gap: 14 },
    driverAvatar: {
        width: 52, height: 52, borderRadius: 26,
        backgroundColor: '#0F172A', justifyContent: 'center', alignItems: 'center',
    },
    driverAvatarText: { color: '#38BDF8', fontSize: 22, fontWeight: '900' },
    driverInfo: { flex: 1 },
    driverName: { fontSize: 20, fontWeight: '800', color: '#0F172A' },
    vehicleText: { fontSize: 14, color: '#64748B', marginTop: 2 },
    infoRow: { flexDirection: 'row', gap: 10, marginBottom: 24 },
    infoCard: {
        flex: 1, backgroundColor: '#F8FAFC', borderRadius: 16,
        padding: 14, alignItems: 'center', gap: 4,
        borderWidth: 1, borderColor: '#E2E8F0',
    },
    infoValue: { fontSize: 13, fontWeight: '800', color: '#0F172A', textAlign: 'center' },
    infoLabel: { fontSize: 11, color: '#94A3B8', textAlign: 'center' },
    bookingStatusCard: {
        borderRadius: 16, borderWidth: 1.5, padding: 16, gap: 12, backgroundColor: '#FAFAFA',
    },
    bookingStatusHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    bookingStatusTitle: { fontSize: 15, fontWeight: '800' },
    bookingStatusSubtitle: { fontSize: 13, color: '#64748B', marginTop: 2 },
    cancelBookingBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
        borderWidth: 1, borderColor: '#FECACA', borderRadius: 12,
        paddingVertical: 10, backgroundColor: '#FFF5F5',
    },
    cancelBookingBtnText: { fontSize: 14, fontWeight: '700', color: '#EF4444' },
    priceMatchRow: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 16, gap: 8,
    },
    priceTag: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    priceAmount: { fontSize: 18, fontWeight: '800', color: '#0F172A' },
    discountHint: {
        flexDirection: 'row', alignItems: 'center', gap: 3,
        backgroundColor: '#DCFCE7', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2,
    },
    discountHintText: { fontSize: 11, fontWeight: '700', color: '#16A34A' },
    matchBadge: {
        flexDirection: 'row', alignItems: 'center', gap: 4,
        paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
    },
    matchBadgeText: { fontSize: 12, fontWeight: '700' },
    bookButton: {
        backgroundColor: '#0EA5E9', paddingVertical: 18, borderRadius: 16,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        shadowColor: '#0EA5E9', shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
    },
    bookButtonDisabled: { backgroundColor: '#94A3B8', shadowOpacity: 0 },
    bookButtonText: { color: '#FFF', fontSize: 17, fontWeight: '800' },
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

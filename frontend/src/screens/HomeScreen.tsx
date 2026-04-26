import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, Modal,
    ActivityIndicator, Animated, Dimensions, ScrollView, FlatList, Alert, Linking
} from 'react-native';
import * as Location from 'expo-location';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
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
    departureTime?: string;
    destLat?: number;
    destLng?: number;
    driver?: {
        name: string;
        vehicle?: { brand: string; model: string; color: string; plate: string } | null;
    };
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
        isBoarded?: boolean;
        passenger: { id: string; name: string };
        destLat?: number;
        destLng?: number;
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

// ─── Avatar helpers ───────────────────────────────────────────────────────────

const AVATAR_COLORS = ['#10B981', '#F59E0B', '#8B5CF6', '#0EA5E9', '#EF4444', '#EC4899'];
const getAvatarColor = (id: string) => {
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = (hash + id.charCodeAt(i)) % AVATAR_COLORS.length;
    return AVATAR_COLORS[hash];
};
const getInitials = (name: string) => {
    const parts = name.trim().split(/\s+/);
    return parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : name.slice(0, 2).toUpperCase();
};

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
    const [confirmingBoarding, setConfirmingBoarding] = useState(false);
    const [boardedTripId, setBoardedTripId] = useState<string | null>(null);

    const [noShowCountdown, setNoShowCountdown] = useState<number | null>(null);

    const [activeDriverTrip, setActiveDriverTrip] = useState<DriverTripSummary | null>(null);
    const [cancelingDriverTrip, setCancelingDriverTrip] = useState(false);
    const [startingDriverTrip, setStartingDriverTrip] = useState(false);
    const [finishingDriverTrip, setFinishingDriverTrip] = useState(false);
    const [tick, setTick] = useState(0);
    const pulseAnim = useRef(new Animated.Value(1)).current;

    const [previewTrip, setPreviewTrip] = useState<TripMarker | null>(null);
    const [dropoffPoint, setDropoffPoint] = useState<{ latitude: number; longitude: number } | null>(null);
    const [routeToDropoff, setRouteToDropoff] = useState<{ latitude: number; longitude: number }[]>([]);
    const [geocodedAddresses, setGeocodedAddresses] = useState<Record<string, string>>({});

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
            setMyActiveBooking(active ? {
                id: active.id,
                tripId: active.trip.id,
                status: active.status,
                departureTime: active.trip.departureTime,
                driver: active.trip.driver,
                destLat: active.destLat ?? undefined,
                destLng: active.destLng ?? undefined,
            } : null);
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

    const reverseGeocode = useCallback(async (lat: number, lng: number) => {
        const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
        try {
            const res = await fetch(
                `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_MAPS_KEY}&language=es`
            );
            const json = await res.json();
            if (json.results?.length) {
                const comps: any[] = json.results[0].address_components ?? [];
                const route = comps.find((c: any) => c.types.includes('route'));
                const num = comps.find((c: any) => c.types.includes('street_number'));
                const address = route
                    ? `${route.long_name}${num ? ' ' + num.short_name : ''}`
                    : json.results[0].formatted_address.split(',')[0];
                setGeocodedAddresses(prev => ({ ...prev, [key]: address }));
            }
        } catch {
            // silent — coordinates shown as fallback
        }
    }, []);

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

    useEffect(() => {
        Animated.loop(
            Animated.sequence([
                Animated.timing(pulseAnim, { toValue: 0.3, duration: 800, useNativeDriver: true }),
                Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
            ])
        ).start();
    }, [pulseAnim]);

    // Tick every 15s — driver: re-evaluates "Iniciar Viaje"; passenger: re-evaluates "Confirmar subida"
    useEffect(() => {
        if (!activeDriverTrip || activeDriverTrip.status !== 'SCHEDULED') return;
        const id = setInterval(() => setTick(t => t + 1), 15_000);
        return () => clearInterval(id);
    }, [activeDriverTrip?.id, activeDriverTrip?.status]);

    useEffect(() => {
        if (appMode !== 'passenger' || !myActiveBooking) return;
        const id = setInterval(() => setTick(t => t + 1), 15_000);
        return () => clearInterval(id);
    }, [appMode, myActiveBooking?.id]);

    // 1-second countdown for passenger no-show window (departure → +5 min)
    useEffect(() => {
        if (appMode !== 'passenger' || !myActiveBooking?.departureTime || myActiveBooking.status !== 'ACCEPTED') {
            setNoShowCountdown(null);
            return;
        }
        const departureMs = new Date(myActiveBooking.departureTime).getTime();
        const deadlineMs  = departureMs + 5 * 60 * 1000;
        const update = () => {
            const remaining = Math.ceil((deadlineMs - Date.now()) / 1000);
            if (remaining > 0 && Date.now() >= departureMs) {
                setNoShowCountdown(remaining);
            } else {
                setNoShowCountdown(null);
            }
        };
        update();
        const id = setInterval(update, 1_000);
        return () => { clearInterval(id); setNoShowCountdown(null); };
    }, [appMode, myActiveBooking?.id, myActiveBooking?.status, myActiveBooking?.departureTime]);

    // Restore route to dropoff whenever active booking changes (e.g. after reload)
    useEffect(() => {
        if (!myActiveBooking?.tripId || myActiveBooking.destLat == null || myActiveBooking.destLng == null) return;
        // Only fetch if we don't already have a route painted
        if (routeToDropoff.length > 0) return;
        axiosClient.get(`/trips/${myActiveBooking.tripId}/closest-point`, {
            params: { destLat: myActiveBooking.destLat, destLng: myActiveBooking.destLng },
        }).then(({ data }) => {
            setDropoffPoint({ latitude: data.latitude, longitude: data.longitude });
            setRouteToDropoff(data.routeToDropoff ?? []);
        }).catch(() => {});
    }, [myActiveBooking?.id]);

    useEffect(() => {
        if (appMode !== 'driver' || !activeDriverTrip?.routePolyline?.coordinates?.length) return;
        const coords = activeDriverTrip.routePolyline.coordinates.map(c => ({
            latitude: c[1],
            longitude: c[0],
        }));
        setTimeout(() => {
            mapRef.current?.fitToCoordinates(coords, {
                edgePadding: { top: 80, right: 40, bottom: 380, left: 40 },
                animated: true,
            });
        }, 500);
    }, [activeDriverTrip?.id, appMode]);

    useFocusEffect(
        useCallback(() => {
            fetchActiveDriverTrip();
            fetchMyActiveBooking();
            setTick(t => t + 1);
        }, [fetchActiveDriverTrip, fetchMyActiveBooking])
    );

    useEffect(() => {
        if (!activeDriverTrip) return;
        const toGeocode: [number, number][] = [];
        const coords = activeDriverTrip.routePolyline?.coordinates;
        if (coords?.length) {
            const last = coords[coords.length - 1];
            toGeocode.push([last[1], last[0]]);
        }
        for (const b of activeDriverTrip.bookings) {
            const bLat = b.destLat != null ? Number(b.destLat) : null;
            const bLng = b.destLng != null ? Number(b.destLng) : null;
            if (bLat != null && !isNaN(bLat) && bLng != null && !isNaN(bLng)) toGeocode.push([bLat, bLng]);
        }
        setGeocodedAddresses({});
        toGeocode.forEach(([lat, lng]) => reverseGeocode(lat, lng));
    }, [activeDriverTrip?.id, activeDriverTrip?.bookings?.length, reverseGeocode]);

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
                    : `${data.passengerName} quiere unirse a tu viaje.`,
            );
            fetchActiveDriverTrip();
        });

        socket.on('booking_canceled', (data: { bookingId: string; tripId: string; passengerName: string }) => {
            Alert.alert('Pasajero canceló', `${data.passengerName} canceló su reserva.`);
            fetchActiveDriverTrip();
        });

        socket.on('trip_auto_canceled', () => {
            Alert.alert('Viaje cancelado automáticamente', 'Tu viaje fue cancelado porque no tenía pasajeros confirmados al llegar la hora de salida.');
            setActiveDriverTrip(null);
        });

        socket.on('passengerBoarded', (data: { bookingId: string }) => {
            setActiveDriverTrip(prev => {
                if (!prev) return prev;
                return {
                    ...prev,
                    bookings: prev.bookings.map(b =>
                        b.id === data.bookingId ? { ...b, isBoarded: true } : b
                    ),
                };
            });
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

        socket.on('trip_published', () => {
            fetchStopsCoverage();
            fetchTrips();
        });

        socket.on('noShowUpdated', (data: { bookingId: string }) => {
            setMyActiveBooking(prev => {
                if (prev?.id === data.bookingId) {
                    setDropoffPoint(null);
                    setRouteToDropoff([]);
                    return null;
                }
                return prev;
            });
            Alert.alert(
                'Reserva cancelada',
                'No confirmaste tu subida al auto a tiempo. Tu reserva fue cancelada automáticamente.',
            );
        });

        return () => { socket.disconnect(); socketRef.current = null; };
    }, [appMode, token, fetchStopsCoverage, fetchTrips]);

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
            const bookedTrip = trips.find(t => t.id === tripId);
            setMyActiveBooking({
                id: data.id,
                tripId,
                status: data.status === 'ACCEPTED' ? 'ACCEPTED' : 'PENDING',
                departureTime: bookedTrip?.departureTime,
                destLat: destLat ?? undefined,
                destLng: destLng ?? undefined,
                driver: bookedTrip?.driver ? {
                    name: bookedTrip.driver.name,
                    vehicle: bookedTrip.driver.vehicle ?? null,
                } : undefined,
            });
            setBookedTripId(tripId);
        } catch (error: any) {
            const msg = error.response?.data?.message || 'No se pudo solicitar el asiento. Intenta de nuevo.';
            Alert.alert('Error', Array.isArray(msg) ? msg.join('\n') : msg);
        } finally {
            setBookingTripId(null);
        }
    };

    // ── Confirm boarding ──────────────────────────────────────────────────────
    const handleConfirmBoarding = async () => {
        if (!myActiveBooking) return;
        setConfirmingBoarding(true);
        try {
            await axiosClient.patch(`/bookings/${myActiveBooking.id}/board`);
            setBoardedTripId(myActiveBooking.tripId);
            Alert.alert('¡Confirmado!', 'Se registró tu subida al vehículo.');
        } catch (error: any) {
            const msg = error.response?.data?.message || 'No se pudo confirmar la subida.';
            Alert.alert('Error', Array.isArray(msg) ? msg.join('\n') : msg);
        } finally {
            setConfirmingBoarding(false);
        }
    };

    // ── Cancel booking ────────────────────────────────────────────────────────
    const handleCancelBooking = async (bookingId: string) => {
        setCancelingBooking(true);
        try {
            await axiosClient.patch(`/bookings/${bookingId}/cancel`);
            setMyActiveBooking(null);
            setDropoffPoint(null);
            setRouteToDropoff([]);
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

    const handleAcceptBooking = async (bookingId: string) => {
        try {
            await axiosClient.patch(`/bookings/${bookingId}/accept`);
            setActiveDriverTrip(prev => {
                if (!prev) return null;
                return {
                    ...prev,
                    availableSeats: prev.availableSeats - 1,
                    bookings: prev.bookings.map(b =>
                        b.id === bookingId ? { ...b, status: 'ACCEPTED' as const } : b
                    ),
                };
            });
        } catch (error: any) {
            const msg = error.response?.data?.message || 'No se pudo aceptar la solicitud.';
            Alert.alert('Error', Array.isArray(msg) ? msg.join('\n') : msg);
        }
    };

    const handleRejectBooking = async (bookingId: string) => {
        try {
            await axiosClient.patch(`/bookings/${bookingId}/reject`);
            setActiveDriverTrip(prev => {
                if (!prev) return null;
                return {
                    ...prev,
                    bookings: prev.bookings.map(b =>
                        b.id === bookingId ? { ...b, status: 'REJECTED' as const } : b
                    ),
                };
            });
        } catch (error: any) {
            const msg = error.response?.data?.message || 'No se pudo rechazar la solicitud.';
            Alert.alert('Error', Array.isArray(msg) ? msg.join('\n') : msg);
        }
    };

    const handleStartDriverTrip = async () => {
        if (!activeDriverTrip) return;
        setStartingDriverTrip(true);
        try {
            await axiosClient.patch(`/trips/${activeDriverTrip.id}/start`);
            setActiveDriverTrip(prev => prev ? { ...prev, status: 'ACTIVE' } : null);

            const coords = activeDriverTrip.routePolyline?.coordinates;
            if (coords?.length) {
                const last = coords[coords.length - 1];
                const lat = last[1]; const lng = last[0];
                const wazeUrl = `waze://?ll=${lat},${lng}&navigate=yes`;
                const googleNative = `comgooglemaps://?daddr=${lat},${lng}&directionsmode=driving`;
                const googleWeb = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
                const [wazeOk, googleOk] = await Promise.all([
                    Linking.canOpenURL(wazeUrl),
                    Linking.canOpenURL(googleNative),
                ]);
                const opts: { text: string; onPress?: () => void; style?: 'cancel' | 'default' | 'destructive' }[] = [];
                if (googleOk) opts.push({ text: 'Google Maps', onPress: () => Linking.openURL(googleNative) });
                else opts.push({ text: 'Google Maps', onPress: () => Linking.openURL(googleWeb) });
                if (wazeOk) opts.push({ text: 'Waze', onPress: () => Linking.openURL(wazeUrl) });
                opts.push({ text: 'Ahora no', style: 'cancel' });
                Alert.alert('¿Navegar al destino?', undefined, opts);
            }
        } catch (error: any) {
            const msg = error.response?.data?.message || 'No se pudo iniciar el viaje.';
            Alert.alert('Error', Array.isArray(msg) ? msg.join('\n') : msg);
        } finally {
            setStartingDriverTrip(false);
        }
    };

    const handleFinishDriverTrip = async () => {
        Alert.alert(
            'Finalizar viaje',
            '¿Confirmas que has llegado al destino?',
            [
                { text: 'No', style: 'cancel' },
                {
                    text: 'Sí, finalizar',
                    onPress: async () => {
                        if (!activeDriverTrip) return;
                        setFinishingDriverTrip(true);
                        try {
                            await axiosClient.patch(`/trips/${activeDriverTrip.id}/finish`);
                            setActiveDriverTrip(null);
                        } catch (error: any) {
                            const msg = error.response?.data?.message || 'No se pudo finalizar el viaje.';
                            Alert.alert('Error', Array.isArray(msg) ? msg.join('\n') : msg);
                        } finally {
                            setFinishingDriverTrip(false);
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
                        {appMode === 'driver' && activeDriverTrip?.routePolyline?.coordinates && activeDriverTrip.routePolyline.coordinates.length > 0 && (
                            <Polyline
                                coordinates={activeDriverTrip.routePolyline.coordinates.map(c => ({
                                    latitude: c[1],
                                    longitude: c[0],
                                }))}
                                strokeColor="#10B981"
                                strokeWidth={4}
                            />
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
                                {myActiveBooking
                                    ? 'Viaje seleccionado'
                                    : destLat !== null ? 'Resultados para destino' : 'Viajes disponibles'}
                            </Text>
                            {!myActiveBooking && !loadingTrips && destLat !== null && (
                                <Text style={styles.panelSubtitle}>
                                    {trips.length} viaje{trips.length !== 1 ? 's' : ''} encontrado{trips.length !== 1 ? 's' : ''}
                                </Text>
                            )}
                        </View>
                    </View>

                    {myActiveBooking ? (
                        /* ── Viaje seleccionado ───────────────────────────────────── */
                        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.bookedTripContent}>
                            {/* Driver card */}
                            <View style={styles.bookedDriverCard}>
                                <View style={styles.bookedDriverAvatar}>
                                    <Text style={styles.bookedDriverAvatarText}>
                                        {myActiveBooking.driver?.name?.[0]?.toUpperCase() ?? '?'}
                                    </Text>
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.bookedDriverName}>
                                        {myActiveBooking.driver?.name ?? 'Conductor'}
                                    </Text>
                                    {myActiveBooking.driver?.vehicle && (
                                        <Text style={styles.bookedVehicleText}>
                                            {myActiveBooking.driver.vehicle.brand} · {myActiveBooking.driver.vehicle.model} · {myActiveBooking.driver.vehicle.color} · {myActiveBooking.driver.vehicle.plate}
                                        </Text>
                                    )}
                                </View>
                                <View style={[
                                    styles.bookedStatusBadge,
                                    { backgroundColor: myActiveBooking.status === 'ACCEPTED' ? '#DCFCE7' : '#FEF3C7' },
                                ]}>
                                    <Ionicons
                                        name={myActiveBooking.status === 'ACCEPTED' ? 'checkmark-circle-outline' : 'time-outline'}
                                        size={13}
                                        color={myActiveBooking.status === 'ACCEPTED' ? '#10B981' : '#F59E0B'}
                                    />
                                    <Text style={[
                                        styles.bookedStatusText,
                                        { color: myActiveBooking.status === 'ACCEPTED' ? '#10B981' : '#F59E0B' },
                                    ]}>
                                        {myActiveBooking.status === 'ACCEPTED' ? 'Confirmado' : 'Pendiente'}
                                    </Text>
                                </View>
                            </View>

                            {/* Departure time */}
                            {myActiveBooking.departureTime && (
                                <View style={styles.bookedTimeRow}>
                                    <Ionicons name="time-outline" size={15} color="#64748B" />
                                    <Text style={styles.bookedTimeText}>
                                        Salida: {formatTime(myActiveBooking.departureTime)}
                                    </Text>
                                </View>
                            )}

                            {/* Confirm boarding — appears when accepted + departure time reached */}
                            {myActiveBooking.status === 'ACCEPTED' &&
                             myActiveBooking.departureTime &&
                             tick >= 0 &&
                             new Date() >= new Date(myActiveBooking.departureTime) &&
                             boardedTripId !== myActiveBooking.tripId && (
                                <View style={{ gap: 8 }}>
                                    {/* Countdown warning */}
                                    {noShowCountdown !== null && (
                                        <View style={styles.noShowCountdownRow}>
                                            <Ionicons name="warning-outline" size={15} color="#DC2626" />
                                            <Text style={styles.noShowCountdownText}>
                                                {`${Math.floor(noShowCountdown / 60)}:${String(noShowCountdown % 60).padStart(2, '0')} para confirmar tu subida o se cancelará tu reserva`}
                                            </Text>
                                        </View>
                                    )}
                                    <TouchableOpacity
                                        style={styles.bookedBoardBtn}
                                        onPress={handleConfirmBoarding}
                                        disabled={confirmingBoarding}
                                        activeOpacity={0.85}
                                    >
                                        {confirmingBoarding
                                            ? <ActivityIndicator color="#FFF" />
                                            : <>
                                                <Ionicons name="car-outline" size={18} color="#FFF" />
                                                <Text style={styles.bookedBoardBtnText}>Confirmar subida al auto</Text>
                                              </>
                                        }
                                    </TouchableOpacity>
                                </View>
                            )}

                            {/* Cancel booking */}
                            <TouchableOpacity
                                style={styles.cancelBookingBtn}
                                onPress={() => handleCancelBooking(myActiveBooking.id)}
                                disabled={cancelingBooking}
                                activeOpacity={0.75}
                            >
                                {cancelingBooking
                                    ? <ActivityIndicator size="small" color="#EF4444" />
                                    : <>
                                        <Ionicons name="close-circle-outline" size={16} color="#EF4444" />
                                        <Text style={styles.cancelBookingBtnText}>Cancelar reserva</Text>
                                      </>
                                }
                            </TouchableOpacity>
                        </ScrollView>
                    ) : loadingTrips ? (
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
                                            {isMyBooked &&
                                             myActiveBooking?.status === 'ACCEPTED' &&
                                             tick >= 0 &&
                                             new Date() >= new Date(trip.departureTime) &&
                                             boardedTripId !== trip.id ? (
                                                <TouchableOpacity
                                                    style={[styles.tripCardBookBtn, styles.tripCardBoardBtn]}
                                                    onPress={handleConfirmBoarding}
                                                    disabled={confirmingBoarding}
                                                >
                                                    {confirmingBoarding
                                                        ? <ActivityIndicator size="small" color="#FFF" />
                                                        : <Text style={styles.tripCardBookBtnText}>Confirmar subida</Text>
                                                    }
                                                </TouchableOpacity>
                                            ) : (
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
                                            )}
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
                <>
                    {isDriver && activeDriverTrip ? (() => {
                            const activeBookings = activeDriverTrip.bookings.filter(
                                b => b.status !== 'REJECTED' && b.status !== 'CANCELED'
                            );
                            const acceptedCount = activeBookings.filter(b => b.status === 'ACCEPTED').length;
                            const totalSeats = acceptedCount + activeDriverTrip.availableSeats;
                            const now = tick >= 0 ? new Date() : new Date();
                            const departureMs = new Date(activeDriverTrip.departureTime).getTime();
                            const minutesLate = (now.getTime() - departureMs) / 60_000;
                            const acceptedBookings = activeDriverTrip.bookings.filter(b => b.status === 'ACCEPTED');
                            const allBoarded = acceptedBookings.length > 0 && acceptedBookings.every(b => b.isBoarded);
                            const graceExpired = minutesLate >= 5;
                            const canStart = activeDriverTrip.status === 'SCHEDULED' &&
                                minutesLate >= 0 &&
                                (allBoarded || graceExpired);
                            const destCoords = activeDriverTrip.routePolyline?.coordinates;
                            const destLatVal = destCoords?.length ? destCoords[destCoords.length - 1][1] : null;
                            const destLngVal = destCoords?.length ? destCoords[destCoords.length - 1][0] : null;
                            const destKey = destLatVal != null && destLngVal != null
                                ? `${destLatVal.toFixed(5)},${destLngVal.toFixed(5)}`
                                : null;
                            const destAddress = destKey
                                ? (geocodedAddresses[destKey] ?? `${destLatVal!.toFixed(4)}, ${destLngVal!.toFixed(4)}`)
                                : 'Destino';
                            return (
                                <View style={styles.driverTripFullOverlay}>
                                <View style={[styles.driverTripCard, { paddingBottom: insets.bottom }]}>
                                    {/* Header */}
                                    <View style={styles.driverTripCardHeader}>
                                        <Text style={styles.driverTripCardTitle}>Viaje publicado</Text>
                                        <View style={styles.driverTripStatusBadge}>
                                            <Text style={styles.driverTripStatusText}>
                                                {activeDriverTrip.status === 'ACTIVE' ? 'En curso' : 'En espera'}
                                            </Text>
                                        </View>
                                    </View>

                                    <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 460 }}>
                                        {/* Route visual — origin + passenger drop-offs + destination */}
                                        {(() => {
                                            type RouteStop = { label: string; type: 'origin' | 'passenger' | 'dest'; names?: string };
                                            const stops: RouteStop[] = [{ label: 'UTEC', type: 'origin' }];
                                            const seen = new Set<string>();
                                            for (const b of acceptedBookings) {
                                                const bLat = b.destLat != null ? Number(b.destLat) : null;
                                                const bLng = b.destLng != null ? Number(b.destLng) : null;
                                                if (bLat != null && !isNaN(bLat) && bLng != null && !isNaN(bLng)) {
                                                    const key = `${bLat.toFixed(5)},${bLng.toFixed(5)}`;
                                                    if (!seen.has(key)) {
                                                        seen.add(key);
                                                        const addr = geocodedAddresses[key] ?? `${bLat.toFixed(4)}, ${bLng.toFixed(4)}`;
                                                        const names = acceptedBookings
                                                            .filter(ab => {
                                                                const aLat = ab.destLat != null ? Number(ab.destLat) : null;
                                                                const aLng = ab.destLng != null ? Number(ab.destLng) : null;
                                                                return aLat != null && aLng != null &&
                                                                       aLat.toFixed(5) === bLat!.toFixed(5) &&
                                                                       aLng.toFixed(5) === bLng!.toFixed(5);
                                                            })
                                                            .map(ab => ab.passenger.name.split(' ')[0])
                                                            .join(', ');
                                                        stops.push({ label: addr, type: 'passenger', names });
                                                    }
                                                }
                                            }
                                            stops.push({ label: destAddress, type: 'dest' });
                                            return (
                                                <View style={[styles.driverTripRouteSection, { flexDirection: 'column' }]}>
                                                    {stops.map((stop, i) => (
                                                        <React.Fragment key={i}>
                                                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                                                                <View style={{ width: 12, alignItems: 'center' }}>
                                                                    <View style={
                                                                        stop.type === 'origin' ? styles.driverTripOriginDot :
                                                                        stop.type === 'dest'   ? styles.driverTripDestDot :
                                                                                                 styles.driverTripIntermediateDot
                                                                    } />
                                                                </View>
                                                                <View style={{ flex: 1 }}>
                                                                    {stop.type === 'passenger' && stop.names && (
                                                                        <Text style={styles.driverTripIntermediateLabel}>
                                                                            Baja: {stop.names}
                                                                        </Text>
                                                                    )}
                                                                    <Text style={styles.driverTripRouteLabel} numberOfLines={2}>
                                                                        {stop.label}
                                                                    </Text>
                                                                </View>
                                                            </View>
                                                            {i < stops.length - 1 && (
                                                                <View style={{ flexDirection: 'row', gap: 12 }}>
                                                                    <View style={{ width: 12, alignItems: 'center' }}>
                                                                        {[0, 1, 2].map(j => (
                                                                            <View key={j} style={{ width: 2, height: 5, backgroundColor: '#CBD5E1', borderRadius: 1, marginVertical: 1 }} />
                                                                        ))}
                                                                    </View>
                                                                </View>
                                                            )}
                                                        </React.Fragment>
                                                    ))}
                                                </View>
                                            );
                                        })()}

                                        {/* Stats */}
                                        <View style={styles.driverTripStatsDark}>
                                            <View style={styles.driverTripStatDark}>
                                                <Text style={styles.driverTripStatDarkValue}>
                                                    {formatTime(activeDriverTrip.departureTime)}
                                                </Text>
                                                <Text style={styles.driverTripStatDarkLabel}>Salida</Text>
                                            </View>
                                            <View style={styles.driverTripStatDark}>
                                                <Text style={styles.driverTripStatDarkValue}>
                                                    S/ {Number(activeDriverTrip.pricePerSeat ?? 0).toFixed(0)}
                                                </Text>
                                                <Text style={styles.driverTripStatDarkLabel}>Por asiento</Text>
                                            </View>
                                            <View style={styles.driverTripStatDark}>
                                                <Text style={styles.driverTripStatDarkValue}>
                                                    {acceptedCount}/{totalSeats}
                                                </Text>
                                                <Text style={styles.driverTripStatDarkLabel}>Asientos</Text>
                                            </View>
                                        </View>

                                        {/* Passengers label */}
                                        <Text style={styles.driverTripPassengersLabel}>
                                            Pasajeros ({acceptedCount} confirmado{acceptedCount !== 1 ? 's' : ''})
                                        </Text>

                                        {/* Passenger rows */}
                                        {activeBookings.length === 0 ? (
                                            <View style={styles.driverTripEmptyPassengers}>
                                                <Text style={styles.driverTripEmptyPassengersText}>
                                                    Aún no hay pasajeros
                                                </Text>
                                            </View>
                                        ) : activeBookings.map(b => {
                                            const bLat = b.destLat != null ? Number(b.destLat) : null;
                                            const bLng = b.destLng != null ? Number(b.destLng) : null;
                                            const validDrop = bLat != null && !isNaN(bLat) && bLng != null && !isNaN(bLng);
                                            const dropKey = validDrop
                                                ? `${bLat!.toFixed(5)},${bLng!.toFixed(5)}`
                                                : null;
                                            const dropAddress = dropKey
                                                ? (geocodedAddresses[dropKey] ?? `${bLat!.toFixed(4)}, ${bLng!.toFixed(4)}`)
                                                : null;
                                            const initials = getInitials(b.passenger.name);
                                            const avatarColor = getAvatarColor(b.passenger.id);
                                            return (
                                                <View key={b.id} style={styles.driverTripPassengerRow}>
                                                    <View style={[styles.driverTripPassengerAvatar, { backgroundColor: avatarColor }]}>
                                                        <Text style={styles.driverTripPassengerAvatarText}>{initials}</Text>
                                                    </View>
                                                    <View style={styles.driverTripPassengerInfo}>
                                                        <Text style={styles.driverTripPassengerName} numberOfLines={1}>
                                                            {b.passenger.name}
                                                        </Text>
                                                        <Text style={styles.driverTripPassengerDrop} numberOfLines={1}>
                                                            {dropAddress ? `Baja en ${dropAddress}` : 'Baja en destino final'}
                                                        </Text>
                                                    </View>
                                                    {b.status === 'PENDING' ? (
                                                        <View style={styles.driverTripPassengerActions}>
                                                            <TouchableOpacity
                                                                style={[styles.driverTripPassengerActionBtn, { backgroundColor: '#DCFCE7' }]}
                                                                onPress={() => handleAcceptBooking(b.id)}
                                                            >
                                                                <Ionicons name="checkmark" size={15} color="#16A34A" />
                                                            </TouchableOpacity>
                                                            <TouchableOpacity
                                                                style={[styles.driverTripPassengerActionBtn, { backgroundColor: '#FEE2E2' }]}
                                                                onPress={() => handleRejectBooking(b.id)}
                                                            >
                                                                <Ionicons name="close" size={15} color="#DC2626" />
                                                            </TouchableOpacity>
                                                        </View>
                                                    ) : b.status === 'ACCEPTED' ? (
                                                        <View style={{ alignItems: 'flex-end', gap: 4 }}>
                                                            <View style={[styles.driverTripPassengerBadge, { backgroundColor: '#DCFCE7' }]}>
                                                                <Text style={[styles.driverTripPassengerBadgeText, { color: '#16A34A' }]}>
                                                                    Confirmado
                                                                </Text>
                                                            </View>
                                                            <View style={[styles.driverTripPassengerBadge, {
                                                                backgroundColor: b.isBoarded ? '#DBEAFE' : '#FEF3C7',
                                                            }]}>
                                                                <Text style={[styles.driverTripPassengerBadgeText, {
                                                                    color: b.isBoarded ? '#2563EB' : '#B45309',
                                                                }]}>
                                                                    {b.isBoarded ? '✓ A bordo' : ' Sin subir'}
                                                                </Text>
                                                            </View>
                                                        </View>
                                                    ) : (
                                                        <View style={[
                                                            styles.driverTripPassengerBadge,
                                                            {
                                                                backgroundColor:
                                                                    b.status === 'COMPLETED' ? '#DBEAFE' : '#F1F5F9',
                                                            },
                                                        ]}>
                                                            <Text style={[
                                                                styles.driverTripPassengerBadgeText,
                                                                {
                                                                    color:
                                                                        b.status === 'COMPLETED' ? '#2563EB' : '#64748B',
                                                                },
                                                            ]}>
                                                                {b.status === 'COMPLETED' ? 'Completado' : b.status}
                                                            </Text>
                                                        </View>
                                                    )}
                                                </View>
                                            );
                                        })}

                                        {/* Iniciar / Finalizar */}
                                        {activeDriverTrip.status === 'SCHEDULED' && minutesLate >= 0 && !canStart && acceptedBookings.length > 0 && (
                                            <View style={styles.waitingBoardingRow}>
                                                <Ionicons name="time-outline" size={15} color="#F59E0B" />
                                                <Text style={styles.waitingBoardingText}>
                                                    {graceExpired
                                                        ? 'Puedes iniciar aunque falten pasajeros'
                                                        : `Esperando que todos suban al auto (${Math.ceil(5 - minutesLate)} min restantes para poder iniciar)`}
                                                </Text>
                                            </View>
                                        )}
                                        {canStart && (
                                            <TouchableOpacity
                                                style={[styles.driverTripActionBtn, { backgroundColor: '#0EA5E9' }]}
                                                onPress={handleStartDriverTrip}
                                                disabled={startingDriverTrip}
                                            >
                                                {startingDriverTrip
                                                    ? <ActivityIndicator color="#FFF" />
                                                    : <>
                                                        <Ionicons name="play-circle-outline" size={18} color="#FFF" />
                                                        <Text style={styles.driverTripActionBtnText}>Iniciar Viaje</Text>
                                                      </>
                                                }
                                            </TouchableOpacity>
                                        )}
                                        {activeDriverTrip.status === 'ACTIVE' && (
                                            <TouchableOpacity
                                                style={[styles.driverTripActionBtn, { backgroundColor: '#EF4444' }]}
                                                onPress={handleFinishDriverTrip}
                                                disabled={finishingDriverTrip}
                                            >
                                                {finishingDriverTrip
                                                    ? <ActivityIndicator color="#FFF" />
                                                    : <>
                                                        <Ionicons name="flag-outline" size={18} color="#FFF" />
                                                        <Text style={styles.driverTripActionBtnText}>Finalizar Viaje</Text>
                                                      </>
                                                }
                                            </TouchableOpacity>
                                        )}
                                    </ScrollView>

                                    {/* Cancel — only before departure time */}
                                    {activeDriverTrip.status === 'SCHEDULED' &&
                                     tick >= 0 &&
                                     new Date() < new Date(activeDriverTrip.departureTime) && (
                                        <TouchableOpacity
                                            style={styles.driverTripCancelBtn}
                                            onPress={() => handleCancelDriverTrip(activeDriverTrip.id)}
                                            disabled={cancelingDriverTrip}
                                            activeOpacity={0.75}
                                        >
                                            {cancelingDriverTrip
                                                ? <ActivityIndicator size="small" color="#EF4444" />
                                                : <>
                                                    <Ionicons name="close-circle-outline" size={16} color="#EF4444" />
                                                    <Text style={styles.driverTripCancelBtnText}>Cancelar viaje</Text>
                                                  </>
                                            }
                                        </TouchableOpacity>
                                    )}
                                </View>
                                </View>
                            );
                        })() : (
                            <View style={[styles.bottomOverlay, { bottom: insets.bottom + 16 }]}>
                                {isDriver ? (
                                    <TouchableOpacity style={styles.fab} onPress={() => navigation.navigate('CreateTrip')}>
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
                </>
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
    tripCardBoardBtn: { backgroundColor: '#8B5CF6' },
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

    // Active driver trip card — full-width bottom sheet
    driverTripFullOverlay: {
        position: 'absolute' as const,
        bottom: 0,
        left: 0,
        right: 0,
    },
    driverTripCard: {
        backgroundColor: '#FFF',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        overflow: 'hidden' as const,
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
    driverTripStatusBadge: {
        paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20,
        backgroundColor: 'rgba(255,255,255,0.25)',
    },
    driverTripStatusText: { fontSize: 11, fontWeight: '700' as const, color: '#FFF' },
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
    driverTripIntermediateDot: {
        width: 8, height: 8, borderRadius: 4, backgroundColor: '#8B5CF6',
    },
    driverTripIntermediateLabel: {
        fontSize: 10, fontWeight: '700' as const, color: '#8B5CF6', marginBottom: 1,
    },
    driverTripRouteLabel: { fontSize: 13, fontWeight: '600' as const, color: '#64748B' },
    driverTripMeta: {
        flexDirection: 'row',
        gap: 14,
        paddingHorizontal: 16,
        paddingBottom: 8,
    },
    driverTripMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    driverTripMetaText: { fontSize: 12, color: '#64748B', fontWeight: '600' },
    driverTripPassengerRow: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: 10,
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderTopWidth: 1,
        borderTopColor: '#F1F5F9',
    },
    driverTripPassengerAvatar: {
        width: 36, height: 36, borderRadius: 10,
        justifyContent: 'center', alignItems: 'center',
    },
    driverTripPassengerAvatarText: { color: '#FFF', fontSize: 13, fontWeight: '800' as const },
    driverTripPassengerName: { fontSize: 13, fontWeight: '700' as const, color: '#1E293B' },
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
    driverTripPulseDot: {
        width: 8, height: 8, borderRadius: 4, backgroundColor: '#ECFDF5',
    },
    driverTripCancelHeaderBtnText: { fontSize: 13, fontWeight: '700', color: '#FECACA' },
    driverTripStats: {
        flexDirection: 'row' as const,
        gap: 16,
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: '#F1F5F9',
    },
    driverTripStatItem: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4 },
    driverTripStatText: { fontSize: 13, fontWeight: '600' as const, color: '#64748B' },
    driverTripEmptyPassengers: { alignItems: 'center' as const, paddingVertical: 16 },
    driverTripEmptyPassengersText: { fontSize: 13, color: '#94A3B8', fontStyle: 'italic' as const },
    driverTripPassengerActions: { flexDirection: 'row' as const, gap: 6 },
    driverTripPassengerActionBtn: {
        width: 32, height: 32, borderRadius: 10, justifyContent: 'center' as const, alignItems: 'center' as const,
    },
    driverTripActionBtn: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
        gap: 8,
        marginHorizontal: 16,
        marginBottom: 14,
        marginTop: 6,
        paddingVertical: 14,
        borderRadius: 14,
    },
    driverTripActionBtnText: { fontSize: 15, fontWeight: '800' as const, color: '#FFF' },

    // Route section (reference-image design)
    driverTripRouteSection: {
        flexDirection: 'row' as const,
        alignItems: 'stretch' as const,
        paddingHorizontal: 16,
        paddingVertical: 12,
        gap: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#F1F5F9',
    },
    driverTripRouteDotCol: { alignItems: 'center' as const, width: 12 },
    driverTripRouteTextCol: { flex: 1, justifyContent: 'space-between' as const },

    // Dark stats cards
    driverTripStatsDark: {
        flexDirection: 'row' as const,
        gap: 8,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#F1F5F9',
    },
    driverTripStatDark: {
        flex: 1,
        backgroundColor: '#1E293B',
        borderRadius: 12,
        paddingVertical: 10,
        paddingHorizontal: 6,
        alignItems: 'center' as const,
        gap: 3,
    },
    driverTripStatDarkValue: { fontSize: 13, fontWeight: '800' as const, color: '#FFF', textAlign: 'center' as const },
    driverTripStatDarkLabel: { fontSize: 10, color: '#94A3B8', textAlign: 'center' as const },

    // Passengers section
    driverTripPassengersLabel: {
        fontSize: 11,
        fontWeight: '700' as const,
        color: '#94A3B8',
        textTransform: 'uppercase' as const,
        letterSpacing: 0.6,
        paddingHorizontal: 16,
        paddingTop: 10,
        paddingBottom: 4,
    },
    driverTripPassengerInfo: { flex: 1 },
    driverTripPassengerDrop: { fontSize: 11, color: '#94A3B8', marginTop: 1 },

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

    // Booked trip panel (passenger "Viaje seleccionado")
    bookedTripContent: { padding: 16, gap: 12 },
    bookedDriverCard: {
        flexDirection: 'row', alignItems: 'center', gap: 12,
        backgroundColor: '#F8FAFC', borderRadius: 16, padding: 14,
        borderWidth: 1, borderColor: '#E2E8F0',
    },
    bookedDriverAvatar: {
        width: 44, height: 44, borderRadius: 22,
        backgroundColor: '#0F172A', justifyContent: 'center', alignItems: 'center',
    },
    bookedDriverAvatarText: { color: '#38BDF8', fontSize: 17, fontWeight: '800' },
    bookedDriverName: { fontSize: 15, fontWeight: '700', color: '#0F172A' },
    bookedVehicleText: { fontSize: 11, color: '#94A3B8', marginTop: 2 },
    bookedStatusBadge: {
        flexDirection: 'row', alignItems: 'center', gap: 4,
        paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20,
    },
    bookedStatusText: { fontSize: 11, fontWeight: '700' },
    bookedTimeRow: {
        flexDirection: 'row', alignItems: 'center', gap: 8,
        paddingHorizontal: 4,
    },
    bookedTimeText: { fontSize: 13, color: '#64748B', fontWeight: '600' },
    noShowCountdownRow: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: 6,
        backgroundColor: '#FEF2F2',
        borderRadius: 10,
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderWidth: 1,
        borderColor: '#FECACA',
    },
    noShowCountdownText: {
        flex: 1,
        fontSize: 12,
        fontWeight: '700' as const,
        color: '#DC2626',
        lineHeight: 16,
    },
    bookedBoardBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
        backgroundColor: '#8B5CF6', paddingVertical: 14, borderRadius: 14,
        shadowColor: '#8B5CF6', shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
    },
    bookedBoardBtnText: { color: '#FFF', fontSize: 15, fontWeight: '800' },

    // Waiting boarding message
    waitingBoardingRow: {
        flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 8,
        backgroundColor: '#FFFBEB', borderRadius: 12,
        paddingVertical: 10, paddingHorizontal: 14,
        marginHorizontal: 16, marginTop: 6,
        borderWidth: 1, borderColor: '#FDE68A',
    },
    waitingBoardingText: { flex: 1, fontSize: 12, color: '#92400E', fontWeight: '600' as const, lineHeight: 17 },
});

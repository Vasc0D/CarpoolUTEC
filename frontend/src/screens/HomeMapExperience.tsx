/**
 * Shared map experience used by passenger and driver home screens.
 *
 * Phase 4 changes:
 * - All data fetching replaced with React Query hooks (useAvailableTrips,
 *   useStopsCoverage, useActiveDriverTrip, useMyActiveBooking).
 * - Socket event handlers use queryClient.invalidateQueries instead of
 *   manually calling fetch functions via stable refs.
 * - TripSheet and DriverTripPanel extracted to separate component files.
 * - Types updated to the new plan-based API shape (no legacy routePolyline,
 *   legDurationsSeconds, passengerWaypoints, etc.).
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Animated, Dimensions, ScrollView,
  FlatList, Alert, Linking,
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
import type { TripMarker, ActiveBooking } from '../api/tripsApi';
import {
  useAvailableTrips,
  useStopsCoverage,
  useActiveDriverTrip,
  useMyActiveBooking,
  useHomeInvalidators,
  useCreateBooking,
  useAcceptBooking,
  useRejectBooking,
  useCancelBooking,
  useConfirmBoarding,
  useCancelTrip,
  useStartTrip,
  useFinishTrip,
} from '../hooks/useHomeQueries';
import { TripSheet } from './components/TripSheet';
import { DriverTripPanel } from './components/DriverTripPanel';

const GOOGLE_MAPS_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY || 'DUMMY_KEY';
const { height } = Dimensions.get('window');

// ─── Popular stops (also used in useStopsCoverage hook) ──────────────────────

const POPULAR_STOPS = [
  { id: 'jockey',      name: 'Jockey Plaza',            lat: -12.0869, lng: -76.9750 },
  { id: 'rambla',      name: 'La Rambla San Borja',      lat: -12.0956, lng: -76.9997 },
  { id: 'arequipa_jp', name: 'Arequipa con Javier Prado', lat: -12.0887, lng: -77.0283 },
  { id: 'san_luis',    name: 'San Luis',                 lat: -12.0750, lng: -76.9820 },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const formatTime = (iso: string): string => {
  try {
    return new Date(iso).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
};

const formatETA = (departureTime: string, durationSeconds?: number): string => {
  if (!durationSeconds) return '';
  const eta = new Date(new Date(departureTime).getTime() + durationSeconds * 1000);
  return eta.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
};

const bookingStatusUi = (status?: ActiveBooking['status']) => {
  switch (status) {
    case 'ACCEPTED':
      return { label: 'Confirmado', icon: 'checkmark-circle-outline' as const, bg: '#DCFCE7', color: '#10B981' };
    case 'PENDING_ROUTE_RECALC':
      return { label: 'Calculando ruta', icon: 'sync-outline' as const, bg: '#DBEAFE', color: '#2563EB' };
    case 'ROUTE_RECALC_FAILED':
      return { label: 'Ruta fallida', icon: 'alert-circle-outline' as const, bg: '#FEE2E2', color: '#DC2626' };
    default:
      return { label: 'Pendiente', icon: 'time-outline' as const, bg: '#FEF3C7', color: '#F59E0B' };
  }
};

/** Decode a Google-encoded polyline into MapView-compatible coordinates. */
const decodePolyline = (encoded: string): { latitude: number; longitude: number }[] => {
  const coords: { latitude: number; longitude: number }[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let b: number;
    let shift = 0;
    let result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    coords.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return coords;
};

// ─── Main screen ─────────────────────────────────────────────────────────────

export const HomeMapExperience = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { appMode, setAppMode, isDriver, token, user } = useAuthStore();
  const socketRef = useRef<Socket | null>(null);
  const mapRef = useRef<MapView>(null);

  // ── Location ───────────────────────────────────────────────────────────────
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { setLocationError('El permiso de ubicación fue denegado'); return; }
      setLocation(await Location.getCurrentPositionAsync({}));
    })();
  }, []);

  // ── Destination state ──────────────────────────────────────────────────────
  const [destLat, setDestLat] = useState<number | null>(null);
  const [destLng, setDestLng] = useState<number | null>(null);
  const destInputRef = useRef<any>(null);

  // ── React Query hooks ──────────────────────────────────────────────────────
  const invalidators = useHomeInvalidators();
  const createBookingMutation = useCreateBooking();
  const acceptBookingMutation = useAcceptBooking();
  const rejectBookingMutation = useRejectBooking();
  const cancelBookingMutation = useCancelBooking();
  const confirmBoardingMutation = useConfirmBoarding();
  const cancelTripMutation = useCancelTrip();
  const startTripMutation = useStartTrip();
  const finishTripMutation = useFinishTrip();

  const { data: trips = [], isFetching: loadingTrips, refetch: refetchTrips } = useAvailableTrips(
    appMode,
    location?.coords.latitude ?? null,
    location?.coords.longitude ?? null,
    destLat,
    destLng,
  );

  const { data: coveredStops = [] } = useStopsCoverage(appMode);
  const { data: activeDriverTrip = null, refetch: refetchDriverTrip } = useActiveDriverTrip(appMode, isDriver);
  const { data: myActiveBooking = null, refetch: refetchMyBooking } = useMyActiveBooking(appMode);

  // ── Booking-specific UI state ──────────────────────────────────────────────
  const [selectedTrip, setSelectedTrip] = useState<TripMarker | null>(null);
  const [bookingTripId, setBookingTripId] = useState<string | null>(null);
  const [bookedTripId, setBookedTripId] = useState<string | null>(null);
  const [cancelingBooking, setCancelingBooking] = useState(false);
  const [confirmingBoarding, setConfirmingBoarding] = useState(false);
  const [boardedTripId, setBoardedTripId] = useState<string | null>(null);
  const [noShowCountdown, setNoShowCountdown] = useState<number | null>(null);

  // ── Driver-specific UI state ───────────────────────────────────────────────
  const [cancelingDriverTrip, setCancelingDriverTrip] = useState(false);
  const [startingDriverTrip, setStartingDriverTrip] = useState(false);
  const [finishingDriverTrip, setFinishingDriverTrip] = useState(false);
  const [tick, setTick] = useState(0);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // ── Preview (route-to-dropoff) state ──────────────────────────────────────
  const [previewTrip, setPreviewTrip] = useState<TripMarker | null>(null);
  const [dropoffPoint, setDropoffPoint] = useState<{ latitude: number; longitude: number } | null>(null);
  const [routeToDropoff, setRouteToDropoff] = useState<{ latitude: number; longitude: number }[]>([]);

  // ── Reverse geocoding cache ────────────────────────────────────────────────
  const [geocodedAddresses, setGeocodedAddresses] = useState<Record<string, string>>({});
  const geocodedKeysRef = useRef<Set<string>>(new Set());

  const reverseGeocode = useCallback(async (lat: number, lng: number) => {
    const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    if (geocodedKeysRef.current.has(key)) return;
    geocodedKeysRef.current.add(key);
    try {
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_MAPS_KEY}&language=es`,
      );
      const json = await res.json();
      if (json.results?.length) {
        const comps: any[] = json.results[0].address_components ?? [];
        const route = comps.find((c: any) => c.types.includes('route'));
        const num   = comps.find((c: any) => c.types.includes('street_number'));
        const address = route
          ? `${route.long_name}${num ? ' ' + num.short_name : ''}`
          : json.results[0].formatted_address.split(',')[0];
        setGeocodedAddresses(prev => ({ ...prev, [key]: address }));
      }
    } catch {
      geocodedKeysRef.current.delete(key);
    }
  }, []);

  // ── Ticker (15 s) — for time-based button conditions ──────────────────────
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

  // ── No-show 1-second countdown ─────────────────────────────────────────────
  useEffect(() => {
    if (
      appMode !== 'passenger' ||
      !myActiveBooking?.departureTime ||
      myActiveBooking.status !== 'ACCEPTED'
    ) {
      setNoShowCountdown(null);
      return;
    }
    const departureMs = new Date(myActiveBooking.departureTime).getTime();
    const deadlineMs  = departureMs + 5 * 60 * 1000;
    const update = () => {
      const remaining = Math.ceil((deadlineMs - Date.now()) / 1000);
      setNoShowCountdown(remaining > 0 && Date.now() >= departureMs ? remaining : null);
    };
    update();
    const id = setInterval(update, 1_000);
    return () => { clearInterval(id); setNoShowCountdown(null); };
  }, [appMode, myActiveBooking?.id, myActiveBooking?.status, myActiveBooking?.departureTime]);

  // ── Pulse animation ────────────────────────────────────────────────────────
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.3, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1,   duration: 800, useNativeDriver: true }),
      ]),
    ).start();
  }, [pulseAnim]);

  // ── Refetch on screen focus (replaces useFocusEffect manual calls) ─────────
  useFocusEffect(
    useCallback(() => {
      if (appMode === 'driver' && isDriver) refetchDriverTrip();
      if (appMode === 'passenger') refetchMyBooking();
      setTick(t => t + 1);
    }, [appMode, isDriver, refetchDriverTrip, refetchMyBooking]),
  );

  // ── Reverse-geocode driver panel drop-off addresses ────────────────────────
  useEffect(() => {
    if (!activeDriverTrip?.currentRoutePlan?.legs?.length) return;
    const sorted = [...activeDriverTrip.currentRoutePlan.legs].sort(
      (a, b) => a.legIndex - b.legIndex,
    );
    // Final destination
    const last = sorted[sorted.length - 1];
    reverseGeocode(Number(last.endLat), Number(last.endLng));
    // Drop-off points
    for (const leg of sorted) {
      if (leg.passengerDropOffId) {
        reverseGeocode(Number(leg.endLat), Number(leg.endLng));
      }
    }
    // Passenger dest markers
    for (const b of activeDriverTrip.bookings) {
      if (b.destLat != null && b.destLng != null) {
        reverseGeocode(Number(b.destLat), Number(b.destLng));
      }
    }
  }, [activeDriverTrip?.id, activeDriverTrip?.currentRoutePlan?.legs?.length, reverseGeocode]);

  // ── Map fit — driver route polyline ───────────────────────────────────────
  useEffect(() => {
    if (appMode !== 'driver' || !activeDriverTrip?.currentRoutePlan?.encodedPolyline) return;
    const coords = decodePolyline(activeDriverTrip.currentRoutePlan.encodedPolyline);
    const fitTimer = setTimeout(() => {
      mapRef.current?.fitToCoordinates(coords, {
        edgePadding: { top: 80, right: 40, bottom: 380, left: 40 },
        animated: true,
      });
    }, 500);
    return () => clearTimeout(fitTimer);
  }, [activeDriverTrip?.id, appMode]);

  // ── Restore route-to-dropoff on booking restore ────────────────────────────
  useEffect(() => {
    if (
      !myActiveBooking?.tripId ||
      myActiveBooking.destLat == null ||
      myActiveBooking.destLng == null ||
      routeToDropoff.length > 0
    ) return;
    axiosClient
      .get(`/trips/${myActiveBooking.tripId}/closest-point`, {
        params: { destLat: myActiveBooking.destLat, destLng: myActiveBooking.destLng },
      })
      .then(({ data }) => {
        setDropoffPoint({ latitude: data.latitude, longitude: data.longitude });
        setRouteToDropoff(data.routeToDropoff ?? []);
      })
      .catch(() => {});
  }, [myActiveBooking?.id]);

  // ── Driver socket ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (appMode !== 'driver' || !token) return;
    const socket = createSocket(token);
    socketRef.current = socket;
    socket.connect();

    socket.on(
      'new_booking_request',
      (data: { passengerName: string; tripId: string; autoAccepted: boolean }) => {
        Alert.alert(
          data.autoAccepted ? '¡Nuevo pasajero!' : '¡Nueva solicitud!',
          data.autoAccepted
            ? `${data.passengerName} se unió a tu viaje automáticamente.`
            : `${data.passengerName} quiere unirse a tu viaje.`,
        );
        invalidators.invalidateDriverTrip();
      },
    );

    socket.on(
      'booking_canceled',
      (data: { bookingId: string; tripId: string; passengerName: string }) => {
        Alert.alert('Pasajero canceló', `${data.passengerName} canceló su reserva.`);
        invalidators.invalidateDriverTrip();
      },
    );

    socket.on('route_updated', () => invalidators.invalidateDriverTrip());

    socket.on('trip_auto_canceled', () => {
      Alert.alert(
        'Viaje cancelado automáticamente',
        'Tu viaje fue cancelado porque no tenía pasajeros confirmados al llegar la hora de salida.',
      );
      invalidators.invalidateDriverTrip();
    });

    socket.on('passengerBoarded', () => invalidators.invalidateDriverTrip());

    socket.on('trip_boarding', () => invalidators.invalidateDriverTrip());

    return () => { socket.disconnect(); socketRef.current = null; };
  }, [appMode, token]);

  // ── Passenger socket ───────────────────────────────────────────────────────
  useEffect(() => {
    if (appMode !== 'passenger' || !token) return;
    const socket = createSocket(token);
    socketRef.current = socket;
    socket.connect();

    socket.on(
      'booking_status_changed',
      (data: { bookingId: string; status: 'PENDING_ROUTE_RECALC' | 'ACCEPTED' | 'REJECTED' | 'ROUTE_RECALC_FAILED' }) => {
        if (data.status === 'ACCEPTED') {
          Alert.alert('¡Reserva aceptada!', 'El conductor te confirmó el viaje.');
          invalidators.invalidateMyBooking();
        } else if (data.status === 'PENDING_ROUTE_RECALC') {
          invalidators.invalidateMyBooking();
        } else if (data.status === 'ROUTE_RECALC_FAILED') {
          Alert.alert('No pudimos calcular la ruta', 'Intenta nuevamente o elige otro viaje.');
          invalidators.invalidateMyBooking();
        } else {
          Alert.alert(
            'Reserva rechazada',
            'El conductor no pudo aceptarte. Puedes buscar otro viaje.',
          );
          invalidators.invalidateMyBooking();
        }
      },
    );

    socket.on('trip_canceled', (data: { tripId: string }) => {
      Alert.alert('Viaje cancelado', 'El conductor canceló el viaje. Puedes buscar otra opción.');
      invalidators.invalidateMyBooking();
      invalidators.invalidateAvailableTrips();
    });

    socket.on('trip_boarding', () => {
      invalidators.invalidateMyBooking();
    });

    socket.on('trip_started', (data: { tripId: string }) => {
      Alert.alert(
        '¡Tu viaje comenzó!',
        'El conductor ya está en camino.',
        [
          {
            text: 'Ver viaje',
            onPress: () => navigation.navigate('ActiveTrip', { tripId: data.tripId }),
          },
        ],
      );
    });

    socket.on('trip_published', () => {
      invalidators.invalidateStopsCoverage();
      invalidators.invalidateAvailableTrips();
    });

    socket.on('noShowUpdated', (data: { bookingId: string }) => {
      setDropoffPoint(null);
      setRouteToDropoff([]);
      invalidators.invalidateMyBooking();
      Alert.alert(
        'Reserva cancelada',
        'No confirmaste tu subida al auto a tiempo. Tu reserva fue cancelada automáticamente.',
      );
    });

    socket.on('route_updated', () => invalidators.invalidateMyBooking());

    socket.on(
      'booking_route_failed',
      (data: { bookingId: string; tripId: string; reason: string }) => {
        setDropoffPoint(null);
        setRouteToDropoff([]);
        invalidators.invalidateMyBooking();
        Alert.alert(
          'No pudimos calcular la ruta',
          'Tuvimos problemas para incluir tu parada en este viaje. Intenta nuevamente en unos minutos o elige otro viaje.',
        );
      },
    );

    return () => { socket.disconnect(); socketRef.current = null; };
  }, [appMode, token]);

  // ── Book seat ──────────────────────────────────────────────────────────────
  const handleBookSeat = async (tripId: string) => {
    setBookingTripId(tripId);
    try {
      await createBookingMutation.mutateAsync({
        tripId,
        destLat: destLat ?? undefined,
        destLng: destLng ?? undefined,
      });
      setBookedTripId(tripId);
    } catch (error: any) {
      const msg = error.response?.data?.message || 'No se pudo solicitar el asiento. Intenta de nuevo.';
      Alert.alert('Error', Array.isArray(msg) ? msg.join('\n') : msg);
    } finally {
      setBookingTripId(null);
    }
  };

  // ── Confirm boarding ───────────────────────────────────────────────────────
  const handleConfirmBoarding = async () => {
    if (!myActiveBooking) return;
    setConfirmingBoarding(true);
    try {
      await confirmBoardingMutation.mutateAsync(myActiveBooking.id);
      setBoardedTripId(myActiveBooking.tripId);
      Alert.alert('¡Confirmado!', 'Se registró tu subida al vehículo.');
    } catch (error: any) {
      const msg = error.response?.data?.message || 'No se pudo confirmar la subida.';
      Alert.alert('Error', Array.isArray(msg) ? msg.join('\n') : msg);
    } finally {
      setConfirmingBoarding(false);
    }
  };

  // ── Cancel booking ─────────────────────────────────────────────────────────
  const handleCancelBooking = async (bookingId: string) => {
    setCancelingBooking(true);
    try {
      await cancelBookingMutation.mutateAsync(bookingId);
      setDropoffPoint(null);
      setRouteToDropoff([]);
      invalidators.invalidateMyBooking();
      invalidators.invalidateAvailableTrips();
    } catch (error: any) {
      const msg = error.response?.data?.message || 'No se pudo cancelar la reserva.';
      Alert.alert('Error', Array.isArray(msg) ? msg.join('\n') : msg);
    } finally {
      setCancelingBooking(false);
    }
  };

  // ── Driver: cancel trip ────────────────────────────────────────────────────
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
              await cancelTripMutation.mutateAsync(tripId);
            } catch (error: any) {
              const msg = error.response?.data?.message || 'No se pudo cancelar el viaje.';
              Alert.alert('Error', Array.isArray(msg) ? msg.join('\n') : msg);
            } finally {
              setCancelingDriverTrip(false);
            }
          },
        },
      ],
    );
  };

  // ── Driver: accept/reject booking ──────────────────────────────────────────
  const handleAcceptBooking = async (bookingId: string) => {
    try {
      await acceptBookingMutation.mutateAsync(bookingId);
    } catch (error: any) {
      const msg = error.response?.data?.message || 'No se pudo aceptar la solicitud.';
      Alert.alert('Error', Array.isArray(msg) ? msg.join('\n') : msg);
    }
  };

  const handleRejectBooking = async (bookingId: string) => {
    try {
      await rejectBookingMutation.mutateAsync(bookingId);
    } catch (error: any) {
      const msg = error.response?.data?.message || 'No se pudo rechazar la solicitud.';
      Alert.alert('Error', Array.isArray(msg) ? msg.join('\n') : msg);
    }
  };

  // ── Driver: start trip ─────────────────────────────────────────────────────
  const handleStartDriverTrip = async () => {
    if (!activeDriverTrip) return;
    setStartingDriverTrip(true);
    try {
      await startTripMutation.mutateAsync(activeDriverTrip.id);

      // Derive final destination + waypoints from plan legs
      const plan = activeDriverTrip.currentRoutePlan;
      if (plan?.legs?.length) {
        const sorted = [...plan.legs].sort((a, b) => a.legIndex - b.legIndex);
        const lastLeg = sorted[sorted.length - 1];
        const finalLat = Number(lastLeg.endLat);
        const finalLng = Number(lastLeg.endLng);
        const stops = sorted
          .filter(l => l.passengerDropOffId !== null)
          .map(l => ({ lat: Number(l.endLat), lng: Number(l.endLng) }));

        const allDests = [
          ...stops.map(w => `${w.lat},${w.lng}`),
          `${finalLat},${finalLng}`,
        ].join('+to:');
        const googleNative = `comgooglemaps://?daddr=${allDests}&directionsmode=driving`;
        const waypointStr = stops.map(w => `${w.lat},${w.lng}`).join('|');
        const googleWeb =
          stops.length > 0
            ? `https://www.google.com/maps/dir/?api=1&destination=${finalLat},${finalLng}&waypoints=${encodeURIComponent(waypointStr)}&travelmode=driving`
            : `https://www.google.com/maps/dir/?api=1&destination=${finalLat},${finalLng}&travelmode=driving`;
        const wazeUrl = `waze://?ll=${finalLat},${finalLng}&navigate=yes`;

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

  // ── Driver: finish trip ────────────────────────────────────────────────────
  const handleFinishDriverTrip = () => {
    Alert.alert('Finalizar viaje', '¿Confirmas que has llegado al destino?', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Sí, finalizar',
        onPress: async () => {
          if (!activeDriverTrip) return;
          setFinishingDriverTrip(true);
          try {
            await finishTripMutation.mutateAsync(activeDriverTrip.id);
          } catch (error: any) {
            const msg = error.response?.data?.message || 'No se pudo finalizar el viaje.';
            Alert.alert('Error', Array.isArray(msg) ? msg.join('\n') : msg);
          } finally {
            setFinishingDriverTrip(false);
          }
        },
      },
    ]);
  };

  // ── Preview route to drop-off ──────────────────────────────────────────────
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
      } catch {}
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

  const toggleAppMode = (mode: 'driver' | 'passenger') => {
    setAppMode(mode);
  };

  // ── Driver route polyline for map (decoded on each render, cheap) ──────────
  const driverRouteCoords =
    appMode === 'driver' && activeDriverTrip?.currentRoutePlan?.encodedPolyline
      ? decodePolyline(activeDriverTrip.currentRoutePlan.encodedPolyline)
      : [];
  const myBookingStatusUi = bookingStatusUi(myActiveBooking?.status);

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      {/* Map */}
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
            {/* Popular stop markers */}
            {appMode === 'passenger' &&
              POPULAR_STOPS.filter(s => coveredStops.includes(s.id)).map(stop => (
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
              ))}

            {/* Route-to-dropoff polyline + marker */}
            {routeToDropoff.length > 0 && (
              <Polyline coordinates={routeToDropoff} strokeColor="#0EA5E9" strokeWidth={5} />
            )}
            {dropoffPoint && (
              <Marker coordinate={dropoffPoint} anchor={{ x: 0.5, y: 0.5 }}>
                <View style={styles.dropoffMarker}>
                  <Ionicons name="location" size={14} color="#FFF" />
                  <Text style={styles.dropoffMarkerText}>Te bajan aquí</Text>
                </View>
              </Marker>
            )}

            {/* Driver route polyline */}
            {driverRouteCoords.length > 0 && (
              <Polyline coordinates={driverRouteCoords} strokeColor="#10B981" strokeWidth={4} />
            )}
          </MapView>
        ) : (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#0EA5E9" />
            <Text style={styles.loadingText}>{locationError || 'Cargando mapa...'}</Text>
          </View>
        )}
      </View>

      {/* Mode toggle + avatar */}
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

      {/* Passenger: destination search */}
      {appMode === 'passenger' && (
        <View style={[styles.passengerBar, { top: insets.top + 80 }]}>
          <View style={styles.destSearchContainer}>
            <GooglePlacesAutocomplete
              ref={destInputRef}
              placeholder="¿A dónde vas?"
              onPress={(_data, details = null) => {
                if (myActiveBooking) return;
                if (details) {
                  const lat = details.geometry.location.lat;
                  const lng = details.geometry.location.lng;
                  setDestLat(lat);
                  setDestLng(lng);
                }
              }}
              query={{ key: GOOGLE_MAPS_KEY, language: 'es', components: 'country:pe' }}
              fetchDetails
              textInputProps={{
                editable: !myActiveBooking,
                selectTextOnFocus: !myActiveBooking,
              }}
              styles={{
                textInput: [styles.destInput, myActiveBooking ? styles.destInputLocked : undefined],
                listView: {
                  position: 'absolute', top: 48, zIndex: 100,
                  borderRadius: 12, backgroundColor: '#FFF', elevation: 8,
                },
              }}
              keyboardShouldPersistTaps="handled"
            />
            {destLat !== null && !myActiveBooking && (
              <TouchableOpacity style={styles.destClearBtn} onPress={handleClearDest}>
                <Ionicons name="close-circle" size={20} color="#64748B" />
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {/* Passenger: bottom panel */}
      {appMode === 'passenger' && (
        <View style={styles.bottomPanel}>
          <View style={styles.panelHeader}>
            <View>
              <Text style={styles.panelTitle}>
                {myActiveBooking
                  ? 'Viaje seleccionado'
                  : destLat !== null
                  ? 'Resultados para destino'
                  : 'Viajes disponibles'}
              </Text>
              {!myActiveBooking && !loadingTrips && destLat !== null && (
                <Text style={styles.panelSubtitle}>
                  {trips.length} viaje{trips.length !== 1 ? 's' : ''} encontrado
                  {trips.length !== 1 ? 's' : ''}
                </Text>
              )}
            </View>
          </View>

          {myActiveBooking ? (
            /* ── Active booking card ───────────────────────────────────────── */
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.bookedTripContent}
            >
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
                <View
                  style={[
                    styles.bookedStatusBadge,
                    {
                      backgroundColor: myBookingStatusUi.bg,
                    },
                  ]}
                >
                  <Ionicons
                    name={myBookingStatusUi.icon}
                    size={13}
                    color={myBookingStatusUi.color}
                  />
                  <Text
                    style={[
                      styles.bookedStatusText,
                      {
                        color: myBookingStatusUi.color,
                      },
                    ]}
                  >
                    {myBookingStatusUi.label}
                  </Text>
                </View>
              </View>

              {myActiveBooking.departureTime && (
                <View style={styles.bookedTimeRow}>
                  <Ionicons name="time-outline" size={15} color="#64748B" />
                  <Text style={styles.bookedTimeText}>
                    Salida: {formatTime(myActiveBooking.departureTime)}
                  </Text>
                </View>
              )}
              {myActiveBooking.departureTime && myActiveBooking.passengerEtaSeconds ? (
                <View style={styles.bookedTimeRow}>
                  <Ionicons name="flag-outline" size={15} color="#10B981" />
                  <Text style={[styles.bookedTimeText, { color: '#10B981' }]}>
                    Tu parada:{' '}
                    {formatETA(myActiveBooking.departureTime, myActiveBooking.passengerEtaSeconds)}
                  </Text>
                </View>
              ) : null}

              {myActiveBooking.status === 'ACCEPTED' &&
                (myActiveBooking.tripStatus === 'BOARDING' || myActiveBooking.tripStatus === 'ACTIVE') &&
                boardedTripId !== myActiveBooking.tripId && (
                  <View style={{ gap: 8 }}>
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
                      {confirmingBoarding ? (
                        <ActivityIndicator color="#FFF" />
                      ) : (
                        <>
                          <Ionicons name="car-outline" size={18} color="#FFF" />
                          <Text style={styles.bookedBoardBtnText}>Confirmar subida al auto</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                )}

              <TouchableOpacity
                style={styles.cancelBookingBtn}
                onPress={() => handleCancelBooking(myActiveBooking.id)}
                disabled={cancelingBooking}
                activeOpacity={0.75}
              >
                {cancelingBooking ? (
                  <ActivityIndicator size="small" color="#EF4444" />
                ) : (
                  <>
                    <Ionicons name="close-circle-outline" size={16} color="#EF4444" />
                    <Text style={styles.cancelBookingBtnText}>Cancelar reserva</Text>
                  </>
                )}
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
                <TouchableOpacity onPress={() => refetchTrips()} style={styles.retryBtn}>
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
                const plan = trip.currentRoutePlan;
                return (
                  <TouchableOpacity
                    style={[styles.tripCard, isMyBooked && styles.tripCardBooked]}
                    onPress={() => { setBookedTripId(null); setSelectedTrip(trip); }}
                    activeOpacity={0.85}
                  >
                    <View style={styles.tripCardHeader}>
                      <View style={styles.tripCardAvatar}>
                        <Text style={styles.tripCardAvatarText}>
                          {trip.driver?.name?.[0]?.toUpperCase() ?? '?'}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.tripCardDriverName} numberOfLines={1}>
                          {trip.driver?.name || 'Sin conductor'}
                        </Text>
                        {trip.driver?.vehicle && (
                          <Text style={styles.tripCardVehicle} numberOfLines={1}>
                            {trip.driver.vehicle.brand} · {trip.driver.vehicle.model} · {trip.driver.vehicle.color}
                          </Text>
                        )}
                      </View>
                      {trip.matchType && (
                        <View
                          style={[
                            styles.tripCardBadge,
                            {
                              backgroundColor:
                                trip.matchType === 'exact'
                                  ? '#DCFCE7'
                                  : trip.matchType === 'detour'
                                  ? '#FFF7ED'
                                  : '#FEF9C3',
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.tripCardBadgeText,
                              {
                                color:
                                  trip.matchType === 'exact'
                                    ? '#10B981'
                                    : trip.matchType === 'detour'
                                    ? '#F97316'
                                    : '#F59E0B',
                              },
                            ]}
                          >
                            {trip.matchType === 'exact'
                              ? 'Te deja ahí'
                              : trip.matchType === 'detour'
                              ? `Se desvía ~${trip.detourMinutes}min`
                              : 'Pasa cerca'}
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
                      {plan?.totalDurationSeconds ? (
                        <View style={styles.tripCardInfoItem}>
                          <Ionicons name="flag-outline" size={13} color="#10B981" />
                          <Text style={[styles.tripCardInfoText, { color: '#10B981' }]}>
                            ~{formatETA(trip.departureTime, plan.totalDurationSeconds)}
                          </Text>
                        </View>
                      ) : null}
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
                        onPress={() =>
                          previewTrip?.id === trip.id
                            ? handleClearPreview()
                            : handlePreviewRoute(trip)
                        }
                      >
                        <Ionicons
                          name="map-outline"
                          size={13}
                          color={previewTrip?.id === trip.id ? '#FFF' : '#0EA5E9'}
                        />
                        <Text
                          style={[
                            styles.tripCardRouteBtnText,
                            previewTrip?.id === trip.id && styles.tripCardRouteBtnTextActive,
                          ]}
                        >
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
                          {confirmingBoarding ? (
                            <ActivityIndicator size="small" color="#FFF" />
                          ) : (
                            <Text style={styles.tripCardBookBtnText}>Confirmar subida</Text>
                          )}
                        </TouchableOpacity>
                      ) : (
                        <TouchableOpacity
                          style={[
                            styles.tripCardBookBtn,
                            (trip.availableSeats === 0 || (!!myActiveBooking && !isMyBooked)) &&
                              styles.tripCardBookBtnDisabled,
                            isMyBooked && styles.tripCardBookBtnBooked,
                          ]}
                          onPress={() => handleBookSeat(trip.id)}
                          disabled={isBusy || trip.availableSeats === 0 || !!myActiveBooking}
                        >
                          {isBusy ? (
                            <ActivityIndicator size="small" color="#FFF" />
                          ) : (
                            <Text style={styles.tripCardBookBtnText}>
                              {trip.availableSeats === 0
                                ? 'Lleno'
                                : isMyBooked
                                ? 'Reservado'
                                : 'Solicitar'}
                            </Text>
                          )}
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

      {/* Driver: panel */}
      {appMode === 'driver' && (
        <>
          {isDriver && activeDriverTrip ? (
            <DriverTripPanel
              trip={activeDriverTrip}
              tick={tick}
              geocodedAddresses={geocodedAddresses}
              startingTrip={startingDriverTrip}
              finishingTrip={finishingDriverTrip}
              cancelingTrip={cancelingDriverTrip}
              onAccept={handleAcceptBooking}
              onReject={handleRejectBooking}
              onStart={handleStartDriverTrip}
              onFinish={handleFinishDriverTrip}
              onCancel={() => handleCancelDriverTrip(activeDriverTrip.id)}
            />
          ) : (
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

      {/* Trip detail sheet */}
      <TripSheet
        trip={selectedTrip}
        onClose={() => { setSelectedTrip(null); setBookedTripId(null); }}
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
  loadingContainer: {
    flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, backgroundColor: '#F8FAFC',
  },
  loadingText: { fontSize: 14, color: '#64748B' },

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
    width: 48, height: 48, borderRadius: 24, backgroundColor: '#0F172A',
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2, shadowRadius: 6, elevation: 6,
  },
  avatarBtnText: { color: '#38BDF8', fontSize: 18, fontWeight: '900' },

  // Destination search
  passengerBar: { position: 'absolute', width: '100%', paddingHorizontal: 20, zIndex: 10 },
  destSearchContainer: { position: 'relative', zIndex: 20 },
  destInput: {
    height: 44, borderRadius: 22, backgroundColor: '#FFF', paddingHorizontal: 16,
    fontSize: 14, color: '#0F172A',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1, shadowRadius: 6, elevation: 4,
  },
  destInputLocked: { color: '#94A3B8', backgroundColor: '#F8FAFC' },
  destClearBtn: { position: 'absolute', right: 12, top: 12, zIndex: 21 },

  // Bottom panel (passenger)
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
  inviteSubtitle: {
    fontSize: 13, color: '#94A3B8', textAlign: 'center', lineHeight: 20, paddingHorizontal: 24,
  },
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 8, paddingHorizontal: 16,
    borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0',
  },
  retryBtnText: { fontSize: 12, color: '#64748B' },
  tripListContent: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24 },

  // Booked trip card (passenger active booking)
  bookedTripContent: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24, gap: 10 },
  bookedDriverCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#F8FAFC', borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: '#E2E8F0',
  },
  bookedDriverAvatar: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#0F172A',
    justifyContent: 'center', alignItems: 'center',
  },
  bookedDriverAvatarText: { color: '#38BDF8', fontSize: 16, fontWeight: '900' },
  bookedDriverName: { fontSize: 15, fontWeight: '700', color: '#0F172A' },
  bookedVehicleText: { fontSize: 11, color: '#64748B', marginTop: 2 },
  bookedStatusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10,
  },
  bookedStatusText: { fontSize: 11, fontWeight: '600' },
  bookedTimeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bookedTimeText: { fontSize: 13, color: '#475569', fontWeight: '500' },
  noShowCountdownRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FEF2F2', borderRadius: 8, padding: 8,
  },
  noShowCountdownText: { flex: 1, fontSize: 12, color: '#DC2626', fontWeight: '600' },
  bookedBoardBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#10B981', paddingVertical: 13, borderRadius: 13,
  },
  bookedBoardBtnText: { color: '#FFF', fontSize: 15, fontWeight: '700' },
  cancelBookingBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 10, borderRadius: 10,
    borderWidth: 1, borderColor: '#FECACA', backgroundColor: '#FEF2F2',
  },
  cancelBookingBtnText: { fontSize: 14, color: '#EF4444', fontWeight: '600' },

  // Trip list cards
  tripCard: {
    backgroundColor: '#FFF', borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: '#E2E8F0',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 6, elevation: 3,
  },
  tripCardBooked: { borderColor: '#BAE6FD', backgroundColor: '#F0F9FF' },
  tripCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  tripCardAvatar: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: '#0F172A',
    justifyContent: 'center', alignItems: 'center',
  },
  tripCardAvatarText: { color: '#38BDF8', fontSize: 14, fontWeight: '900' },
  tripCardDriverName: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  tripCardVehicle: { fontSize: 11, color: '#64748B', marginTop: 1 },
  tripCardBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  tripCardBadgeText: { fontSize: 10, fontWeight: '700' },
  tripCardInfo: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  tripCardInfoItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  tripCardInfoText: { fontSize: 12, color: '#475569' },
  tripCardActions: { flexDirection: 'row', gap: 8 },
  tripCardRouteBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingVertical: 7, paddingHorizontal: 12, borderRadius: 10,
    borderWidth: 1, borderColor: '#BAE6FD', backgroundColor: '#F0F9FF',
  },
  tripCardRouteBtnActive: { backgroundColor: '#0EA5E9', borderColor: '#0EA5E9' },
  tripCardRouteBtnText: { fontSize: 12, color: '#0EA5E9', fontWeight: '600' },
  tripCardRouteBtnTextActive: { color: '#FFF' },
  tripCardBookBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 8, borderRadius: 10, backgroundColor: '#0EA5E9',
  },
  tripCardBoardBtn: { backgroundColor: '#10B981' },
  tripCardBookBtnDisabled: { backgroundColor: '#CBD5E1' },
  tripCardBookBtnBooked: { backgroundColor: '#0284C7' },
  tripCardBookBtnText: { fontSize: 13, color: '#FFF', fontWeight: '700' },

  // Map markers
  stopMarker: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#0EA5E9', paddingHorizontal: 6, paddingVertical: 3,
    borderRadius: 10, borderWidth: 1.5, borderColor: '#FFF',
  },
  stopMarkerText: { fontSize: 10, color: '#FFF', fontWeight: '700', maxWidth: 60 },
  dropoffMarker: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#7C3AED', paddingHorizontal: 7, paddingVertical: 4,
    borderRadius: 10, borderWidth: 1.5, borderColor: '#FFF',
  },
  dropoffMarkerText: { fontSize: 10, color: '#FFF', fontWeight: '700' },

  // Driver: no-trip overlay (FAB)
  bottomOverlay: { position: 'absolute', left: 20, right: 20 },
  fab: {
    backgroundColor: '#0F172A', paddingVertical: 18, borderRadius: 18,
    alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2, shadowRadius: 8, elevation: 8,
  },
  fabText: { color: '#FFF', fontSize: 17, fontWeight: '700' },
});

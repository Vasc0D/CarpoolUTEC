import React, { useState, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, KeyboardAvoidingView, TouchableOpacity, Alert, Dimensions, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import MapViewDirections from 'react-native-maps-directions';
import { GooglePlacesAutocomplete } from 'react-native-google-places-autocomplete';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { axiosClient } from '../api/axiosClient';

const { width, height } = Dimensions.get('window');

const UTEC_COORDS = { latitude: -12.135, longitude: -77.023 };
const GOOGLE_MAPS_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY || 'DUMMY_KEY';

export const CreateTripScreen = () => {
    const navigation = useNavigation<any>();
    const mapRef = useRef<MapView>(null);
    const insets = useSafeAreaInsets();

    const [destination, setDestination] = useState<any>(null);
    const [routePoints, setRoutePoints] = useState<[number, number][]>([]);
    const [seats, setSeats] = useState(3);
    const [detour, setDetour] = useState(5);
    const [loading, setLoading] = useState(false);
    const [departureTime, setDepartureTime] = useState(new Date());
    const [showTimePicker, setShowTimePicker] = useState(false);
    const [autoAccept, setAutoAccept] = useState(true);

    const handlePublish = async () => {
        if (!destination || routePoints.length < 2) {
            Alert.alert('Error', 'Por favor selecciona un destino válido');
            return;
        }

        setLoading(true);
        try {
            await axiosClient.post('/trips', {
                route: routePoints,
                departureTime: departureTime.toISOString(),
                availableSeats: seats,
                maxDetourMinutes: detour,
                autoAccept,
                meetingPoint: JSON.stringify({ type: 'Point', coordinates: [-77.021908, -12.135570] }),
            });

            Alert.alert('¡Éxito!', 'Tu viaje ha sido publicado correctamente.', [
                { text: 'OK', onPress: () => navigation.goBack() }
            ]);
        } catch (error: any) {
            const msg = error.response?.data?.message || 'No se pudo publicar el viaje. Revisa tu conexión.';
            Alert.alert('Error', Array.isArray(msg) ? msg.join('\n') : msg);
        } finally {
            setLoading(false);
        }
    };

    const onTimeChange = (event: DateTimePickerEvent, selected?: Date) => {
        if (Platform.OS === 'android') setShowTimePicker(false);
        if (event.type === 'set' && selected) setDepartureTime(selected);
    };

    const formatTime = (date: Date) =>
        date.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });

    return (
        <View style={styles.container}>
            {/* Mitad Superior: Mapa */}
            <View style={styles.mapContainer}>
                <MapView
                    ref={mapRef}
                    provider={PROVIDER_DEFAULT}
                    style={StyleSheet.absoluteFillObject}
                    initialRegion={{
                        ...UTEC_COORDS,
                        latitudeDelta: 0.05,
                        longitudeDelta: 0.05,
                    }}
                >
                    <Marker coordinate={UTEC_COORDS} title="Origen (UTEC)" />

                    {destination && (
                        <Marker coordinate={destination} title="Destino">
                            <Ionicons name="location" size={32} color="#EF4444" />
                        </Marker>
                    )}

                    {destination && (
                        <MapViewDirections
                            origin={UTEC_COORDS}
                            destination={destination}
                            apikey={GOOGLE_MAPS_KEY}
                            strokeWidth={4}
                            strokeColor="#3B82F6"
                            onReady={(result) => {
                                const points = result.coordinates.map(c => [c.latitude, c.longitude] as [number, number]);
                                setRoutePoints(points);
                                mapRef.current?.fitToCoordinates(result.coordinates, {
                                    edgePadding: { top: 50, right: 50, bottom: 50, left: 50 },
                                });
                            }}
                        />
                    )}
                </MapView>
            </View>

            {/* Mitad Inferior: Formulario (Card) */}
            <KeyboardAvoidingView
                style={styles.formContainer}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            >
                {/* Autocomplete outside ScrollView to avoid nested VirtualizedList warning */}
                <View style={styles.autocompleteWrapper}>
                    <Text style={styles.label}>¿A dónde vas?</Text>
                    <GooglePlacesAutocomplete
                        placeholder="Buscar destino..."
                        onPress={(_data, details = null) => {
                            if (details) {
                                setDestination({
                                    latitude: details.geometry.location.lat,
                                    longitude: details.geometry.location.lng,
                                });
                            }
                        }}
                        query={{
                            key: GOOGLE_MAPS_KEY,
                            language: 'es',
                        }}
                        fetchDetails={true}
                        styles={{
                            container: {},
                            textInput: styles.searchInput,
                            listView: {
                                position: 'absolute',
                                top: 55,
                                width: '100%',
                                backgroundColor: '#FFF',
                                elevation: 5,
                                zIndex: 1000,
                                borderRadius: 12,
                            },
                        }}
                        keyboardShouldPersistTaps="handled"
                    />
                </View>

                <ScrollView
                    style={{ flex: 1 }}
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={[styles.formContent, { paddingBottom: insets.bottom + 24 }]}
                >
                    {/* Punto de encuentro */}
                    <View style={styles.meetingSection}>
                        <Text style={styles.label}>Punto de encuentro</Text>
                        <Text style={styles.meetingStaticText}>Frente a la salida de carros UTEC</Text>
                    </View>

                    <View style={styles.controlsAndButton}>
                        {/* Hora de salida + Admisión */}
                        <View style={styles.row}>
                            <View style={styles.inputGroup}>
                                <Text style={styles.label}>Hora de salida</Text>
                                <TouchableOpacity
                                    style={styles.timeButton}
                                    onPress={() => setShowTimePicker(true)}
                                >
                                    <Ionicons name="time-outline" size={18} color="#475569" />
                                    <Text style={styles.timeButtonText}>{formatTime(departureTime)}</Text>
                                </TouchableOpacity>
                                {showTimePicker && (
                                    <DateTimePicker
                                        value={departureTime}
                                        mode="time"
                                        is24Hour={true}
                                        display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                                        onChange={onTimeChange}
                                    />
                                )}
                            </View>

                            <View style={styles.inputGroup}>
                                <Text style={styles.label}>Admisión</Text>
                                <View style={styles.toggleGroup}>
                                    <TouchableOpacity
                                        style={[styles.toggleOption, autoAccept && styles.toggleOptionActive]}
                                        onPress={() => setAutoAccept(true)}
                                    >
                                        <Text style={[styles.toggleOptionText, autoAccept && styles.toggleOptionTextActive]}>
                                            Cualquiera
                                        </Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={[styles.toggleOption, !autoAccept && styles.toggleOptionActive]}
                                        onPress={() => setAutoAccept(false)}
                                    >
                                        <Text style={[styles.toggleOptionText, !autoAccept && styles.toggleOptionTextActive]}>
                                            Solicitud
                                        </Text>
                                    </TouchableOpacity>
                                </View>
                            </View>
                        </View>

                        {/* Asientos + Desvío */}
                        <View style={styles.row}>
                            <View style={styles.inputGroup}>
                                <Text style={styles.label}>Asientos</Text>
                                <View style={styles.counter}>
                                    <TouchableOpacity onPress={() => setSeats(Math.max(1, seats - 1))}>
                                        <Ionicons name="remove-circle-outline" size={32} color="#64748B" />
                                    </TouchableOpacity>
                                    <Text style={styles.counterText}>{seats}</Text>
                                    <TouchableOpacity onPress={() => setSeats(Math.min(6, seats + 1))}>
                                        <Ionicons name="add-circle-outline" size={32} color="#64748B" />
                                    </TouchableOpacity>
                                </View>
                            </View>

                            <View style={styles.inputGroup}>
                                <Text style={styles.label}>Desvío (min)</Text>
                                <View style={styles.counter}>
                                    <TouchableOpacity onPress={() => setDetour(Math.max(0, detour - 5))}>
                                        <Ionicons name="remove-circle-outline" size={32} color="#64748B" />
                                    </TouchableOpacity>
                                    <Text style={styles.counterText}>{detour}</Text>
                                    <TouchableOpacity onPress={() => setDetour(Math.min(30, detour + 5))}>
                                        <Ionicons name="add-circle-outline" size={32} color="#64748B" />
                                    </TouchableOpacity>
                                </View>
                            </View>
                        </View>

                        <TouchableOpacity
                            style={[styles.publishButton, loading && styles.disabledButton]}
                            onPress={handlePublish}
                            disabled={loading}
                        >
                            <Text style={styles.publishButtonText}>
                                {loading ? 'Publicando...' : 'Publicar Viaje'}
                            </Text>
                        </TouchableOpacity>
                    </View>
                </ScrollView>
            </KeyboardAvoidingView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F8FAFC',
    },
    mapContainer: {
        height: height * 0.45,
    },
    formContainer: {
        flex: 1,
        backgroundColor: '#FFF',
        borderTopLeftRadius: 30,
        borderTopRightRadius: 30,
        marginTop: -30,
        paddingTop: 20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.1,
        shadowRadius: 10,
        elevation: 10,
    },
    formContent: {
        padding: 24,
    },
    autocompleteWrapper: {
        zIndex: 10,
        paddingHorizontal: 24,
        paddingTop: 16,
        marginBottom: 4,
    },
    controlsAndButton: {
        zIndex: 1,
        paddingBottom: 20,
    },
    label: {
        fontSize: 14,
        fontWeight: '700',
        color: '#475569',
        marginBottom: 8,
    },
    searchInput: {
        backgroundColor: '#F1F5F9',
        borderRadius: 12,
        paddingHorizontal: 16,
        height: 50,
        fontSize: 16,
    },
    row: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 20,
    },
    inputGroup: {
        width: '45%',
    },
    counter: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: '#F1F5F9',
        borderRadius: 12,
        padding: 8,
    },
    counterText: {
        fontSize: 18,
        fontWeight: '700',
        color: '#1E293B',
    },
    timeButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: '#F1F5F9',
        borderRadius: 12,
        padding: 12,
    },
    timeButtonText: {
        fontSize: 16,
        fontWeight: '700',
        color: '#1E293B',
    },
    toggleGroup: {
        flexDirection: 'row',
        backgroundColor: '#F1F5F9',
        borderRadius: 12,
        padding: 4,
    },
    toggleOption: {
        flex: 1,
        paddingVertical: 10,
        borderRadius: 10,
        alignItems: 'center',
    },
    toggleOptionActive: {
        backgroundColor: '#10B981',
    },
    toggleOptionText: {
        fontSize: 11,
        fontWeight: '600',
        color: '#64748B',
    },
    toggleOptionTextActive: {
        color: '#FFF',
    },
    publishButton: {
        backgroundColor: '#10B981',
        paddingVertical: 18,
        borderRadius: 16,
        alignItems: 'center',
    },
    disabledButton: {
        backgroundColor: '#94A3B8',
    },
    publishButtonText: {
        color: '#FFF',
        fontSize: 18,
        fontWeight: '800',
    },

    meetingSection: {
        zIndex: 1,
        marginBottom: 16,
    },
    meetingStaticText: {
        fontSize: 14,
        color: '#374151',
        marginTop: 4,
    },
});

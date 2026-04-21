import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import * as Location from 'expo-location';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useAuthStore } from '../store/authStore';

export const HomeScreen = () => {
    const insets = useSafeAreaInsets();
    const navigation = useNavigation<any>();
    const { appMode, setAppMode, isDriver } = useAuthStore();
    const [location, setLocation] = useState<Location.LocationObject | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            let { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                setErrorMsg('El permiso de ubicación fue denegado');
                return;
            }

            let currentLocation = await Location.getCurrentPositionAsync({});
            setLocation(currentLocation);
        })();
    }, []);

    const toggleAppMode = (mode: 'driver' | 'passenger') => {
        setAppMode(mode);
    };

    return (
        <View style={styles.container}>
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
                    <Marker
                        coordinate={{
                            latitude: location.coords.latitude,
                            longitude: location.coords.longitude,
                        }}
                        title="Tú estás aquí"
                    />
                </MapView>
            ) : (
                <View style={styles.loadingContainer}>
                    <Text>{errorMsg || 'Cargando mapa...'}</Text>
                </View>
            )}

            {/* UI Flotante / SafeArea Seguro */}
            <View style={[styles.overlay, { top: insets.top + 16 }]}>
                <View style={styles.card}>
                    <TouchableOpacity
                        style={[styles.toggleButton, appMode === 'passenger' && styles.activePassenger]}
                        onPress={() => toggleAppMode('passenger')}
                    >
                        <Text style={[styles.toggleText, appMode === 'passenger' && styles.activeText]}>Soy Pasajero</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.toggleButton, appMode === 'driver' && styles.activeDriver]}
                        onPress={() => toggleAppMode('driver')}
                    >
                        <Text style={[styles.toggleText, appMode === 'driver' && styles.activeText]}>Soy Conductor</Text>
                    </TouchableOpacity>
                </View>
            </View>

            {/* Botón Flotante Inferior (Solo Modo Conductor) */}
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
                            style={[styles.fab, { backgroundColor: '#38BDF8' }]} // Color distinto para registrar Auto
                            onPress={() => navigation.navigate('AddVehicle')}
                        >
                            <Text style={styles.fabText}>Registrar Vehículo</Text>
                        </TouchableOpacity>
                    )}
                </View>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fff',
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    overlay: {
        position: 'absolute',
        width: '100%',
        paddingHorizontal: 20,
        zIndex: 10,
    },
    bottomOverlay: {
        position: 'absolute',
        width: '100%',
        paddingHorizontal: 20,
        alignItems: 'center',
    },
    card: {
        flexDirection: 'row',
        backgroundColor: '#fff',
        borderRadius: 30,
        padding: 4,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
        elevation: 8, // for Android
    },
    toggleButton: {
        flex: 1,
        paddingVertical: 12,
        borderRadius: 26,
        alignItems: 'center',
    },
    fab: {
        backgroundColor: '#10B981',
        paddingVertical: 16,
        paddingHorizontal: 40,
        borderRadius: 30,
        shadowColor: '#10B981',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.3,
        shadowRadius: 10,
        elevation: 10,
    },
    fabText: {
        color: '#FFF',
        fontSize: 18,
        fontWeight: '800',
    },
    activePassenger: {
        backgroundColor: '#0EA5E9', // Azul
    },
    activeDriver: {
        backgroundColor: '#10B981', // Verde
    },
    toggleText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#64748B',
    },
    activeText: {
        color: '#FFF',
    },
});

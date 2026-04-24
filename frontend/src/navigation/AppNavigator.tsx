import React, { useEffect, useRef, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuthStore } from '../store/authStore';
import { axiosClient } from '../api/axiosClient';

import { LoginScreen } from '../screens/LoginScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { CreateTripScreen } from '../screens/CreateTripScreen';
import { AddVehicleScreen } from '../screens/AddVehicleScreen';
import { DriverTripsScreen } from '../screens/DriverTripsScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { MyTripsScreen } from '../screens/MyTripsScreen';
import { ActiveTripScreen } from '../screens/ActiveTripScreen';

export type RootStackParamList = {
  Login: undefined;
  Home: undefined;
  CreateTrip: undefined;
  AddVehicle: {
    vehicle?: { plate: string; brand: string; model: string; color: string; capacity: number };
  } | undefined;
  DriverTrips: undefined;
  Profile: undefined;
  MyBookings: undefined;
  ActiveTrip: { tripId: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const Splash = () => (
  <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0F172A' }}>
    <ActivityIndicator size="large" color="#0EA5E9" />
  </View>
);

export const AppNavigator = () => {
  const { token, _hasHydrated, login } = useAuthStore();
  const [sessionReady, setSessionReady] = useState(false);
  const verified = useRef(false);

  useEffect(() => {
    // Esperar a que Zustand hidrate desde AsyncStorage
    if (!_hasHydrated || verified.current) return;
    verified.current = true;

    if (!token) {
      // Sin token guardado → mostrar Login de inmediato
      setSessionReady(true);
      return;
    }

    // Verificar que el token siga siendo válido en el backend
    axiosClient
      .get('/users/me')
      .then((res) => {
        // Actualizar isDriver con datos frescos (el vehicle puede haber cambiado)
        login(token, { id: res.data.id, name: res.data.name, email: res.data.email }, !!res.data.vehicle);
      })
      .catch(() => {
        // 401 → el interceptor de axios ya llamó logout() y limpió el token
        // Otros errores (sin red, 500) → dejamos la sesión y el usuario entra igual
      })
      .finally(() => setSessionReady(true));
  }, [_hasHydrated]);

  if (!_hasHydrated || !sessionReady) return <Splash />;

  return (
    <Stack.Navigator id="RootStack">
      {!token ? (
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
      ) : (
        <>
          <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
          <Stack.Screen name="CreateTrip" component={CreateTripScreen} options={{ title: 'Publicar Viaje' }} />
          <Stack.Screen name="AddVehicle" component={AddVehicleScreen} options={{ title: 'Vehículo' }} />
          <Stack.Screen name="DriverTrips" component={DriverTripsScreen} options={{ title: 'Mis Viajes' }} />
          <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: 'Mi Perfil' }} />
          <Stack.Screen name="MyBookings" component={MyTripsScreen} options={{ title: 'Mis Viajes' }} />
          <Stack.Screen name="ActiveTrip" component={ActiveTripScreen} options={{ headerShown: false }} />
        </>
      )}
    </Stack.Navigator>
  );
};

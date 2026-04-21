import React from 'react';
import { View, Text } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { LoginScreen } from '../screens/LoginScreen';

// 1. Definimos el "Diccionario" de nuestras pantallas y sus parámetros.
// (undefined significa que no reciben parámetros extra en la URL)
export type RootStackParamList = {
  Login: undefined;
  Home: undefined;
  CreateTrip: undefined;
  AddVehicle: undefined;
};

import { HomeScreen } from '../screens/HomeScreen';
import { CreateTripScreen } from '../screens/CreateTripScreen';
import { AddVehicleScreen } from '../screens/AddVehicleScreen';

// 2. Le inyectamos el tipo al Stack para que TypeScript sea feliz
const Stack = createNativeStackNavigator<RootStackParamList>();

export const AppNavigator = () => {
  return (
    // 3. Agregamos el prop 'id' (obligatorio en v7) para identificar este navegador
    <Stack.Navigator id="RootStack" initialRouteName="Login">
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Home" component={HomeScreen} />
      <Stack.Screen name="CreateTrip" component={CreateTripScreen} options={{ title: 'Publicar Viaje' }} />
      <Stack.Screen name="AddVehicle" component={AddVehicleScreen} options={{ title: 'Vehículo' }} />
    </Stack.Navigator>
  );
};
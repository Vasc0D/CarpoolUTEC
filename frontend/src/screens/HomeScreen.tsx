import React from 'react';
import { useAuthStore } from '../store/authStore';
import { PassengerHomeScreen } from './PassengerHomeScreen';
import { DriverDashboardScreen } from './DriverDashboardScreen';

export const HomeScreen = () => {
  const { appMode, isDriver } = useAuthStore();
  if (appMode === 'driver' && isDriver) return <DriverDashboardScreen />;
  return <PassengerHomeScreen />;
};

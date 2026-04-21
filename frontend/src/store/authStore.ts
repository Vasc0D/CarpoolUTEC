import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface User {
    id: string;
    email: string;
    name: string;
}

interface AuthState {
    user: User | null;
    token: string | null;
    isDriver: boolean;
    appMode: 'driver' | 'passenger';
    login: (token: string, user: User, isDriver?: boolean) => void;
    logout: () => void;
    setAppMode: (mode: 'driver' | 'passenger') => void;
}

export const useAuthStore = create<AuthState>()(
    persist(
        (set) => ({
            user: null,
            token: null,
            isDriver: false,
            appMode: 'passenger',
            login: (token, user, isDriver) => set({ token, user, isDriver: isDriver || false }),
            logout: () => set({ user: null, token: null, isDriver: false, appMode: 'passenger' }),
            setAppMode: (mode) => set({ appMode: mode }),
        }),
        {
            name: 'carpool-auth-storage', // Key para el async storage
            storage: createJSONStorage(() => AsyncStorage),
        }
    )
);

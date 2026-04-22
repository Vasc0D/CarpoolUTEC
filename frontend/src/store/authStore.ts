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
    _hasHydrated: boolean;
    login: (token: string, user: User, isDriver?: boolean) => void;
    logout: () => void;
    setAppMode: (mode: 'driver' | 'passenger') => void;
    setHasHydrated: (state: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
    persist(
        (set) => ({
            user: null,
            token: null,
            isDriver: false,
            appMode: 'passenger',
            _hasHydrated: false,
            login: (token, user, isDriver) => set({ token, user, isDriver: isDriver || false }),
            logout: () => set({ user: null, token: null, isDriver: false, appMode: 'passenger' }),
            setAppMode: (mode) => set({ appMode: mode }),
            setHasHydrated: (state) => set({ _hasHydrated: state }),
        }),
        {
            name: 'carpool-auth-storage',
            storage: createJSONStorage(() => AsyncStorage),
            // Only persist auth data — _hasHydrated must always start false
            partialize: (state) => ({
                user: state.user,
                token: state.token,
                isDriver: state.isDriver,
                appMode: state.appMode,
            }),
            onRehydrateStorage: () => (state) => {
                state?.setHasHydrated(true);
            },
        }
    )
);

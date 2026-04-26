import axios from 'axios';
import { Alert } from 'react-native';
import { useAuthStore } from '../store/authStore';

// P-6: URL from env — avoids hardcoded localhost in shipped code
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

export const axiosClient = axios.create({
    baseURL: API_URL,
    timeout: 10000,
});

axiosClient.interceptors.request.use(
    (config) => {
        const token = useAuthStore.getState().token;
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => Promise.reject(error),
);

// P-8: guard so only one "session expired" dialog is shown even when
// multiple in-flight requests fail simultaneously with 401.
let sessionExpiredAlertShown = false;

axiosClient.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401 && !sessionExpiredAlertShown) {
            sessionExpiredAlertShown = true;
            Alert.alert(
                'Sesión expirada',
                'Tu sesión ha expirado. Por favor inicia sesión de nuevo.',
                [{
                    text: 'Entendido',
                    onPress: () => {
                        sessionExpiredAlertShown = false;
                        useAuthStore.getState().logout();
                    },
                }],
            );
        }
        return Promise.reject(error);
    },
);

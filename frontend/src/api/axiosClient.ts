import axios from 'axios';
import { useAuthStore } from '../store/authStore';

// URL del Backend
export const axiosClient = axios.create({
    baseURL: 'http://localhost:3000',
    timeout: 10000,
});

axiosClient.interceptors.request.use(
    (config) => {
        // Tomamos el token estático desde Zustand sin reactividad
        const token = useAuthStore.getState().token;
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

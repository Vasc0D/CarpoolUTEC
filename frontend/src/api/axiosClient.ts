import axios from 'axios';
import { useAuthStore } from '../store/authStore';

// URL del Backend
export const axiosClient = axios.create({
    baseURL: 'http://localhost:3000',
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
    (error) => Promise.reject(error)
);

axiosClient.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            useAuthStore.getState().logout();
        }
        return Promise.reject(error);
    }
);

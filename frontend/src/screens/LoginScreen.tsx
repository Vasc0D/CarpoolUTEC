import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { useAuthStore } from '../store/authStore';
import { axiosClient } from '../api/axiosClient';

// Required by Expo AuthSession to close the browser tab after redirect
WebBrowser.maybeCompleteAuthSession();

const BACKEND_URL = 'http://localhost:3000';

export const LoginScreen = () => {
    const login = useAuthStore((state) => state.login);

    // Exchange a one-time auth code for a JWT, then fetch the user profile.
    // The code arrives via the deep-link URL (?code=...) and is only valid for 60 s.
    const handleAuthCode = async (code: string) => {
        try {
            // 1. Exchange the opaque code for the JWT
            const { data: tokenData } = await axiosClient.post<{ access_token: string }>(
                '/auth/token',
                { code },
            );
            const token = tokenData.access_token;

            // 2. Fetch the user profile using the new token
            const { data: user } = await axiosClient.get('/users/me', {
                headers: { Authorization: `Bearer ${token}` },
            });

            // 3. Persist session — AppNavigator will react and navigate to Home
            login(token, user, !!user.vehicle);
        } catch {
            Alert.alert('Error', 'No se pudo completar el inicio de sesión. Intenta de nuevo.');
        }
    };

    useEffect(() => {
        const handleUrl = (event: Linking.EventType) => {
            const { queryParams } = Linking.parse(event.url);
            const code = queryParams?.code as string | undefined;
            if (code) handleAuthCode(code);
        };

        // Handle deep links when the app is already in memory (background)
        const subscription = Linking.addEventListener('url', handleUrl);

        // Handle deep links on cold start
        Linking.getInitialURL().then((url) => {
            if (url) handleUrl({ url });
        });

        return () => subscription.remove();
    }, []);

    const handleLogin = async () => {
        await WebBrowser.openBrowserAsync(`${BACKEND_URL}/auth/google`);
    };

    return (
        <View style={styles.container}>
            <Text style={styles.title}>Carpool UTEC</Text>
            <Text style={styles.subtitle}>Viaja seguro, llega rápido con tu comunidad.</Text>

            <TouchableOpacity style={styles.button} onPress={handleLogin} activeOpacity={0.8}>
                <Text style={styles.buttonText}>Ingresar con correo UTEC</Text>
            </TouchableOpacity>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#0F172A',
        paddingHorizontal: 24,
    },
    title: {
        fontSize: 48,
        fontWeight: '900',
        color: '#0EA5E9',
        marginBottom: 8,
    },
    subtitle: {
        fontSize: 16,
        color: '#94A3B8',
        textAlign: 'center',
        marginBottom: 64,
    },
    button: {
        backgroundColor: '#38BDF8',
        paddingVertical: 18,
        paddingHorizontal: 32,
        borderRadius: 14,
        width: '100%',
        shadowColor: '#0EA5E9',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.4,
        shadowRadius: 8,
        elevation: 8,
    },
    buttonText: {
        color: '#0F172A',
        fontSize: 18,
        fontWeight: '800',
        textAlign: 'center',
    },
});

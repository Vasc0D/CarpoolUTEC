import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { useAuthStore } from '../store/authStore';

// Mantiene en tracking la sesión si la app es enviada a background
WebBrowser.maybeCompleteAuthSession();

export const LoginScreen = () => {
    const login = useAuthStore((state) => state.login);

    useEffect(() => {
        const handleUrl = (event: Linking.EventType) => {
            const data = Linking.parse(event.url);
            if (data.queryParams?.token && data.queryParams?.user) {
                const user = JSON.parse(decodeURIComponent(data.queryParams.user as string));
                // Persistir sesión — AppNavigator reacciona al token y navega a Home automáticamente
                login(data.queryParams.token as string, user);
            }
        };

        // Capturar deep links cuando la app ya corre silente en memoria (background event)
        const subscription = Linking.addEventListener('url', handleUrl);

        // Capturar deep links desde cero o cold start
        Linking.getInitialURL().then((url) => {
            if (url) handleUrl({ url });
        });

        return () => subscription.remove();
    }, []);

    const handleLogin = async () => {
        const authUrl = `http://localhost:3000/auth/google`; // Backend OAuth2 Tunnel
        // Redirigir abriendo una pestaña oficial delegando la intercepción al Backend Res.redirect via App DeepLink  
        await WebBrowser.openBrowserAsync(authUrl);
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
        backgroundColor: '#0F172A', // Slate-900 Modern
        paddingHorizontal: 24,
    },
    title: {
        fontSize: 48,
        fontWeight: '900',
        color: '#0EA5E9', // React/Sky-blue shade
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

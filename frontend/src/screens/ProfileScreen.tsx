import React, { useEffect, useState } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity,
    ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../store/authStore';
import { axiosClient } from '../api/axiosClient';

// ─── Types ───────────────────────────────────────────────────────────────────

interface VehicleData {
    id: string;
    plate: string;
    brand: string;
    model: string;
    color: string;
    capacity: number;
}

interface UserProfile {
    id: string;
    name: string;
    email: string;
    vehicle: VehicleData | null;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export const ProfileScreen = () => {
    const navigation = useNavigation<any>();
    const insets = useSafeAreaInsets();
    const { user, logout } = useAuthStore();

    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        axiosClient.get<UserProfile>('/users/me')
            .then(res => setProfile(res.data))
            .catch(() => Alert.alert('Error', 'No se pudieron cargar los datos del perfil.'))
            .finally(() => setLoading(false));
    }, []);

    const handleLogout = () => {
        Alert.alert('Cerrar sesión', '¿Estás seguro que quieres salir?', [
            { text: 'Cancelar', style: 'cancel' },
            {
                text: 'Salir',
                style: 'destructive',
                onPress: logout, // AppNavigator reacciona al token → null y muestra Login
            },
        ]);
    };

    if (loading) {
        return (
            <View style={styles.centered}>
                <ActivityIndicator size="large" color="#10B981" />
            </View>
        );
    }

    const displayName = profile?.name ?? user?.name ?? '';
    const displayEmail = profile?.email ?? user?.email ?? '';
    const vehicle = profile?.vehicle ?? null;

    return (
        <ScrollView
            style={styles.container}
            contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
            showsVerticalScrollIndicator={false}
        >
            {/* ── Avatar + info ─────────────────────────────────────────── */}
            <View style={styles.avatarSection}>
                <View style={styles.avatar}>
                    <Text style={styles.avatarText}>
                        {displayName[0]?.toUpperCase() ?? '?'}
                    </Text>
                </View>
                <Text style={styles.name}>{displayName}</Text>
                <Text style={styles.email}>{displayEmail}</Text>
            </View>

            {/* ── Vehículo ──────────────────────────────────────────────── */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Vehículo</Text>

                {vehicle ? (
                    <View style={styles.vehicleCard}>
                        <View style={styles.vehicleHeader}>
                            <View style={styles.vehicleIconWrap}>
                                <Ionicons name="car-sport-outline" size={22} color="#10B981" />
                            </View>
                            <Text style={styles.vehicleName}>
                                {vehicle.brand} {vehicle.model}
                            </Text>
                        </View>

                        <View style={styles.chips}>
                            <View style={styles.chip}>
                                <Ionicons name="card-outline" size={13} color="#64748B" />
                                <Text style={styles.chipText}>{vehicle.plate}</Text>
                            </View>
                            <View style={styles.chip}>
                                <Ionicons name="color-palette-outline" size={13} color="#64748B" />
                                <Text style={styles.chipText}>{vehicle.color}</Text>
                            </View>
                            <View style={styles.chip}>
                                <Ionicons name="people-outline" size={13} color="#64748B" />
                                <Text style={styles.chipText}>{vehicle.capacity} asientos</Text>
                            </View>
                        </View>

                        <TouchableOpacity
                            style={styles.editBtn}
                            onPress={() => navigation.navigate('AddVehicle')}
                        >
                            <Ionicons name="pencil-outline" size={14} color="#10B981" />
                            <Text style={styles.editBtnText}>Editar vehículo</Text>
                        </TouchableOpacity>
                    </View>
                ) : (
                    <TouchableOpacity
                        style={styles.addVehicleCard}
                        onPress={() => navigation.navigate('AddVehicle')}
                        activeOpacity={0.75}
                    >
                        <Ionicons name="add-circle-outline" size={26} color="#10B981" />
                        <View style={{ flex: 1 }}>
                            <Text style={styles.addVehicleTitle}>Registrar vehículo</Text>
                            <Text style={styles.addVehicleSubtitle}>
                                Necesitas un auto para publicar viajes
                            </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={18} color="#CBD5E1" />
                    </TouchableOpacity>
                )}
            </View>

            {/* ── Cerrar sesión ─────────────────────────────────────────── */}
            <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
                <Ionicons name="log-out-outline" size={20} color="#EF4444" />
                <Text style={styles.logoutText}>Cerrar sesión</Text>
            </TouchableOpacity>
        </ScrollView>
    );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    container: { flex: 1, backgroundColor: '#F8FAFC' },
    content: { padding: 24, gap: 24 },

    // Avatar block
    avatarSection: { alignItems: 'center', paddingVertical: 24, gap: 8 },
    avatar: {
        width: 80, height: 80, borderRadius: 40,
        backgroundColor: '#0F172A',
        justifyContent: 'center', alignItems: 'center',
        shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15, shadowRadius: 10, elevation: 8,
    },
    avatarText: { color: '#38BDF8', fontSize: 34, fontWeight: '900' },
    name: { fontSize: 22, fontWeight: '800', color: '#0F172A' },
    email: { fontSize: 14, color: '#64748B' },

    // Section
    section: { gap: 10 },
    sectionTitle: { fontSize: 13, fontWeight: '700', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: 0.8 },

    // Vehicle card
    vehicleCard: {
        backgroundColor: '#FFF', borderRadius: 20, padding: 18, gap: 14,
        shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
    },
    vehicleHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    vehicleIconWrap: {
        width: 40, height: 40, borderRadius: 12,
        backgroundColor: '#F0FDF4', justifyContent: 'center', alignItems: 'center',
    },
    vehicleName: { fontSize: 17, fontWeight: '700', color: '#0F172A' },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
        flexDirection: 'row', alignItems: 'center', gap: 5,
        backgroundColor: '#F1F5F9', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 20,
    },
    chipText: { fontSize: 13, color: '#475569', fontWeight: '600' },
    editBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        alignSelf: 'flex-start',
        paddingVertical: 6, paddingHorizontal: 12,
        borderRadius: 10, borderWidth: 1, borderColor: '#D1FAE5',
        backgroundColor: '#F0FDF4',
    },
    editBtnText: { fontSize: 13, color: '#10B981', fontWeight: '700' },

    // Add vehicle card
    addVehicleCard: {
        flexDirection: 'row', alignItems: 'center', gap: 14,
        backgroundColor: '#FFF', borderRadius: 20, padding: 18,
        borderWidth: 1.5, borderColor: '#D1FAE5', borderStyle: 'dashed',
    },
    addVehicleTitle: { fontSize: 15, fontWeight: '700', color: '#0F172A' },
    addVehicleSubtitle: { fontSize: 13, color: '#94A3B8', marginTop: 2 },

    // Logout
    logoutBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
        backgroundColor: '#FFF', borderRadius: 16, paddingVertical: 16,
        borderWidth: 1, borderColor: '#FECACA',
        shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
    },
    logoutText: { fontSize: 16, fontWeight: '700', color: '#EF4444' },
});

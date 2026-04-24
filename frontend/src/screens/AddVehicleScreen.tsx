import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, SafeAreaView, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { axiosClient } from '../api/axiosClient';
import { useAuthStore } from '../store/authStore';

export const AddVehicleScreen = () => {
    const navigation = useNavigation<any>();
    const route = useRoute<any>();
    const existingVehicle = route.params?.vehicle ?? null;
    const isEditing = !!existingVehicle;

    const { token, user, login } = useAuthStore();
    const [loading, setLoading] = useState(false);

    const [form, setForm] = useState({
        plate: existingVehicle?.plate ?? '',
        brand: existingVehicle?.brand ?? '',
        model: existingVehicle?.model ?? '',
        color: existingVehicle?.color ?? '',
        capacity: existingVehicle?.capacity?.toString() ?? '4',
    });

    const handleSave = async () => {
        if (!form.plate || !form.brand || !form.model || !form.color || !form.capacity) {
            Alert.alert('Error', 'Por favor llena todos los campos obligatorios.');
            return;
        }

        setLoading(true);
        try {
            await axiosClient.post('/users/vehicle', {
                plate: form.plate.toUpperCase(),
                brand: form.brand,
                model: form.model,
                color: form.color,
                capacity: parseInt(form.capacity, 10),
            });

            if (token && user) {
                login(token, user, true);
            }

            Alert.alert(
                isEditing ? '¡Actualizado!' : '¡Felicidades!',
                isEditing ? 'Tu vehículo ha sido actualizado con éxito.' : 'Tu auto ha sido registrado con éxito.',
                [{ text: 'OK', onPress: () => navigation.goBack() }],
            );
        } catch (error: any) {
            console.error('Error al guardar vehículo:', error.response?.data || error.message);
            Alert.alert('Error', 'Hubo un problema guardando los datos del vehículo.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <SafeAreaView style={styles.safeArea}>
            <KeyboardAvoidingView
                style={{ flex: 1 }}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                <ScrollView contentContainerStyle={styles.container}>
                    <Text style={styles.title}>{isEditing ? 'Editar mi Auto' : 'Registrar mi Auto'}</Text>
                    <Text style={styles.subtitle}>
                        {isEditing
                            ? 'Actualiza los datos de tu vehículo.'
                            : 'Completa los datos de tu vehículo para empezar a ofrecer viajes.'}
                    </Text>

                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Placa</Text>
                        <TextInput
                            style={styles.input}
                            placeholder="Ej. UTEC-123"
                            autoCapitalize="characters"
                            value={form.plate}
                            onChangeText={(text) => setForm({ ...form, plate: text })}
                        />
                    </View>

                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Marca</Text>
                        <TextInput
                            style={styles.input}
                            placeholder="Ej. Toyota"
                            value={form.brand}
                            onChangeText={(text) => setForm({ ...form, brand: text })}
                        />
                    </View>

                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Modelo</Text>
                        <TextInput
                            style={styles.input}
                            placeholder="Ej. Yaris"
                            value={form.model}
                            onChangeText={(text) => setForm({ ...form, model: text })}
                        />
                    </View>

                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Color</Text>
                        <TextInput
                            style={styles.input}
                            placeholder="Ej. Negro"
                            value={form.color}
                            onChangeText={(text) => setForm({ ...form, color: text })}
                        />
                    </View>

                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Asientos (Capacidad Pasajeros)</Text>
                        <TextInput
                            style={styles.input}
                            placeholder="Ej. 4"
                            keyboardType="numeric"
                            value={form.capacity}
                            onChangeText={(text) => setForm({ ...form, capacity: text })}
                        />
                    </View>

                    <TouchableOpacity 
                        style={[styles.saveButton, loading && styles.disabledButton]} 
                        onPress={handleSave}
                        disabled={loading}
                    >
                        <Text style={styles.saveButtonText}>
                            {loading ? 'Guardando...' : isEditing ? 'Guardar Cambios' : 'Guardar y Continuar'}
                        </Text>
                    </TouchableOpacity>
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
};

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
        backgroundColor: '#F8FAFC',
    },
    container: {
        padding: 24,
    },
    title: {
        fontSize: 32,
        fontWeight: '900',
        color: '#0F172A',
        marginBottom: 8,
    },
    subtitle: {
        fontSize: 16,
        color: '#64748B',
        marginBottom: 32,
    },
    inputGroup: {
        marginBottom: 20,
    },
    label: {
        fontSize: 14,
        fontWeight: '700',
        color: '#475569',
        marginBottom: 8,
    },
    input: {
        backgroundColor: '#FFF',
        borderWidth: 1,
        borderColor: '#E2E8F0',
        borderRadius: 12,
        paddingHorizontal: 16,
        height: 54,
        fontSize: 16,
        color: '#0F172A',
    },
    saveButton: {
        backgroundColor: '#10B981',
        paddingVertical: 18,
        borderRadius: 16,
        alignItems: 'center',
        marginTop: 12,
    },
    disabledButton: {
        backgroundColor: '#94A3B8',
    },
    saveButtonText: {
        color: '#FFF',
        fontSize: 18,
        fontWeight: '800',
    },
});

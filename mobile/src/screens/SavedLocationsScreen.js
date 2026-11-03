import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
} from 'react-native';
import { useAccessibility } from '../context/AccessibilityContext';
import { apiRequest } from '../api/client';
import Header from '../components/Header';
import BigButton from '../components/BigButton';

export default function SavedLocationsScreen({ onNavigate, onBack }) {
  const { speak, triggerHaptic } = useAccessibility();
  const [locations, setLocations] = useState([
    { id: '1', name: 'Home Residence', address: '14 Anna Salai, Chennai, TN', icon: '🏠' },
    { id: '2', name: 'City Hospital & Eye Clinic', address: '56 Greams Road, Chennai, TN', icon: '🏥' },
    { id: '3', name: 'Central Metro Station', address: 'Poonamallee High Rd, Park Town', icon: '🚇' },
    { id: '4', name: 'Community Pharmacy', address: '22 South Mada Street, Mylapore', icon: '💊' },
  ]);

  useEffect(() => {
    apiRequest('/locations')
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) setLocations(data);
      })
      .catch(() => {});
  }, []);

  const handleNavigateTo = (loc) => {
    triggerHaptic('success');
    speak(`Routing navigation to your saved location: ${loc.name}.`);
    onNavigate('Navigation', { destination: loc.name });
  };

  return (
    <View style={styles.container}>
      <Header title="Saved Locations" showBack onBack={onBack} />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.headerText}>Frequent Destinations ({locations.length})</Text>

        {locations.map((loc) => (
          <View key={loc.id} style={styles.card}>
            <View style={styles.iconBox}>
              <Text style={styles.icon}>{loc.icon || '📍'}</Text>
            </View>

            <View style={styles.info}>
              <Text style={styles.name}>{loc.name}</Text>
              <Text style={styles.address}>{loc.address}</Text>
            </View>

            <BigButton
              title="Go"
              icon="🗺️"
              variant="green"
              style={styles.goBtn}
              onPress={() => handleNavigateTo(loc)}
            />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#05080f',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  headerText: {
    color: '#f9fafb',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 14,
  },
  card: {
    backgroundColor: '#0d1117',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 12,
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(52,211,153,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: 22,
  },
  info: {
    flex: 1,
  },
  name: {
    color: '#f9fafb',
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 2,
  },
  address: {
    color: '#9ca3af',
    fontSize: 12,
  },
  goBtn: {
    minHeight: 40,
    paddingHorizontal: 14,
  },
});

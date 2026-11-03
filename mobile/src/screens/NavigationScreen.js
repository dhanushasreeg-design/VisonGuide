import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useAccessibility } from '../context/AccessibilityContext';
import { getCurrentGPSPosition, getCleanAddress, fetchNearbyPlaces } from '../services/locationService';
import Header from '../components/Header';
import BigButton from '../components/BigButton';

const CATEGORIES = [
  { id: 'hospital', label: 'Hospitals', icon: '🏥' },
  { id: 'pharmacy', label: 'Pharmacies', icon: '💊' },
  { id: 'atm', label: 'ATMs', icon: '🏧' },
  { id: 'police', label: 'Police', icon: '👮' },
  { id: 'bus stop', label: 'Bus Stops', icon: '🚌' },
];

export default function NavigationScreen({ initialQuery = 'hospital', onBack }) {
  const { speak, triggerHaptic } = useAccessibility();
  const [selectedCat, setSelectedCat] = useState(initialQuery);
  const [coords, setCoords] = useState(null);
  const [address, setAddress] = useState('Detecting current location…');
  const [places, setPlaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [navigatingTo, setNavigatingTo] = useState(null);

  useEffect(() => {
    async function loadGPS() {
      try {
        setLoading(true);
        const pos = await getCurrentGPSPosition();
        setCoords(pos);
        const addr = await getCleanAddress(pos.latitude, pos.longitude);
        setAddress(addr);

        const list = await fetchNearbyPlaces(selectedCat, pos.latitude, pos.longitude);
        setPlaces(list);
        if (list.length > 0) {
          speak(`Found ${list.length} nearby ${selectedCat}s. Nearest is ${list[0].name}, ${list[0].distanceFormatted} away.`);
        }
      } catch (err) {
        // Fallback demo location (Central City)
        const demoLat = 13.0827;
        const demoLon = 80.2707;
        setCoords({ latitude: demoLat, longitude: demoLon });
        setAddress('Chennai Central, Tamil Nadu, India');
        const list = await fetchNearbyPlaces(selectedCat, demoLat, demoLon);
        setPlaces(list);
      } finally {
        setLoading(false);
      }
    }
    loadGPS();
  }, [selectedCat]);

  const handleStartNavigation = (place) => {
    triggerHaptic('success');
    setNavigatingTo(place);
    speak(`Starting spoken navigation to ${place.name}. Distance: ${place.distanceFormatted}. Head north.`);
  };

  return (
    <View style={styles.container}>
      <Header title="GPS Navigation" showBack onBack={onBack} />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Current GPS Card */}
        <View style={styles.gpsCard}>
          <View style={styles.gpsHeader}>
            <Text style={styles.gpsDot}>📍</Text>
            <Text style={styles.gpsTitle}>Current Location</Text>
          </View>
          <Text style={styles.gpsAddress}>{address}</Text>
          {coords && (
            <Text style={styles.gpsCoords}>
              Lat: {coords.latitude.toFixed(4)}, Lon: {coords.longitude.toFixed(4)}
            </Text>
          )}
          <BigButton
            title="Where Am I? (Speak Location)"
            icon="📢"
            variant="ghost"
            style={{ marginTop: 10 }}
            onPress={() => {
              triggerHaptic('medium');
              speak(`You are currently at ${address}.`);
            }}
          />
        </View>

        {/* Turn-by-Turn Spoken Guidance Banner */}
        {navigatingTo && (
          <View style={styles.activeNavCard}>
            <Text style={styles.activeNavTitle}>🏁 Navigating to {navigatingTo.name}</Text>
            <Text style={styles.activeNavStep}>↑ Continue straight for 150m, then bear right.</Text>
            <Text style={styles.activeNavDist}>Remaining: {navigatingTo.distanceFormatted}</Text>
            <BigButton
              title="Stop Guidance"
              variant="red"
              style={{ marginTop: 8 }}
              onPress={() => {
                setNavigatingTo(null);
                speak('Navigation guidance stopped.');
              }}
            />
          </View>
        )}

        {/* Category Filter Chips */}
        <Text style={styles.sectionTitle}>POI Categories</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catScroll}>
          {CATEGORIES.map((c) => {
            const active = selectedCat === c.id;
            return (
              <TouchableOpacity
                key={c.id}
                style={[styles.catChip, active && styles.catChipActive]}
                onPress={() => {
                  triggerHaptic('light');
                  setSelectedCat(c.id);
                }}
              >
                <Text style={styles.catIcon}>{c.icon}</Text>
                <Text style={[styles.catLabel, active && styles.catLabelActive]}>{c.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Nearby Places List */}
        <Text style={styles.sectionTitle}>
          Nearest {CATEGORIES.find((c) => c.id === selectedCat)?.label || 'Places'} ({places.length})
        </Text>

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color="#22c55e" />
            <Text style={styles.loadingText}>Searching OpenStreetMap for nearby locations…</Text>
          </View>
        ) : places.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyIcon}>🔍</Text>
            <Text style={styles.emptyText}>No results found nearby. Try another category.</Text>
          </View>
        ) : (
          places.map((p, idx) => (
            <View key={p.id || idx} style={styles.placeCard}>
              <View style={styles.placeInfo}>
                <Text style={styles.placeName}>{p.name}</Text>
                <Text style={styles.placeDist}>📍 {p.distanceFormatted} away</Text>
                <Text style={styles.placeAddress} numberOfLines={2}>
                  {p.fullAddress}
                </Text>
              </View>

              <BigButton
                title="Navigate"
                icon="🗺️"
                variant="green"
                style={styles.navBtn}
                onPress={() => handleStartNavigation(p)}
              />
            </View>
          ))
        )}
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
  gpsCard: {
    backgroundColor: '#0d1117',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 16,
  },
  gpsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  gpsDot: {
    fontSize: 16,
  },
  gpsTitle: {
    color: '#22c55e',
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  gpsAddress: {
    color: '#f9fafb',
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 22,
  },
  gpsCoords: {
    color: '#9ca3af',
    fontSize: 12,
    marginTop: 4,
  },
  activeNavCard: {
    backgroundColor: 'rgba(167,139,250,0.15)',
    borderWidth: 1.5,
    borderColor: '#a78bfa',
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
  },
  activeNavTitle: {
    color: '#a78bfa',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 4,
  },
  activeNavStep: {
    color: '#f9fafb',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  activeNavDist: {
    color: '#d1d5db',
    fontSize: 13,
  },
  sectionTitle: {
    color: '#f9fafb',
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 10,
    marginTop: 6,
  },
  catScroll: {
    marginBottom: 16,
  },
  catChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0d1117',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    marginRight: 8,
    gap: 6,
  },
  catChipActive: {
    borderColor: '#22c55e',
    backgroundColor: 'rgba(34,197,94,0.15)',
  },
  catIcon: {
    fontSize: 16,
  },
  catLabel: {
    color: '#9ca3af',
    fontSize: 13,
    fontWeight: '600',
  },
  catLabelActive: {
    color: '#22c55e',
    fontWeight: '800',
  },
  placeCard: {
    backgroundColor: '#0d1117',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 12,
  },
  placeInfo: {
    marginBottom: 12,
  },
  placeName: {
    color: '#f9fafb',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 4,
  },
  placeDist: {
    color: '#22c55e',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 4,
  },
  placeAddress: {
    color: '#9ca3af',
    fontSize: 12,
    lineHeight: 18,
  },
  navBtn: {
    minHeight: 44,
  },
  loadingBox: {
    alignItems: 'center',
    padding: 30,
    gap: 12,
  },
  loadingText: {
    color: '#9ca3af',
    fontSize: 13,
    textAlign: 'center',
  },
  emptyBox: {
    alignItems: 'center',
    padding: 30,
  },
  emptyIcon: {
    fontSize: 36,
    marginBottom: 8,
  },
  emptyText: {
    color: '#9ca3af',
    fontSize: 13,
  },
});


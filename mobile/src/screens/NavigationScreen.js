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
import {
  MODES,
  getCurrentGPSPosition,
  getCleanAddress,
  fetchNearbyPlaces,
  fetchOSRMRoute,
  formatDistance,
  formatDuration,
} from '../services/locationService';
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
  const [transportMode, setTransportMode] = useState('foot'); // 'foot' | 'cycling' | 'driving'
  const [coords, setCoords] = useState(null);
  const [address, setAddress] = useState('Acquiring live satellite GPS fix…');
  const [places, setPlaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [navigatingTo, setNavigatingTo] = useState(null);
  const [routeInfo, setRouteInfo] = useState(null);
  const [gpsError, setGpsError] = useState(null);

  const activeModeObj = MODES.find((m) => m.key === transportMode) || MODES[0];

  const loadGPSAndPlaces = async (cat = selectedCat, mode = transportMode) => {
    try {
      setLoading(true);
      setGpsError(null);

      const pos = await getCurrentGPSPosition();
      setCoords(pos);

      const addr = await getCleanAddress(pos.latitude, pos.longitude);
      setAddress(addr);

      // Fetch POIs with mode-specific road distances and travel times
      const list = await fetchNearbyPlaces(cat, pos.latitude, pos.longitude, mode);
      setPlaces(list);

      if (list.length > 0) {
        const top = list[0];
        speak(
          `Found ${list.length} nearby ${cat}s. Nearest is ${top.name}, ${top.distanceFormatted} away to the ${top.direction}. Estimated ${activeModeObj.label} travel time: ${top.durationFormatted}.`
        );
      }
    } catch (err) {
      console.warn('GPS location error:', err);
      setGpsError(err.message || 'Could not acquire GPS position.');
      speak('Could not acquire GPS position. Please ensure location is enabled in settings and tap Retry.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadGPSAndPlaces(selectedCat, transportMode);
  }, [selectedCat, transportMode]);

  const handleModeChange = (newModeKey) => {
    if (newModeKey === transportMode) return;
    triggerHaptic('medium');
    setTransportMode(newModeKey);
    const m = MODES.find((item) => item.key === newModeKey) || MODES[0];
    speak(`Transport mode set to ${m.label}. Calculating ${m.label} distances and travel times.`);

    // If currently navigating to a place, re-calculate route for new mode
    if (navigatingTo) {
      calculateActiveRoute(navigatingTo, newModeKey);
    }
  };

  const calculateActiveRoute = async (place, modeKey = transportMode) => {
    const m = MODES.find((item) => item.key === modeKey) || MODES[0];
    if (coords) {
      try {
        const r = await fetchOSRMRoute(coords.latitude, coords.longitude, place.latitude, place.longitude, modeKey);
        setRouteInfo(r);
        speak(
          `${m.label} route to ${place.name}. Distance: ${r.distanceFormatted} to the ${place.direction}. Estimated time: ${r.durationFormatted}. Head ${place.direction}.`
        );
      } catch (_) {
        setRouteInfo({
          distanceFormatted: place.distanceFormatted,
          durationFormatted: place.durationFormatted,
        });
      }
    }
  };

  const handleStartNavigation = (place) => {
    triggerHaptic('success');
    setNavigatingTo(place);
    calculateActiveRoute(place, transportMode);
  };

  const handleWhereAmI = () => {
    triggerHaptic('medium');
    if (coords) {
      speak(
        `You are currently at ${address}. GPS accuracy is within ${coords.accuracy || 3} meters. Satellite fix is active.`
      );
    } else {
      speak('GPS location is still being acquired. Please hold on.');
      loadGPSAndPlaces();
    }
  };

  return (
    <View style={styles.container}>
      <Header title="GPS Navigation" showBack onBack={onBack} />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Transport Mode Bar: Walk | Bike | Car */}
        <View style={styles.modeCard}>
          <Text style={styles.modeHeader}>Transport Mode</Text>
          <View style={styles.modeRow}>
            {MODES.map((m) => {
              const active = transportMode === m.key;
              return (
                <TouchableOpacity
                  key={m.key}
                  style={[styles.modeBtn, active && styles.modeBtnActive]}
                  onPress={() => handleModeChange(m.key)}
                  activeOpacity={0.7}
                  accessibilityLabel={`Switch to ${m.label} mode`}
                >
                  <Text style={styles.modeIcon}>{m.icon}</Text>
                  <Text style={[styles.modeLabel, active && styles.modeLabelActive]}>{m.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Current GPS Card */}
        <View style={styles.gpsCard}>
          <View style={styles.gpsHeader}>
            <Text style={styles.gpsDot}>📍</Text>
            <Text style={styles.gpsTitle}>Current Location</Text>
          </View>
          <Text style={styles.gpsAddress}>{address}</Text>

          {coords && (
            <View style={styles.accuracyBadge}>
              <Text style={styles.accuracyText}>
                Lat: {coords.latitude.toFixed(5)}, Lon: {coords.longitude.toFixed(5)} • GPS Accuracy: ±{coords.accuracy || 3}m
              </Text>
            </View>
          )}

          {gpsError && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>⚠️ {gpsError}</Text>
              <BigButton
                title="Retry GPS Fix"
                icon="🔄"
                variant="yellow"
                style={{ marginTop: 8 }}
                onPress={() => loadGPSAndPlaces()}
              />
            </View>
          )}

          <BigButton
            title="Where Am I? (Speak Exact Location)"
            icon="📢"
            variant="ghost"
            style={{ marginTop: 10 }}
            onPress={handleWhereAmI}
          />

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
            <BigButton
              title="Hospital Near Me"
              icon="🏥"
              variant="red"
              style={{ flex: 1 }}
              onPress={() => {
                triggerHaptic('medium');
                speak('Searching for nearest hospitals.');
                setSelectedCat('hospital');
              }}
            />
            <BigButton
              title="Pharmacy Near Me"
              icon="💊"
              variant="green"
              style={{ flex: 1 }}
              onPress={() => {
                triggerHaptic('medium');
                speak('Searching for nearest pharmacies.');
                setSelectedCat('pharmacy');
              }}
            />
          </View>
        </View>

        {/* Active Spoken Navigation Banner */}
        {navigatingTo && (
          <View style={styles.activeNavCard}>
            <View style={styles.activeNavTop}>
              <Text style={styles.activeNavTitle}>
                {activeModeObj.icon} Navigating to {navigatingTo.name}
              </Text>
              <Text style={styles.activeNavMode}>({activeModeObj.label} Mode)</Text>
            </View>
            <Text style={styles.activeNavDirection}>
              🧭 Direction: Head {navigatingTo.direction} towards destination
            </Text>
            <View style={styles.activeMetricsRow}>
              <View style={styles.metricItem}>
                <Text style={styles.metricLabel}>Distance</Text>
                <Text style={styles.metricVal}>
                  {routeInfo?.distanceFormatted || navigatingTo.distanceFormatted}
                </Text>
              </View>
              <View style={styles.metricItem}>
                <Text style={styles.metricLabel}>Est. Travel Time</Text>
                <Text style={[styles.metricVal, { color: '#22c55e' }]}>
                  {routeInfo?.durationFormatted || navigatingTo.durationFormatted}
                </Text>
              </View>
            </View>
            <BigButton
              title="Stop Guidance"
              icon="⏹"
              variant="red"
              style={{ marginTop: 10 }}
              onPress={() => {
                setNavigatingTo(null);
                setRouteInfo(null);
                speak('Navigation guidance stopped.');
              }}
            />
          </View>
        )}

        {/* POI Category Filter */}
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
                  speak(`Selected ${c.label}.`);
                  setSelectedCat(c.id);
                }}
                activeOpacity={0.7}
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
            <Text style={styles.loadingText}>
              Calculating accurate {activeModeObj.label.toLowerCase()} distances & directions…
            </Text>
          </View>
        ) : places.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyIcon}>🔍</Text>
            <Text style={styles.emptyText}>No results found in your immediate radius. Try another category.</Text>
          </View>
        ) : (
          places.map((p, idx) => (
            <View key={p.id || idx} style={styles.placeCard}>
              <View style={styles.placeInfo}>
                <Text style={styles.placeName}>{p.name}</Text>
                <View style={styles.placeMetaRow}>
                  <Text style={styles.placeDist}>
                    📍 {p.distanceFormatted} ({p.mode})
                  </Text>
                  <Text style={styles.placeDuration}>⏱️ {p.durationFormatted}</Text>
                  <Text style={styles.placeDirection}>🧭 {p.direction}</Text>
                </View>
                <Text style={styles.placeAddress} numberOfLines={2}>
                  {p.fullAddress}
                </Text>
              </View>

              <BigButton
                title={`Navigate (${p.mode})`}
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
  modeCard: {
    backgroundColor: '#0d1117',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 14,
  },
  modeHeader: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  modeBtn: {
    flex: 1,
    backgroundColor: '#161b22',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  modeBtnActive: {
    backgroundColor: 'rgba(34,197,94,0.18)',
    borderColor: '#22c55e',
  },
  modeIcon: {
    fontSize: 24,
    marginBottom: 4,
  },
  modeLabel: {
    color: '#d1d5db',
    fontSize: 13,
    fontWeight: '700',
  },
  modeLabelActive: {
    color: '#22c55e',
    fontWeight: '900',
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
    marginBottom: 8,
  },
  gpsDot: {
    fontSize: 18,
  },
  gpsTitle: {
    color: '#f9fafb',
    fontSize: 16,
    fontWeight: '800',
  },
  gpsAddress: {
    color: '#e5e7eb',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 8,
  },
  accuracyBadge: {
    backgroundColor: 'rgba(34,197,94,0.1)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginBottom: 10,
  },
  accuracyText: {
    color: '#4ade80',
    fontSize: 11,
    fontWeight: '600',
  },
  errorBox: {
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
  },
  errorText: {
    color: '#f87171',
    fontSize: 13,
    lineHeight: 18,
  },
  activeNavCard: {
    backgroundColor: 'rgba(167,139,250,0.12)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 2,
    borderColor: '#a78bfa',
    marginBottom: 16,
  },
  activeNavTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  activeNavTitle: {
    color: '#f9fafb',
    fontSize: 16,
    fontWeight: '800',
    flex: 1,
  },
  activeNavMode: {
    color: '#c4b5fd',
    fontSize: 13,
    fontWeight: '700',
  },
  activeNavDirection: {
    color: '#e2e8f0',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 12,
  },
  activeMetricsRow: {
    flexDirection: 'row',
    backgroundColor: '#0d1117',
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
    gap: 16,
  },
  metricItem: {
    flex: 1,
  },
  metricLabel: {
    color: '#9ca3af',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 2,
  },
  metricVal: {
    color: '#f9fafb',
    fontSize: 16,
    fontWeight: '800',
  },
  sectionTitle: {
    color: '#f9fafb',
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 10,
  },
  catScroll: {
    marginBottom: 16,
  },
  catChip: {
    backgroundColor: '#0d1117',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginRight: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  catChipActive: {
    backgroundColor: 'rgba(34,197,94,0.15)',
    borderColor: '#22c55e',
  },
  catIcon: {
    fontSize: 16,
  },
  catLabel: {
    color: '#9ca3af',
    fontSize: 13,
    fontWeight: '700',
  },
  catLabelActive: {
    color: '#22c55e',
  },
  loadingBox: {
    padding: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: '#9ca3af',
    marginTop: 10,
    fontSize: 13,
    textAlign: 'center',
  },
  emptyBox: {
    backgroundColor: '#0d1117',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  emptyIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  emptyText: {
    color: '#9ca3af',
    fontSize: 13,
    textAlign: 'center',
  },
  placeCard: {
    backgroundColor: '#0d1117',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
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
  placeMetaRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 6,
    flexWrap: 'wrap',
  },
  placeDist: {
    color: '#a78bfa',
    fontSize: 13,
    fontWeight: '700',
  },
  placeDuration: {
    color: '#22c55e',
    fontSize: 13,
    fontWeight: '700',
  },
  placeDirection: {
    color: '#facc15',
    fontSize: 13,
    fontWeight: '700',
  },
  placeAddress: {
    color: '#6b7280',
    fontSize: 12,
    lineHeight: 16,
  },
  navBtn: {
    width: '100%',
  },
});

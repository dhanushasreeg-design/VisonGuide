import React from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useAccessibility } from '../context/AccessibilityContext';
import Header from '../components/Header';

const MENU_ITEMS = [
  { id: 'Dashboard', label: 'Home Dashboard', icon: '🏠', color: '#22c55e', desc: 'Main hub & metrics' },
  { id: 'VoiceAssistant', label: 'Voice Assistant', icon: '🎤', color: '#facc15', desc: 'Spoken dialogue assistant' },
  { id: 'ObjectDetection', label: 'Object Detection', icon: '🔍', color: '#a78bfa', desc: 'Detect potholes & obstacles' },
  { id: 'CameraOCR', label: 'Camera OCR', icon: '📷', color: '#f472b6', desc: 'Scan & read text aloud' },
  { id: 'Navigation', label: 'GPS Navigation', icon: '🗺️', color: '#38bdf8', desc: 'Find nearby POIs & turn directions' },
  { id: 'SOSAlert', label: 'SOS Alert', icon: '🚨', color: '#ef4444', desc: 'Emergency dispatch & countdown' },
  { id: 'EmergencyContacts', label: 'Emergency Contacts', icon: '📞', color: '#22c55e', desc: 'Call helpers directly' },
  { id: 'SavedLocations', label: 'Saved Locations', icon: '📍', color: '#34d399', desc: 'Frequent destinations' },
  { id: 'ArticleReader', label: 'Article Reader', icon: '📖', color: '#60a5fa', desc: 'Speech knowledge base' },
  { id: 'Settings', label: 'Settings', icon: '⚙️', color: '#94a3b8', desc: 'Preferences, voice speed & lang' },
];

export default function MoreMenuScreen({ onNavigate, onBack }) {
  const { settings, triggerHaptic } = useAccessibility();
  const bB = settings.bigButtons || settings.accessibilityMode;

  const handleSelect = (screenId) => {
    triggerHaptic('light');
    onNavigate(screenId);
  };

  return (
    <View style={styles.container}>
      <Header title="All Features" showBack onBack={onBack} />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.sectionTitle}>Application Modules</Text>

        {MENU_ITEMS.map((item) => (
          <TouchableOpacity
            key={item.id}
            style={[
              styles.menuCard,
              {
                minHeight: bB ? 72 : 58,
                paddingVertical: bB ? 14 : 10,
              },
            ]}
            onPress={() => handleSelect(item.id)}
            accessibilityLabel={`${item.label}. ${item.desc}`}
          >
            <View style={[styles.iconBox, { backgroundColor: item.color + '20' }]}>
              <Text style={[styles.icon, { fontSize: bB ? 26 : 22 }]}>{item.icon}</Text>
            </View>

            <View style={styles.textCol}>
              <Text style={[styles.title, { fontSize: bB ? 17 : 15 }]}>{item.label}</Text>
              <Text style={styles.desc}>{item.desc}</Text>
            </View>

            <Text style={[styles.arrow, { color: item.color }]}>→</Text>
          </TouchableOpacity>
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
  sectionTitle: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  menuCard: {
    backgroundColor: '#0d1117',
    borderRadius: 14,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 12,
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    lineHeight: 28,
  },
  textCol: {
    flex: 1,
  },
  title: {
    color: '#f9fafb',
    fontWeight: '800',
    marginBottom: 2,
  },
  desc: {
    color: '#9ca3af',
    fontSize: 12,
  },
  arrow: {
    fontSize: 20,
    fontWeight: '900',
  },
});

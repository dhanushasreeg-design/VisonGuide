import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useAccessibility } from '../context/AccessibilityContext';
import Header from '../components/Header';
import BigButton from '../components/BigButton';

const STATS = [
  { label: 'Contacts', value: '4', icon: '📞', color: '#22c55e' },
  { label: 'Articles', value: '6', icon: '📖', color: '#60a5fa' },
  { label: 'Commands', value: '18', icon: '🎤', color: '#facc15' },
  { label: 'SOS Alerts', value: '2', icon: '🚨', color: '#ef4444' },
  { label: 'Locations', value: '5', icon: '📍', color: '#34d399' },
];

const SUGGESTIONS = [
  'navigate to hospital',
  'read contacts',
  'send sos',
  'read articles',
  'hotel near me',
  'scan for obstacles',
  'what time is it',
];

const NEARBY = [
  { icon: '🏥', label: 'Hospital', query: 'hospital' },
  { icon: '🏨', label: 'Hotel', query: 'hotel' },
  { icon: '🏧', label: 'ATM', query: 'atm' },
  { icon: '💊', label: 'Pharmacy', query: 'pharmacy' },
  { icon: '👮', label: 'Police', query: 'police' },
  { icon: '🚌', label: 'Bus Stop', query: 'bus' },
];

export default function DashboardScreen({ onNavigate }) {
  const { user } = useAuth();
  const { settings, speak, triggerHaptic } = useAccessibility();
  const bB = settings.bigButtons || settings.accessibilityMode;
  const [greeting, setGreeting] = useState('Hello');

  useEffect(() => {
    const h = new Date().getHours();
    const g = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    setGreeting(g);
    if (settings.voiceGuided) {
      speak(`${g}, ${user?.name || 'Explorer'}. Welcome to VisionGuide AI mobile.`);
    }
  }, []);

  return (
    <View style={styles.container}>
      <Header title="VisionGuide AI" />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Welcome Banner */}
        <View style={styles.welcomeCard}>
          <Text style={styles.greetingText}>
            {greeting}, <Text style={styles.greenText}>{user?.name || 'Explorer'}</Text> 👋
          </Text>
          <Text style={styles.subText}>Voice-guided assistant & mobile accessibility system</Text>

          <BigButton
            title="Start Voice Assistant"
            icon="🎤"
            variant="yellow"
            style={styles.voiceBtn}
            onPress={() => onNavigate('VoiceAssistant')}
          />
        </View>

        {/* Live Metrics Row */}
        <Text style={styles.sectionHeader}>📊 Dashboard Metrics</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.statsScroll}>
          {STATS.map((s) => (
            <View key={s.label} style={styles.statBox}>
              <Text style={styles.statIcon}>{s.icon}</Text>
              <Text style={[styles.statVal, { color: s.color }]}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </ScrollView>

        {/* Spoken Command Suggestion Chips */}
        <View style={styles.chipCard}>
          <Text style={styles.chipHeader}>💬 Spoken Commands (Tap to hear)</Text>
          <View style={styles.chipsRow}>
            {SUGGESTIONS.map((s) => (
              <TouchableOpacity
                key={s}
                style={styles.chip}
                onPress={() => speak(`You can say: ${s}`)}
                accessibilityLabel={`Command suggestion: ${s}. Tap to hear audio.`}
              >
                <Text style={styles.chipText}>🎤 {s}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Nearby Places Grid */}
        <Text style={styles.sectionHeader}>🗺️ Find Nearby Places</Text>
        <View style={styles.nearbyGrid}>
          {NEARBY.map((p) => (
            <TouchableOpacity
              key={p.query}
              style={[styles.nearbyCard, { minHeight: bB ? 90 : 78 }]}
              onPress={() => {
                speak(`Finding nearby ${p.label}.`);
                onNavigate('Navigation', { query: p.query });
              }}
              accessibilityLabel={`Find nearby ${p.label}`}
            >
              <Text style={styles.nearbyIcon}>{p.icon}</Text>
              <Text style={styles.nearbyTitle}>{p.label}</Text>
              <Text style={styles.nearbySub}>Near Me →</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Primary Features Quick Access */}
        <Text style={styles.sectionHeader}>⚡ Quick Access</Text>
        <View style={styles.quickGrid}>
          <TouchableOpacity
            style={[styles.featureCard, { borderColor: '#ef4444' }]}
            onPress={() => {
              triggerHaptic('medium');
              speak('Opening Emergency SOS Alert.');
              onNavigate('SOSAlert');
            }}
            accessibilityLabel="Open Emergency SOS Alert"
          >
            <Text style={styles.featureIcon}>🚨</Text>
            <Text style={[styles.featureTitle, { color: '#ef4444' }]}>SOS Alert</Text>
            <Text style={styles.featureDesc}>Emergency alerts & location</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.featureCard, { borderColor: '#a78bfa' }]}
            onPress={() => {
              triggerHaptic('medium');
              speak('Opening Live Object Detection.');
              onNavigate('ObjectDetection');
            }}
            accessibilityLabel="Open Live Object Detection"
          >
            <Text style={styles.featureIcon}>🔍</Text>
            <Text style={[styles.featureTitle, { color: '#a78bfa' }]}>Object Detection</Text>
            <Text style={styles.featureDesc}>Live obstacles & hazards</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.featureCard, { borderColor: '#f472b6' }]}
            onPress={() => {
              triggerHaptic('medium');
              speak('Opening Camera Text Reader.');
              onNavigate('CameraOCR');
            }}
            accessibilityLabel="Open Camera Text Reader"
          >
            <Text style={styles.featureIcon}>📷</Text>
            <Text style={[styles.featureTitle, { color: '#f472b6' }]}>Camera OCR</Text>
            <Text style={styles.featureDesc}>Scan & read text aloud</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.featureCard, { borderColor: '#22c55e' }]}
            onPress={() => {
              triggerHaptic('medium');
              speak('Opening Emergency Contacts.');
              onNavigate('EmergencyContacts');
            }}
            accessibilityLabel="Open Emergency Contacts"
          >
            <Text style={styles.featureIcon}>📞</Text>
            <Text style={[styles.featureTitle, { color: '#22c55e' }]}>Contacts</Text>
            <Text style={styles.featureDesc}>Call doctors & helpers</Text>
          </TouchableOpacity>
        </View>
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
  welcomeCard: {
    backgroundColor: '#0d1117',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 20,
  },
  greetingText: {
    color: '#f9fafb',
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 4,
  },
  greenText: {
    color: '#22c55e',
  },
  subText: {
    color: '#9ca3af',
    fontSize: 13,
    marginBottom: 14,
  },
  voiceBtn: {
    marginTop: 4,
  },
  sectionHeader: {
    color: '#f9fafb',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 12,
    marginTop: 8,
  },
  statsScroll: {
    marginBottom: 18,
  },
  statBox: {
    backgroundColor: '#0d1117',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    marginRight: 10,
    width: 90,
  },
  statIcon: {
    fontSize: 24,
    marginBottom: 4,
  },
  statVal: {
    fontSize: 22,
    fontWeight: '900',
  },
  statLabel: {
    color: '#9ca3af',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  chipCard: {
    backgroundColor: 'rgba(250,204,21,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(250,204,21,0.2)',
    borderRadius: 14,
    padding: 14,
    marginBottom: 20,
  },
  chipHeader: {
    color: '#facc15',
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 10,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },
  chipText: {
    color: '#d1d5db',
    fontSize: 12,
    fontWeight: '600',
  },
  nearbyGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 20,
  },
  nearbyCard: {
    width: '48%',
    backgroundColor: '#0d1117',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  nearbyIcon: {
    fontSize: 28,
    marginBottom: 4,
  },
  nearbyTitle: {
    color: '#f9fafb',
    fontSize: 13,
    fontWeight: '700',
  },
  nearbySub: {
    color: '#22c55e',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  featureCard: {
    width: '48%',
    backgroundColor: '#0d1117',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1.5,
  },
  featureIcon: {
    fontSize: 26,
    marginBottom: 6,
  },
  featureTitle: {
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 2,
  },
  featureDesc: {
    color: '#9ca3af',
    fontSize: 11,
  },
});


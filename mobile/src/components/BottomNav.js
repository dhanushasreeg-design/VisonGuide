import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Platform } from 'react-native';
import { useAccessibility } from '../context/AccessibilityContext';

export default function BottomNav({ activeScreen, onSelectScreen }) {
  const { settings, triggerHaptic, speak } = useAccessibility();
  const bB = settings.bigButtons || settings.accessibilityMode;

  const handlePress = (screenName, label) => {
    triggerHaptic('medium');
    speak(label || screenName);
    onSelectScreen(screenName);
  };

  return (
    <View style={[styles.bottomBar, { height: bB ? 72 : 62 }]}>
      {/* Home */}
      <TouchableOpacity
        style={styles.navItem}
        onPress={() => handlePress('Dashboard', 'Opening Home Dashboard')}
        accessibilityLabel="Home Dashboard"
        accessibilityRole="tab"
        accessibilityState={{ selected: activeScreen === 'Dashboard' }}
      >
        <Text style={[styles.icon, { fontSize: bB ? 24 : 20 }]}>🏠</Text>
        <Text style={[styles.label, activeScreen === 'Dashboard' && styles.labelActive]}>Home</Text>
      </TouchableOpacity>

      {/* Navigation */}
      <TouchableOpacity
        style={styles.navItem}
        onPress={() => handlePress('Navigation', 'Opening GPS Navigation Maps')}
        accessibilityLabel="Navigation Maps"
        accessibilityRole="tab"
        accessibilityState={{ selected: activeScreen === 'Navigation' }}
      >
        <Text style={[styles.icon, { fontSize: bB ? 24 : 20 }]}>🗺️</Text>
        <Text style={[styles.label, activeScreen === 'Navigation' && styles.labelActive]}>Map</Text>
      </TouchableOpacity>

      {/* Voice Assistant Center Button */}
      <TouchableOpacity
        style={[
          styles.voiceBtn,
          {
            width: bB ? 62 : 54,
            height: bB ? 62 : 54,
            top: bB ? -16 : -12,
          },
        ]}
        onPress={() => handlePress('VoiceAssistant', 'Opening Voice Assistant')}
        accessibilityLabel="Voice Assistant"
        accessibilityRole="button"
      >
        <Text style={[styles.voiceIcon, { fontSize: bB ? 30 : 26 }]}>🎤</Text>
      </TouchableOpacity>

      {/* SOS Alert */}
      <TouchableOpacity
        style={styles.navItem}
        onPress={() => handlePress('SOSAlert', 'Opening Emergency SOS Alert')}
        accessibilityLabel="SOS Emergency Alert"
        accessibilityRole="tab"
        accessibilityState={{ selected: activeScreen === 'SOSAlert' }}
      >
        <Text style={[styles.icon, { fontSize: bB ? 24 : 20 }]}>🚨</Text>
        <Text style={[styles.label, styles.sosLabel]}>SOS</Text>
      </TouchableOpacity>

      {/* More / Menu */}
      <TouchableOpacity
        style={styles.navItem}
        onPress={() => handlePress('MoreMenu', 'Opening More Features Menu')}
        accessibilityLabel="More options"
        accessibilityRole="tab"
        accessibilityState={{ selected: activeScreen === 'MoreMenu' }}
      >
        <Text style={[styles.icon, { fontSize: bB ? 24 : 20 }]}>☰</Text>
        <Text style={[styles.label, activeScreen === 'MoreMenu' && styles.labelActive]}>More</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  bottomBar: {
    backgroundColor: '#0d1117',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 8,
    paddingBottom: Platform.OS === 'ios' ? 14 : 4,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
  },
  icon: {
    marginBottom: 2,
  },
  label: {
    color: '#9ca3af',
    fontSize: 11,
    fontWeight: '600',
  },
  labelActive: {
    color: '#22c55e',
    fontWeight: '800',
  },
  sosLabel: {
    color: '#ef4444',
    fontWeight: '800',
  },
  voiceBtn: {
    backgroundColor: '#facc15',
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#facc15',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 8,
  },
  voiceIcon: {
    lineHeight: 32,
  },
});


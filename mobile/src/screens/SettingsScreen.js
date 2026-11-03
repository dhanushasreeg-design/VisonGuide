import React from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Switch,
  Platform,
} from 'react-native';
import { useAccessibility, LANGUAGES } from '../context/AccessibilityContext';
import { useAuth } from '../context/AuthContext';
import { BACKEND_BASE } from '../api/client';
import Header from '../components/Header';
import BigButton from '../components/BigButton';

export default function SettingsScreen({ onBack, onNavigate }) {
  const { settings, updateSettings, toggleAccessibility, speak } = useAccessibility();
  const { user, signOut } = useAuth();

  const handleSpeedChange = (spd) => {
    updateSettings('voiceSpeed', spd);
    speak(`Voice speed set to ${spd}x.`, { rate: spd });
  };

  const handleLangChange = (code, label) => {
    updateSettings('language', code);
    speak(`Language set to ${label}.`, { language: code });
  };

  return (
    <View style={styles.container}>
      <Header title="Preferences & Accessibility" showBack onBack={onBack} />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* User Card */}
        <View style={styles.userCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{user?.name?.charAt(0).toUpperCase() || 'U'}</Text>
          </View>
          <View style={styles.userInfo}>
            <Text style={styles.userName}>{user?.name || 'VisionGuide User'}</Text>
            <Text style={styles.userEmail}>{user?.email || 'user@visionguide.ai'}</Text>
          </View>
        </View>

        {/* Accessibility Master Controls */}
        <Text style={styles.sectionTitle}>♿ Accessibility Options</Text>
        <View style={styles.card}>
          <View style={styles.settingRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>Accessibility Mode</Text>
              <Text style={styles.settingSub}>Enlarges all icons, buttons, and touch targets</Text>
            </View>
            <Switch
              value={settings.accessibilityMode}
              onValueChange={toggleAccessibility}
              trackColor={{ false: '#374151', true: '#22c55e' }}
              thumbColor="#ffffff"
            />
          </View>

          <View style={styles.divider} />

          <View style={styles.settingRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>Spoken Audio Feedback</Text>
              <Text style={styles.settingSub}>Speaks screen titles & action confirmations</Text>
            </View>
            <Switch
              value={settings.voiceGuided}
              onValueChange={(v) => updateSettings('voiceGuided', v)}
              trackColor={{ false: '#374151', true: '#22c55e' }}
              thumbColor="#ffffff"
            />
          </View>
        </View>

        {/* Voice Speed */}
        <Text style={styles.sectionTitle}>🔊 Speech Speed</Text>
        <View style={styles.speedRow}>
          {[
            { label: '0.8x Slow', val: 0.8 },
            { label: '1.0x Normal', val: 1.0 },
            { label: '1.25x Fast', val: 1.25 },
          ].map((s) => {
            const active = settings.voiceSpeed === s.val;
            return (
              <TouchableOpacity
                key={s.label}
                style={[styles.speedBtn, active && styles.speedBtnActive]}
                onPress={() => handleSpeedChange(s.val)}
              >
                <Text style={[styles.speedBtnText, active && styles.speedBtnTextActive]}>
                  {s.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Language Selection */}
        <Text style={styles.sectionTitle}>🌐 Language</Text>
        <View style={styles.card}>
          {LANGUAGES.map((l) => {
            const active = settings.language === l.code;
            return (
              <TouchableOpacity
                key={l.code}
                style={[styles.langRow, active && styles.langRowActive]}
                onPress={() => handleLangChange(l.code, l.label)}
              >
                <Text style={[styles.langText, active && styles.langTextActive]}>{l.label}</Text>
                {active && <Text style={styles.checkIcon}>✓</Text>}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* System & Diagnostics */}
        <Text style={styles.sectionTitle}>🔧 Backend & Network</Text>
        <View style={styles.card}>
          <Text style={styles.diagLabel}>API Host Endpoint:</Text>
          <Text style={styles.diagValue}>{BACKEND_BASE}</Text>
          <Text style={styles.diagLabel}>Runtime Environment:</Text>
          <Text style={styles.diagValue}>Expo Go SDK 58 (React Native Native Engine)</Text>
        </View>

        {/* Sign Out */}
        <BigButton
          title="Sign Out"
          icon="🚪"
          variant="red"
          style={{ marginTop: 20 }}
          onPress={async () => {
            await signOut();
            speak('Signed out.');
          }}
        />
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
  userCard: {
    backgroundColor: '#0d1117',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(34,197,94,0.2)',
    borderWidth: 2,
    borderColor: '#22c55e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#22c55e',
    fontSize: 22,
    fontWeight: '900',
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    color: '#f9fafb',
    fontSize: 16,
    fontWeight: '800',
  },
  userEmail: {
    color: '#9ca3af',
    fontSize: 12,
  },
  sectionTitle: {
    color: '#f9fafb',
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 10,
    marginTop: 10,
  },
  card: {
    backgroundColor: '#0d1117',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 14,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  settingLabel: {
    color: '#f9fafb',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 2,
  },
  settingSub: {
    color: '#9ca3af',
    fontSize: 12,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginVertical: 12,
  },
  speedRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  speedBtn: {
    flex: 1,
    backgroundColor: '#0d1117',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  speedBtnActive: {
    borderColor: '#22c55e',
    backgroundColor: 'rgba(34,197,94,0.15)',
  },
  speedBtnText: {
    color: '#9ca3af',
    fontSize: 13,
    fontWeight: '700',
  },
  speedBtnTextActive: {
    color: '#22c55e',
    fontWeight: '800',
  },
  langRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  langRowActive: {
    backgroundColor: 'rgba(34,197,94,0.06)',
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  langText: {
    color: '#d1d5db',
    fontSize: 14,
    fontWeight: '600',
  },
  langTextActive: {
    color: '#22c55e',
    fontWeight: '800',
  },
  checkIcon: {
    color: '#22c55e',
    fontSize: 16,
    fontWeight: '900',
  },
  diagLabel: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4,
  },
  diagValue: {
    color: '#22c55e',
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginBottom: 6,
  },
});


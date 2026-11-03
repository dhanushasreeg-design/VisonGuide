import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { useAccessibility } from '../context/AccessibilityContext';

export default function Header({ title, onBack, showBack = false, rightAction }) {
  const { isSpeaking, stopSpeaking, toggleAccessibility, settings } = useAccessibility();

  return (
    <View style={styles.header}>
      <View style={styles.leftRow}>
        {showBack && (
          <TouchableOpacity
            style={styles.backBtn}
            onPress={onBack}
            accessibilityLabel="Go back"
            accessibilityRole="button"
          >
            <Text style={styles.backBtnText}>◀</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.title} numberOfLines={1}>
          {title || 'VisionGuide AI'}
        </Text>
      </View>

      <View style={styles.rightRow}>
        {isSpeaking && (
          <TouchableOpacity
            style={styles.speakingBadge}
            onPress={stopSpeaking}
            accessibilityLabel="Speaking. Tap to stop audio."
          >
            <Text style={styles.speakingDot}>🔊</Text>
            <Text style={styles.speakingText}>Stop</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.accessBadge, settings.accessibilityMode && styles.accessActive]}
          onPress={toggleAccessibility}
          accessibilityLabel={`Accessibility Mode ${settings.accessibilityMode ? 'ON' : 'OFF'}`}
          accessibilityRole="button"
        >
          <Text style={styles.accessIcon}>{settings.accessibilityMode ? '♿' : '⚙️'}</Text>
        </TouchableOpacity>

        {rightAction}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    height: 56,
    backgroundColor: '#0d1117',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
  },
  leftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
  },
  backBtn: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  backBtnText: {
    color: '#22c55e',
    fontSize: 16,
    fontWeight: '800',
  },
  title: {
    color: '#f9fafb',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.2,
    flexShrink: 1,
  },
  rightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  speakingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239,68,68,0.2)',
    borderWidth: 1,
    borderColor: '#ef4444',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 14,
    gap: 4,
  },
  speakingDot: {
    fontSize: 12,
  },
  speakingText: {
    color: '#f87171',
    fontSize: 11,
    fontWeight: '700',
  },
  accessBadge: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  accessActive: {
    borderColor: '#22c55e',
    backgroundColor: 'rgba(34,197,94,0.15)',
  },
  accessIcon: {
    fontSize: 16,
  },
});


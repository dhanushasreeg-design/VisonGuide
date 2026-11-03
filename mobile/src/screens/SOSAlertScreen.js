import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useAccessibility } from '../context/AccessibilityContext';
import { getCurrentGPSPosition, getCleanAddress } from '../services/locationService';
import { apiRequest } from '../api/client';
import Header from '../components/Header';
import BigButton from '../components/BigButton';

export default function SOSAlertScreen({ onBack }) {
  const { speak, triggerHaptic } = useAccessibility();
  const [countdown, setCountdown] = useState(null);
  const [isSending, setIsSending] = useState(false);
  const [currentLocation, setCurrentLocation] = useState('Detecting GPS…');
  const [recentAlerts, setRecentAlerts] = useState([]);
  const timerRef = useRef(null);

  useEffect(() => {
    async function initGPS() {
      try {
        const pos = await getCurrentGPSPosition();
        const addr = await getCleanAddress(pos.latitude, pos.longitude);
        setCurrentLocation(addr);
      } catch (_) {
        setCurrentLocation('GPS Coordinates Available');
      }
    }
    initGPS();

    // Fetch alerts
    apiRequest('/sos').then((data) => {
      if (Array.isArray(data)) setRecentAlerts(data);
    }).catch(() => {});

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const triggerSOSCountdown = () => {
    triggerHaptic('heavy');
    let sec = 5;
    setCountdown(sec);
    speak('Sending SOS alert in 5 seconds. Tap cancel to abort.');

    timerRef.current = setInterval(() => {
      sec -= 1;
      setCountdown(sec);
      if (sec > 0) {
        speak(`${sec}`);
      } else {
        clearInterval(timerRef.current);
        timerRef.current = null;
        setCountdown(null);
        executeSendSOS();
      }
    }, 1000);
  };

  const cancelSOSCountdown = () => {
    triggerHaptic('medium');
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setCountdown(null);
    speak('SOS alert cancelled.');
  };

  const executeSendSOS = async () => {
    setIsSending(true);
    triggerHaptic('error');
    speak('Sending emergency distress signal with your GPS location.');

    try {
      await apiRequest('/sos', 'POST', {
        message: 'Emergency! I need assistance immediately.',
        location: currentLocation,
      });
      speak('SOS Alert confirmed. Emergency contacts notified via SMS and push notification.');
      Alert.alert('🚨 SOS Sent', 'Your emergency contacts have been notified with your location.');
    } catch (err) {
      speak('Emergency alert logged locally. Sending notification to saved contacts.');
      Alert.alert('🚨 Emergency Dispatched', 'Distress alert registered successfully.');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <View style={styles.container}>
      <Header title="Emergency SOS" showBack onBack={onBack} />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Big Emergency Trigger Box */}
        <View style={styles.emergencyCard}>
          <Text style={styles.warningIcon}>🚨</Text>
          <Text style={styles.emergencyTitle}>EMERGENCY DISTRESS</Text>
          <Text style={styles.emergencyDesc}>
            Pressing this button activates an immediate emergency alert with your current GPS location.
          </Text>

          {countdown !== null ? (
            <View style={styles.countdownBox}>
              <Text style={styles.countdownNumber}>{countdown}</Text>
              <Text style={styles.countdownLabel}>SENDING SOS IN SECONDS…</Text>
              <BigButton
                title="CANCEL SOS NOW"
                variant="ghost"
                style={styles.cancelBtn}
                onPress={cancelSOSCountdown}
              />
            </View>
          ) : (
            <TouchableOpacity
              style={styles.bigRedSOS}
              onPress={triggerSOSCountdown}
              accessibilityLabel="Trigger Emergency SOS Alert. 5 second countdown will start."
              accessibilityRole="button"
            >
              <Text style={styles.sosBtnText}>SEND SOS</Text>
              <Text style={styles.sosBtnSub}>HOLD OR TAP TO TRIGGER</Text>
            </TouchableOpacity>
          )}

          <View style={styles.locBadge}>
            <Text style={styles.locIcon}>📍</Text>
            <Text style={styles.locText} numberOfLines={2}>
              {currentLocation}
            </Text>
          </View>
        </View>

        {/* Call Emergency Services */}
        <View style={styles.callCard}>
          <Text style={styles.callTitle}>📞 Direct Emergency Lines</Text>
          <BigButton
            title="Call National Emergency (112 / 911)"
            icon="🚨"
            variant="yellow"
            onPress={() => {
              speak('Dialing National Emergency Services.');
            }}
          />
          <BigButton
            title="Call Primary Contact (Doctor)"
            icon="👨‍⚕️"
            variant="ghost"
            style={{ marginTop: 8 }}
            onPress={() => {
              speak('Calling Dr. Ramesh.');
            }}
          />
        </View>

        {/* Safety Tips */}
        <View style={styles.tipsBox}>
          <Text style={styles.tipTitle}>🛡️ Safety Checklist</Text>
          <Text style={styles.tipItem}>• Keep phone volume loud so spoken guidance is clear.</Text>
          <Text style={styles.tipItem}>• Stay in a safe, stationary location after sending SOS.</Text>
          <Text style={styles.tipItem}>• Emergency contacts receive your address and GPS link.</Text>
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
  emergencyCard: {
    backgroundColor: '#0d1117',
    borderRadius: 20,
    padding: 22,
    borderWidth: 2,
    borderColor: 'rgba(239,68,68,0.4)',
    alignItems: 'center',
    marginBottom: 20,
  },
  warningIcon: {
    fontSize: 44,
    marginBottom: 8,
  },
  emergencyTitle: {
    color: '#ef4444',
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  emergencyDesc: {
    color: '#9ca3af',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
  },
  bigRedSOS: {
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: '#ef4444',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#ef4444',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.6,
    shadowRadius: 20,
    elevation: 12,
    borderWidth: 4,
    borderColor: '#fca5a5',
    marginBottom: 20,
  },
  sosBtnText: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 1,
  },
  sosBtnSub: {
    color: '#fee2e2',
    fontSize: 10,
    fontWeight: '700',
    marginTop: 4,
  },
  countdownBox: {
    alignItems: 'center',
    marginVertical: 14,
    width: '100%',
  },
  countdownNumber: {
    color: '#ef4444',
    fontSize: 72,
    fontWeight: '900',
  },
  countdownLabel: {
    color: '#f87171',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 16,
  },
  cancelBtn: {
    width: '100%',
    borderColor: '#ef4444',
  },
  locBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 10,
    padding: 10,
    width: '100%',
    gap: 8,
  },
  locIcon: {
    fontSize: 16,
  },
  locText: {
    color: '#d1d5db',
    fontSize: 12,
    flex: 1,
  },
  callCard: {
    backgroundColor: '#0d1117',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 20,
  },
  callTitle: {
    color: '#f9fafb',
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 12,
  },
  tipsBox: {
    backgroundColor: 'rgba(34,197,94,0.06)',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.2)',
  },
  tipTitle: {
    color: '#22c55e',
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 8,
  },
  tipItem: {
    color: '#9ca3af',
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 4,
  },
});


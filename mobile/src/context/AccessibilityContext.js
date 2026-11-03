import React, { createContext, useContext, useState, useEffect } from 'react';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';

const AccessibilityContext = createContext(null);
const SETTINGS_KEY = 'visionguide_native_accessibility_settings';

export const LANGUAGES = [
  { code: 'en-US', label: 'English' },
  { code: 'ta-IN', label: 'தமிழ் (Tamil)' },
  { code: 'hi-IN', label: 'हिंदी (Hindi)' },
  { code: 'te-IN', label: 'తెలుగు (Telugu)' },
];

export function AccessibilityProvider({ children }) {
  const [settings, setSettings] = useState({
    theme: 'dark',
    fontSize: 'normal',
    highContrast: false,
    bigButtons: true,
    accessibilityMode: true,
    language: 'en-US',
    voiceSpeed: 0.95,
    voiceGuided: true,
  });

  const [isSpeaking, setIsSpeaking] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(SETTINGS_KEY).then((data) => {
      if (data) {
        try {
          setSettings((prev) => ({ ...prev, ...JSON.parse(data) }));
        } catch (_) {}
      }
    });
  }, []);

  const updateSettings = async (key, val) => {
    const updated = { ...settings, [key]: val };
    setSettings(updated);
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
  };

  const toggleAccessibility = () => {
    const next = !settings.accessibilityMode;
    updateSettings('accessibilityMode', next);
    triggerHaptic('success');
    speak(next ? 'Accessibility mode activated.' : 'Accessibility mode deactivated.');
  };

  const speak = (text, customOpts = {}) => {
    if (!text) return;
    try {
      Speech.stop();
      setIsSpeaking(true);
      Speech.speak(text, {
        language: customOpts.language || settings.language || 'en-US',
        rate: customOpts.rate || settings.voiceSpeed || 0.95,
        pitch: 1.0,
        onDone: () => setIsSpeaking(false),
        onStopped: () => setIsSpeaking(false),
        onError: () => setIsSpeaking(false),
      });
    } catch (e) {
      setIsSpeaking(false);
    }
  };

  const stopSpeaking = () => {
    try {
      Speech.stop();
    } catch (_) {}
    setIsSpeaking(false);
  };

  const triggerHaptic = (type = 'light') => {
    try {
      if (type === 'success') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else if (type === 'error' || type === 'heavy') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } else if (type === 'warning') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      } else {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
    } catch (_) {}
  };

  return (
    <AccessibilityContext.Provider
      value={{
        settings,
        updateSettings,
        toggleAccessibility,
        speak,
        stopSpeaking,
        isSpeaking,
        triggerHaptic,
      }}
    >
      {children}
    </AccessibilityContext.Provider>
  );
}

export function useAccessibility() {
  const ctx = useContext(AccessibilityContext);
  if (!ctx) throw new Error('useAccessibility must be used within AccessibilityProvider');
  return ctx;
}

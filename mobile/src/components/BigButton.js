import React from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useAccessibility } from '../context/AccessibilityContext';

export default function BigButton({
  title,
  icon,
  onPress,
  variant = 'green',
  style,
  disabled = false,
  accessibilityLabel,
}) {
  const { settings, triggerHaptic, speak } = useAccessibility();
  const bB = settings.bigButtons || settings.accessibilityMode;

  const handlePress = () => {
    if (disabled) return;
    triggerHaptic('light');
    onPress?.();
  };

  const handleLongPress = () => {
    triggerHaptic('medium');
    speak(accessibilityLabel || title);
  };

  const getVariantStyle = () => {
    switch (variant) {
      case 'red':
        return styles.btnRed;
      case 'yellow':
        return styles.btnYellow;
      case 'ghost':
        return styles.btnGhost;
      case 'blue':
        return styles.btnBlue;
      default:
        return styles.btnGreen;
    }
  };

  const getTextColor = () => {
    if (variant === 'yellow' || variant === 'green') return '#000000';
    return '#ffffff';
  };

  return (
    <TouchableOpacity
      style={[
        styles.button,
        getVariantStyle(),
        {
          minHeight: bB ? 62 : 48,
          paddingVertical: bB ? 14 : 10,
          paddingHorizontal: bB ? 22 : 16,
          borderRadius: bB ? 14 : 10,
        },
        disabled && styles.btnDisabled,
        style,
      ]}
      onPress={handlePress}
      onLongPress={handleLongPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
    >
      {icon && <Text style={[styles.icon, { fontSize: bB ? 24 : 18 }]}>{icon}</Text>}
      <Text
        style={[
          styles.text,
          {
            color: getTextColor(),
            fontSize: bB ? 17 : 14,
            fontWeight: bB ? '800' : '700',
          },
        ]}
      >
        {title}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginVertical: 4,
  },
  btnGreen: {
    backgroundColor: '#22c55e',
  },
  btnRed: {
    backgroundColor: '#ef4444',
  },
  btnYellow: {
    backgroundColor: '#facc15',
  },
  btnBlue: {
    backgroundColor: '#3b82f6',
  },
  btnGhost: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  btnDisabled: {
    opacity: 0.5,
  },
  icon: {
    marginRight: 4,
  },
  text: {
    letterSpacing: -0.2,
  },
});

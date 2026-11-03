import React, { useState, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Linking,
} from 'react-native';
import { useAccessibility } from '../context/AccessibilityContext';
import { parseVoiceCommand } from '../services/speechService';
import Header from '../components/Header';
import BigButton from '../components/BigButton';

const QUICK_ACTIONS = [
  'call doctor',
  'call 112',
  'navigate to hospital',
  'read contacts',
  'send sos',
  'read articles',
  'what time is it',
  'scan for obstacles',
  'read camera text',
];

export default function VoiceAssistantScreen({ onNavigate, onBack }) {
  const { speak, stopSpeaking, isSpeaking, triggerHaptic } = useAccessibility();
  const [messages, setMessages] = useState([
    {
      id: '1',
      sender: 'assistant',
      text: 'Hello! I am your VisionGuide Voice Assistant. How can I assist you?',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const scrollViewRef = useRef(null);

  const handleSendCommand = (textToSend) => {
    const text = textToSend || inputText;
    if (!text.trim()) return;

    triggerHaptic('medium');
    const userMsg = {
      id: Date.now().toString(),
      sender: 'user',
      text: text.trim(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputText('');

    // Process command
    const res = parseVoiceCommand(text);

    setTimeout(() => {
      const assistantMsg = {
        id: (Date.now() + 1).toString(),
        sender: 'assistant',
        text: res.reply,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, assistantMsg]);
      speak(res.reply);

      if (res.type === 'navigate_screen' && res.screen) {
        setTimeout(() => {
          onNavigate(res.screen, res.params);
        }, 1200);
      } else if (res.type === 'call' && res.phone) {
        setTimeout(() => {
          Linking.openURL(`tel:${res.phone}`).catch((err) => {
            console.warn('Could not launch dialer:', err);
          });
        }, 1200);
      }
    }, 400);
  };

  const toggleMicListening = () => {
    triggerHaptic('heavy');
    if (isListening) {
      setIsListening(false);
      speak('Microphone stopped.');
    } else {
      setIsListening(true);
      speak('Listening. Please say your command.');
      // Auto-simulate listening completion for demonstration in Expo Go
      setTimeout(() => {
        setIsListening(false);
        handleSendCommand('navigate to hospital');
      }, 3500);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Header title="Voice Assistant" showBack onBack={onBack} />

      {/* Voice Control Top Panel */}
      <View style={styles.micCard}>
        <TouchableOpacity
          style={[styles.bigMicBtn, isListening && styles.micActive, isSpeaking && styles.micSpeaking]}
          onPress={toggleMicListening}
          accessibilityLabel={isListening ? 'Stop Listening' : 'Tap to speak command'}
          accessibilityRole="button"
        >
          <Text style={styles.micEmoji}>{isListening ? '🔴' : isSpeaking ? '🔊' : '🎤'}</Text>
          <Text style={styles.micStatusText}>
            {isListening ? 'LISTENING…' : isSpeaking ? 'SPEAKING' : 'TAP TO SPEAK'}
          </Text>
        </TouchableOpacity>

        {isSpeaking && (
          <TouchableOpacity style={styles.stopSpeechBtn} onPress={stopSpeaking}>
            <Text style={styles.stopSpeechText}>⏹ Stop Speaking</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Spoken Dialogue History */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.chatArea}
        contentContainerStyle={styles.chatContent}
        onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: true })}
      >
        {messages.map((m) => (
          <View
            key={m.id}
            style={[
              styles.bubble,
              m.sender === 'user' ? styles.bubbleUser : styles.bubbleAssistant,
            ]}
          >
            <Text style={styles.bubbleSender}>
              {m.sender === 'user' ? 'You' : 'VisionGuide'} · {m.time}
            </Text>
            <Text style={styles.bubbleText}>{m.text}</Text>
          </View>
        ))}
      </ScrollView>

      {/* Quick Action Chips */}
      <View style={styles.quickBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {QUICK_ACTIONS.map((cmd) => (
            <TouchableOpacity
              key={cmd}
              style={styles.quickChip}
              onPress={() => handleSendCommand(cmd)}
            >
              <Text style={styles.quickChipText}>⚡ {cmd}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Typed Input Fallback */}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder="Or type a voice command…"
          placeholderTextColor="#6b7280"
          value={inputText}
          onChangeText={setInputText}
          onSubmitEditing={() => handleSendCommand()}
        />
        <BigButton
          title="Send"
          variant="green"
          style={styles.sendBtn}
          onPress={() => handleSendCommand()}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#05080f',
  },
  micCard: {
    backgroundColor: '#0d1117',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    paddingVertical: 18,
  },
  bigMicBtn: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(34,197,94,0.12)',
    borderWidth: 3,
    borderColor: '#22c55e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  micActive: {
    borderColor: '#ef4444',
    backgroundColor: 'rgba(239,68,68,0.2)',
  },
  micSpeaking: {
    borderColor: '#60a5fa',
    backgroundColor: 'rgba(96,165,250,0.2)',
  },
  micEmoji: {
    fontSize: 44,
  },
  micStatusText: {
    color: '#22c55e',
    fontSize: 11,
    fontWeight: '800',
    marginTop: 4,
    letterSpacing: 0.5,
  },
  stopSpeechBtn: {
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: 'rgba(239,68,68,0.15)',
    borderWidth: 1,
    borderColor: '#ef4444',
  },
  stopSpeechText: {
    color: '#f87171',
    fontWeight: '700',
    fontSize: 12,
  },
  chatArea: {
    flex: 1,
  },
  chatContent: {
    padding: 16,
    gap: 12,
  },
  bubble: {
    maxWidth: '85%',
    padding: 12,
    borderRadius: 14,
  },
  bubbleAssistant: {
    backgroundColor: '#111827',
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  bubbleUser: {
    backgroundColor: 'rgba(34,197,94,0.18)',
    alignSelf: 'flex-end',
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.3)',
  },
  bubbleSender: {
    fontSize: 10,
    color: '#9ca3af',
    marginBottom: 4,
  },
  bubbleText: {
    color: '#f9fafb',
    fontSize: 14,
    lineHeight: 20,
  },
  quickBar: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  quickChip: {
    backgroundColor: '#0d1117',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
  },
  quickChipText: {
    color: '#d1d5db',
    fontSize: 12,
    fontWeight: '600',
  },
  inputRow: {
    flexDirection: 'row',
    padding: 12,
    gap: 8,
    backgroundColor: '#0d1117',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  input: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 10,
    paddingHorizontal: 14,
    color: '#f9fafb',
    fontSize: 14,
  },
  sendBtn: {
    minHeight: 44,
    paddingHorizontal: 16,
  },
});


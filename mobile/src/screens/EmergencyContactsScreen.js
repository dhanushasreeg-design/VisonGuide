import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useAccessibility } from '../context/AccessibilityContext';
import { apiRequest } from '../api/client';
import Header from '../components/Header';
import BigButton from '../components/BigButton';

export default function EmergencyContactsScreen({ onBack }) {
  const { speak, triggerHaptic } = useAccessibility();
  const [contacts, setContacts] = useState([
    { id: '1', name: 'Dr. Ramesh Kumar', relation: 'Family Physician', phone: '+91 98765 43210' },
    { id: '2', name: 'Ananya Sree', relation: 'Sister / Primary Caretaker', phone: '+91 98765 12345' },
    { id: '3', name: 'City Police Control', relation: 'Emergency Services', phone: '112' },
  ]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [name, setName] = useState('');
  const [relation, setRelation] = useState('');
  const [phone, setPhone] = useState('');

  useEffect(() => {
    apiRequest('/emergency')
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) setContacts(data);
      })
      .catch(() => {});
  }, []);

  const handleCall = (c) => {
    triggerHaptic('success');
    speak(`Calling ${c.name}, ${c.relation}, at ${c.phone}`);
    Alert.alert('📞 Direct Call', `Dialing ${c.name} (${c.phone})`);
  };

  const handleAdd = async () => {
    if (!name.trim() || !phone.trim()) {
      speak('Please provide both contact name and phone number.');
      return;
    }

    const newContact = {
      id: Date.now().toString(),
      name: name.trim(),
      relation: relation.trim() || 'Emergency Contact',
      phone: phone.trim(),
    };

    setContacts((prev) => [newContact, ...prev]);
    setName('');
    setRelation('');
    setPhone('');
    setShowAddForm(false);
    triggerHaptic('success');
    speak(`Added ${newContact.name} to your emergency contacts.`);

    // Persist to backend
    apiRequest('/emergency', 'POST', newContact).catch(() => {});
  };

  return (
    <View style={styles.container}>
      <Header title="Emergency Contacts" showBack onBack={onBack} />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <BigButton
          title={showAddForm ? 'Close Add Form' : 'Add New Emergency Contact'}
          icon={showAddForm ? '✕' : '➕'}
          variant={showAddForm ? 'ghost' : 'green'}
          onPress={() => setShowAddForm(!showAddForm)}
        />

        {showAddForm && (
          <View style={styles.formCard}>
            <Text style={styles.formTitle}>New Emergency Contact</Text>
            <TextInput
              style={styles.input}
              placeholder="Full Name (e.g. Sarah Smith)"
              placeholderTextColor="#6b7280"
              value={name}
              onChangeText={setName}
            />
            <TextInput
              style={styles.input}
              placeholder="Relationship (e.g. Sister, Doctor)"
              placeholderTextColor="#6b7280"
              value={relation}
              onChangeText={setRelation}
            />
            <TextInput
              style={styles.input}
              placeholder="Phone Number (e.g. +91 98765 00000)"
              placeholderTextColor="#6b7280"
              keyboardType="phone-pad"
              value={phone}
              onChangeText={setPhone}
            />
            <BigButton title="Save Contact" variant="green" onPress={handleAdd} />
          </View>
        )}

        <Text style={styles.sectionHeader}>Saved Contacts ({contacts.length})</Text>

        {contacts.map((c) => (
          <View key={c.id} style={styles.contactCard}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{c.name.charAt(0).toUpperCase()}</Text>
            </View>

            <View style={styles.info}>
              <Text style={styles.name}>{c.name}</Text>
              <Text style={styles.relation}>🤝 {c.relation}</Text>
              <Text style={styles.phone}>📞 {c.phone}</Text>
            </View>

            <TouchableOpacity
              style={styles.callBtn}
              onPress={() => handleCall(c)}
              accessibilityLabel={`Call ${c.name}`}
            >
              <Text style={styles.callIcon}>📞</Text>
            </TouchableOpacity>
          </View>
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
  formCard: {
    backgroundColor: '#0d1117',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    marginVertical: 14,
    gap: 10,
  },
  formTitle: {
    color: '#f9fafb',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 4,
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 10,
    padding: 12,
    color: '#f9fafb',
    fontSize: 14,
  },
  sectionHeader: {
    color: '#f9fafb',
    fontSize: 16,
    fontWeight: '800',
    marginTop: 16,
    marginBottom: 12,
  },
  contactCard: {
    backgroundColor: '#0d1117',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 12,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(34,197,94,0.15)',
    borderWidth: 1.5,
    borderColor: '#22c55e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#22c55e',
    fontSize: 20,
    fontWeight: '900',
  },
  info: {
    flex: 1,
  },
  name: {
    color: '#f9fafb',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 2,
  },
  relation: {
    color: '#34d399',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 2,
  },
  phone: {
    color: '#9ca3af',
    fontSize: 13,
  },
  callBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#22c55e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  callIcon: {
    fontSize: 20,
  },
});


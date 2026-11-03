import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
} from 'react-native';
import { useAccessibility } from '../context/AccessibilityContext';
import { apiRequest } from '../api/client';
import Header from '../components/Header';
import BigButton from '../components/BigButton';

export default function ArticleReaderScreen({ onBack }) {
  const { speak, stopSpeaking, isSpeaking } = useAccessibility();
  const [articles, setArticles] = useState([
    {
      id: '1',
      title: 'Guide to Safe Pedestrian Navigation',
      category: 'Mobility & Safety',
      summary: 'Learn key auditory cues, pedestrian signal chimes, and tactile pavement guides for city walking.',
      body: 'Pedestrian navigation for visually impaired individuals relies heavily on auditory spatial awareness. Listen for traffic patterns at intersections. Truncated domes on curb ramps indicate approaching street crossings.',
    },
    {
      id: '2',
      title: 'Emergency Preparedness & Caretaker SOS',
      category: 'Health & Security',
      summary: 'Best practices for setting up rapid emergency hotlines, GPS tracking, and medical alerts.',
      body: 'In emergency situations, quick response time is essential. Ensure your emergency contacts list includes family members, nearby neighbors, and local healthcare providers. Keep your phone charged and GPS enabled.',
    },
    {
      id: '3',
      title: 'Understanding Assistive AI & Voice Technologies',
      category: 'Technology',
      summary: 'How computer vision and machine learning empower independent living and barrier-free access.',
      body: 'Artificial intelligence transforms accessibility through on-device obstacle detection, optical character recognition, and real-time voice guidance. VisionGuide AI combines these capabilities into an integrated companion.',
    },
  ]);
  const [activeArticleId, setActiveArticleId] = useState(null);

  useEffect(() => {
    apiRequest('/articles')
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) setArticles(data);
      })
      .catch(() => {});
  }, []);

  const handleRead = (a) => {
    if (isSpeaking && activeArticleId === a.id) {
      stopSpeaking();
      setActiveArticleId(null);
    } else {
      setActiveArticleId(a.id);
      speak(`${a.title}. ${a.body}`);
    }
  };

  return (
    <View style={styles.container}>
      <Header title="Article Reader" showBack onBack={onBack} />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.headerText}>Accessible Knowledge Base ({articles.length})</Text>

        {articles.map((a) => {
          const readingThis = isSpeaking && activeArticleId === a.id;
          return (
            <View key={a.id} style={styles.card}>
              <View style={styles.catBadge}>
                <Text style={styles.catText}>🏷️ {a.category}</Text>
              </View>
              <Text style={styles.title}>{a.title}</Text>
              <Text style={styles.summary}>{a.summary}</Text>

              <BigButton
                title={readingThis ? 'Stop Reading' : 'Read Article Aloud'}
                icon={readingThis ? '⏹' : '🔊'}
                variant={readingThis ? 'red' : 'yellow'}
                style={{ marginTop: 10 }}
                onPress={() => handleRead(a)}
              />
            </View>
          );
        })}
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
  headerText: {
    color: '#f9fafb',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 14,
  },
  card: {
    backgroundColor: '#0d1117',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 14,
  },
  catBadge: {
    backgroundColor: 'rgba(96,165,250,0.12)',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    marginBottom: 8,
  },
  catText: {
    color: '#60a5fa',
    fontSize: 11,
    fontWeight: '700',
  },
  title: {
    color: '#f9fafb',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 6,
    lineHeight: 22,
  },
  summary: {
    color: '#9ca3af',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 6,
  },
});

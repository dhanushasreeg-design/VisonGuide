/**
 * VisionGuide AI Native Voice Command Engine
 * Matches spoken/typed phrases to navigation destinations, emergency alerts,
 * article reading, nearby searches, and system actions.
 */

export function parseVoiceCommand(rawText) {
  const text = (rawText || '').toLowerCase().trim().replace(/[.!?,]+$/, '').trim();

  // Stop / Silence
  if (/^(stop|quiet|silence|mute|stop speaking|stop reading)$/i.test(text)) {
    return { type: 'stop', reply: 'Speech stopped.' };
  }

  // Current Time
  if (text.includes('time') || text.includes('what time')) {
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return { type: 'time', reply: `The current time is ${timeStr}.` };
  }

  // Call Contact or Person or Number
  if (/\b(call|phone|dial|ring)\b/i.test(text)) {
    let target = text
      .replace(/\b(please|can you|could you|i want to|i need to|help me)\b/gi, '')
      .replace(/\b(call|phone|dial|ring)\b/gi, '')
      .replace(/\b(my|the|a|an|contact|person|number|mobile|phone number)\b/gi, '')
      .trim();

    const cleanDigits = target.replace(/[^0-9+]/g, '');
    let phoneToDial = '112';
    let personName = target || 'Emergency Services';

    if (cleanDigits.length >= 3) {
      phoneToDial = cleanDigits;
      personName = cleanDigits;
    } else if (/doctor|hospital|clinic/i.test(target)) {
      phoneToDial = '+919876543210';
      personName = 'Doctor';
    } else if (/police|cop/i.test(target)) {
      phoneToDial = '112';
      personName = 'Police';
    } else if (/ambulance|paramedic/i.test(target)) {
      phoneToDial = '108';
      personName = 'Ambulance';
    } else if (/mom|mother|dad|father|sister|brother|family|caregiver/i.test(target)) {
      phoneToDial = '+919876512345';
      personName = target || 'Family Caregiver';
    } else if (target) {
      phoneToDial = '+919876543210';
      personName = target;
    }

    return {
      type: 'call',
      phone: phoneToDial,
      name: personName,
      reply: `Calling ${personName}. Dialing ${phoneToDial} now.`,
    };
  }

  // Contacts
  if (text.includes('contact') || text.includes('who to call') || text.includes('emergency contact')) {
    return { type: 'navigate_screen', screen: 'EmergencyContacts', reply: 'Opening your Emergency Contacts.' };
  }

  // SOS Alert
  if (text === 'sos' || text.includes('emergency') || text.includes('send sos') || text.includes('need help')) {
    return { type: 'navigate_screen', screen: 'SOSAlert', reply: 'Opening emergency SOS screen.' };
  }

  // Navigation / Maps
  if (text.includes('navigate') || text.includes('directions') || text.includes('map') || text.includes('route')) {
    const dest = text.replace(/navigate to|go to|directions to|route to|map for/gi, '').trim();
    return {
      type: 'navigate_screen',
      screen: 'Navigation',
      params: { destination: dest },
      reply: dest ? `Routing navigation to ${dest}.` : 'Opening GPS Navigation.',
    };
  }

  // Nearby POIs
  if (text.includes('hospital') || text.includes('doctor')) {
    return { type: 'navigate_screen', screen: 'Navigation', params: { query: 'hospital' }, reply: 'Searching for nearby hospitals.' };
  }
  if (text.includes('pharmacy') || text.includes('chemist') || text.includes('medicine')) {
    return { type: 'navigate_screen', screen: 'Navigation', params: { query: 'pharmacy' }, reply: 'Searching for nearby pharmacies.' };
  }
  if (text.includes('atm') || text.includes('bank') || text.includes('cash')) {
    return { type: 'navigate_screen', screen: 'Navigation', params: { query: 'atm' }, reply: 'Locating nearest ATMs.' };
  }
  if (text.includes('police') || text.includes('station')) {
    return { type: 'navigate_screen', screen: 'Navigation', params: { query: 'police' }, reply: 'Finding nearby police stations.' };
  }
  if (text.includes('bus') || text.includes('transit')) {
    return { type: 'navigate_screen', screen: 'Navigation', params: { query: 'bus' }, reply: 'Locating nearby bus stops.' };
  }

  // Object Detection & Hazards
  if (text.includes('object') || text.includes('detect') || text.includes('scan room') || text.includes('obstacle') || text.includes('hazard')) {
    return { type: 'navigate_screen', screen: 'ObjectDetection', reply: 'Launching Object Detection and Hazard Scanner.' };
  }

  // Camera OCR / Read Text
  if (text.includes('camera') || text.includes('read text') || text.includes('scan document') || text.includes('ocr')) {
    return { type: 'navigate_screen', screen: 'CameraOCR', reply: 'Opening Camera OCR Reader.' };
  }

  // Saved Locations
  if (text.includes('location') || text.includes('saved place')) {
    return { type: 'navigate_screen', screen: 'SavedLocations', reply: 'Opening your Saved Locations.' };
  }

  // Articles
  if (text.includes('article') || text.includes('read news') || text.includes('story')) {
    return { type: 'navigate_screen', screen: 'ArticleReader', reply: 'Opening Article Reader.' };
  }

  // Settings
  if (text.includes('setting') || text.includes('preference') || text.includes('accessibility mode')) {
    return { type: 'navigate_screen', screen: 'Settings', reply: 'Opening Settings.' };
  }

  // Help
  if (text.includes('help') || text.includes('commands') || text.includes('what can you do')) {
    return {
      type: 'help',
      reply: 'You can say: navigate to hospital, read contacts, send SOS, scan objects, read text, what time is it, or open saved locations.',
    };
  }

  // Default response
  return {
    type: 'unknown',
    reply: `I heard: "${text}". You can ask to navigate, call contacts, send SOS, or scan objects.`,
  };
}


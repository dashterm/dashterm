import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { AppSettings } from '../../types';

interface Props {
  // Dashboard-wide settings, threaded in via AppComponentProps. May be
  // undefined before the layout has loaded — fall back to sensible defaults.
  appSettings?: AppSettings;
  onUpdate?: (updates: Partial<AppSettings>) => void;
}

const DATE_FORMATS: { value: AppSettings['dateFormat']; label: string }[] = [
  { value: 'US', label: 'US (January 3, 2026)' },
  { value: 'UK', label: 'UK (3 January 2026)' },
  { value: 'ISO', label: 'ISO (2026-01-03)' },
];

export default function AppSettingsApp({ appSettings, onUpdate }: Props) {
  const dateFormat = appSettings?.dateFormat || 'US';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>DATE FORMAT</Text>
        <View style={styles.options}>
          {DATE_FORMATS.map((option) => {
            const active = dateFormat === option.value;
            return (
              <Pressable
                key={option.value}
                style={[styles.option, active && styles.optionActive]}
                onPress={() => onUpdate?.({ dateFormat: option.value })}
              >
                <View style={styles.radio}>
                  {active && <View style={styles.radioInner} />}
                </View>
                <Text style={[styles.label, active && styles.labelActive]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 4 },
  section: { marginBottom: 8 },
  sectionLabel: {
    fontFamily: 'Courier New',
    fontSize: 11,
    color: '#00ffff',
    letterSpacing: 1,
    marginBottom: 10,
  },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#001a1a',
    borderWidth: 1,
    borderColor: '#004444',
    borderRadius: 4,
  },
  optionActive: {
    borderColor: '#00ffff',
    backgroundColor: '#002222',
  },
  radio: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#004444',
    marginRight: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#00ffff',
  },
  label: {
    fontFamily: 'Courier New',
    fontSize: 11,
    color: '#888888',
  },
  labelActive: { color: '#00ffff' },
});

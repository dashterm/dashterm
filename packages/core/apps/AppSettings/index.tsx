import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { AppSettings } from '../../types';
import { useUpdateStatus } from '../../hooks/useUpdateStatus';

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

      <UpdateSection />
    </ScrollView>
  );
}

function UpdateSection() {
  const { status, running, checking, error, check, runUpdate } = useUpdateStatus();

  const current = status?.currentVersion ?? '?';
  const lastChecked = status?.checkedAt
    ? new Date(status.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>SOFTWARE UPDATE</Text>

      <View style={styles.updateRow}>
        <Text style={styles.versionText}>
          Current <Text style={styles.versionValue}>v{current}</Text>
        </Text>
        <Pressable
          style={({ pressed }) => [
            styles.checkBtn,
            checking && styles.checkBtnDisabled,
            pressed && !checking && styles.btnPressed,
          ]}
          onPress={() => {
            if (!checking) void check();
          }}
          disabled={checking}
        >
          <Text style={styles.checkBtnText}>
            {checking ? 'CHECKING…' : '[ CHECK FOR UPDATES ]'}
          </Text>
        </Pressable>
      </View>

      {error ? (
        <Text style={styles.updateError}>✗ {error}</Text>
      ) : status?.available ? (
        <View style={styles.resultRow}>
          <Text style={styles.updateAvailable}>▲ Update available — v{status.latestVersion ?? '?'}</Text>
          {running ? (
            <Text style={styles.updatingText}>UPDATING… (gateway will restart)</Text>
          ) : status.canApply ? (
            <Pressable
              style={({ pressed }) => [styles.updateNowBtn, pressed && styles.btnPressed]}
              onPress={() => void runUpdate()}
            >
              <Text style={styles.updateNowText}>[ UPDATE NOW ]</Text>
            </Pressable>
          ) : (
            <Text style={styles.updateHint}>
              run <Text style={styles.cmd}>dashterm update</Text>
            </Text>
          )}
        </View>
      ) : status && !status.supported ? (
        <Text style={styles.updateDim}>{status.reason || 'Updates not available for this install.'}</Text>
      ) : status ? (
        <Text style={styles.updateDim}>
          You're on the latest version{lastChecked ? ` · checked ${lastChecked}` : ''}.
        </Text>
      ) : null}
    </View>
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

  // Software update
  updateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
  },
  versionText: { fontFamily: 'Courier New', fontSize: 11, color: '#888888' },
  versionValue: { color: '#00ffff' },
  btnPressed: { opacity: 0.6 },
  checkBtn: {
    borderWidth: 1,
    borderColor: '#00ffff',
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: 'rgba(0, 255, 255, 0.08)',
  },
  checkBtnDisabled: { borderColor: '#004444', backgroundColor: '#001a1a' },
  checkBtnText: {
    fontFamily: 'Courier New',
    fontSize: 11,
    fontWeight: 'bold',
    color: '#00ffff',
    letterSpacing: 1,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 10,
  },
  updateAvailable: {
    fontFamily: 'Courier New',
    fontSize: 11,
    color: '#ffff00',
    letterSpacing: 1,
  },
  updatingText: { fontFamily: 'Courier New', fontSize: 11, color: '#00ffff', letterSpacing: 1 },
  updateNowBtn: {
    borderWidth: 1,
    borderColor: '#00ffff',
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: 'rgba(0, 255, 255, 0.08)',
  },
  updateNowText: {
    fontFamily: 'Courier New',
    fontSize: 11,
    fontWeight: 'bold',
    color: '#00ffff',
    letterSpacing: 1,
  },
  updateHint: { fontFamily: 'Courier New', fontSize: 11, color: '#999900' },
  cmd: { color: '#00ffff' },
  updateError: {
    fontFamily: 'Courier New',
    fontSize: 11,
    color: '#ff5555',
    marginTop: 10,
  },
  updateDim: {
    fontFamily: 'Courier New',
    fontSize: 11,
    color: '#888888',
    marginTop: 10,
  },
});

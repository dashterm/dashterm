import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from 'react-native';
import { EventLink, CustomApp } from '../../types';
import { appEventBus, AppEvent, getAllEmittedEvents, getAllAIFunctions } from '../../registry';

interface Props {
  appState?: any;
  onUpdate?: (updates: any) => void;
  eventLinks?: EventLink[];
  updateEventLinks?: (links: EventLink[]) => void;
  customApps?: Record<string, CustomApp>;
}

type Tab = 'monitor' | 'links' | 'create';

const POLL_MS = 1000;

// A target an event link can fire: a built-in app AI function, or a custom-app
// function (named `{appNameSanitized}_{fn}` so the existing dispatch resolves it).
interface TargetOption {
  app: string;        // built-in appId or custom-app share code
  action: string;     // function name to put in EventLink.targetAction
  label: string;      // human label for the picker
  custom: boolean;
}

// Sanitize a custom app's name the same way the function dispatcher does
// (handleCustomAppFunction), so the prefixed name round-trips back to the app.
function sanitizeAppName(name: string): string {
  return (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export default function EventsSubsystem({ eventLinks, updateEventLinks, customApps }: Props) {
  const [tab, setTab] = useState<Tab>('monitor');
  // Drives a re-read of the (non-reactive) event bus while the monitor is open.
  const [, setTick] = useState(0);

  useEffect(() => {
    if (tab !== 'monitor') return;
    const id = setInterval(() => setTick((t) => t + 1), POLL_MS);
    return () => clearInterval(id);
  }, [tab]);

  const links = eventLinks || [];
  const apps = customApps || {};

  // Resolve a source app id (built-in id or custom-app share code) to a label.
  const nameForSource = (sourceApp: string) => apps[sourceApp]?.name || sourceApp;

  return (
    <View style={styles.container}>
      <View style={styles.tabBar}>
        <TabButton label="◉ MONITOR" active={tab === 'monitor'} onPress={() => setTab('monitor')} />
        <TabButton label={`⇄ LINKS (${links.length})`} active={tab === 'links'} onPress={() => setTab('links')} />
        <TabButton label="+ CREATE" active={tab === 'create'} onPress={() => setTab('create')} />
      </View>

      <View style={styles.banner}>
        <Text style={styles.bannerText}>
          ⚠ LOCAL TO THIS TAB — events are in-memory and do not sync across browser tabs or devices.
        </Text>
      </View>

      {tab === 'monitor' && <MonitorPanel nameForSource={nameForSource} />}
      {tab === 'links' && (
        <LinksPanel links={links} updateEventLinks={updateEventLinks} nameForSource={nameForSource} />
      )}
      {tab === 'create' && (
        <CreatePanel
          links={links}
          updateEventLinks={updateEventLinks}
          customApps={apps}
          onCreated={() => setTab('links')}
        />
      )}
    </View>
  );
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.tab, active && styles.tabActive]} onPress={onPress}>
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}

/* ----------------------------- MONITOR ----------------------------- */

function MonitorPanel({ nameForSource }: { nameForSource: (s: string) => string }) {
  // Read fresh each render; the parent re-renders on a 1s tick while open.
  const events: AppEvent[] = appEventBus.getRecentEvents(100).slice().reverse();
  const patterns: string[] = appEventBus.getRegisteredPatterns();

  const fmtTime = (ts: number) => {
    const d = new Date(ts);
    const pad = (n: number) => `${n}`.padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };
  const preview = (data: any) => {
    try {
      const s = JSON.stringify(data);
      if (!s || s === '{}' || s === 'null') return '';
      return s.length > 120 ? `${s.slice(0, 120)}…` : s;
    } catch {
      return '';
    }
  };

  return (
    <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
      <Text style={styles.sectionLabel}>+-- ACTIVE LISTENERS ({patterns.length}) --+</Text>
      {patterns.length === 0 ? (
        <Text style={styles.dim}>No active subscriptions.</Text>
      ) : (
        <View style={styles.patternWrap}>
          {patterns.map((p) => (
            <View key={p} style={styles.patternChip}>
              <Text style={styles.patternChipText}>{p}</Text>
            </View>
          ))}
        </View>
      )}

      <Text style={[styles.sectionLabel, { marginTop: 16 }]}>+-- RECENT EVENTS ({events.length}) --+</Text>
      {events.length === 0 ? (
        <Text style={styles.dim}>
          No events yet. When an app calls events.emit(...) it appears here (newest first).
        </Text>
      ) : (
        events.map((e, i) => (
          <View key={`${e.timestamp}-${i}`} style={styles.eventRow}>
            <Text style={styles.eventTime}>{fmtTime(e.timestamp)}</Text>
            <View style={styles.eventMain}>
              <Text style={styles.eventType}>
                {e.type}
                <Text style={styles.eventSource}>  ◂ {nameForSource(e.sourceApp)}</Text>
              </Text>
              {!!preview(e.data) && <Text style={styles.eventData}>{preview(e.data)}</Text>}
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

/* ------------------------------ LINKS ------------------------------ */

function LinksPanel({
  links,
  updateEventLinks,
  nameForSource,
}: {
  links: EventLink[];
  updateEventLinks?: (links: EventLink[]) => void;
  nameForSource: (s: string) => string;
}) {
  const toggle = (id: string) =>
    updateEventLinks?.(links.map((l) => (l.id === id ? { ...l, enabled: !l.enabled } : l)));
  const remove = (id: string) => updateEventLinks?.(links.filter((l) => l.id !== id));

  return (
    <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
      {links.length === 0 ? (
        <Text style={styles.dim}>
          No automations yet. Use + CREATE to wire one app's event to another app's action.
        </Text>
      ) : (
        links.map((l) => (
          <View key={l.id} style={styles.linkCard}>
            <View style={styles.linkHeader}>
              <Text style={[styles.linkStatus, l.enabled ? styles.on : styles.off]}>
                {l.enabled ? '● ON ' : '○ OFF'}
              </Text>
              <Text style={styles.linkName} numberOfLines={1}>{l.name}</Text>
            </View>
            <Text style={styles.linkLine}>
              WHEN <Text style={styles.code}>{l.sourceEvent}</Text>{' '}
              <Text style={styles.dim}>({nameForSource(l.sourceEvent.split(':')[0])})</Text>
            </Text>
            <Text style={styles.linkLine}>
              DO <Text style={styles.code}>{l.targetAction}</Text> in{' '}
              <Text style={styles.code}>{nameForSource(l.targetApp)}</Text>
            </Text>
            {Object.keys(l.actionParams || {}).length > 0 && (
              <Text style={styles.linkParams}>params: {JSON.stringify(l.actionParams)}</Text>
            )}
            <View style={styles.linkActions}>
              <Pressable style={styles.smallBtn} onPress={() => toggle(l.id)}>
                <Text style={styles.smallBtnText}>{l.enabled ? 'DISABLE' : 'ENABLE'}</Text>
              </Pressable>
              <Pressable style={[styles.smallBtn, styles.dangerBtn]} onPress={() => remove(l.id)}>
                <Text style={[styles.smallBtnText, styles.dangerText]}>DELETE</Text>
              </Pressable>
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

/* ------------------------------ CREATE ----------------------------- */

function CreatePanel({
  links,
  updateEventLinks,
  customApps,
  onCreated,
}: {
  links: EventLink[];
  updateEventLinks?: (links: EventLink[]) => void;
  customApps: Record<string, CustomApp>;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [sourceEvent, setSourceEvent] = useState('');
  const [target, setTarget] = useState<TargetOption | null>(null);
  const [params, setParams] = useState<Array<{ key: string; value: string }>>([]);
  const [error, setError] = useState<string | null>(null);

  // Source event suggestions: built-in declared emits + observed custom-app events.
  const sourceSuggestions = useMemo(() => {
    const builtIn = getAllEmittedEvents().map((e) => `${e.appId}:${e.event.name}`);
    const observed = Array.from(
      new Set(appEventBus.getRecentEvents(100).map((e) => e.type))
    );
    return Array.from(new Set([...builtIn, ...observed]));
  }, []);

  // Target options: built-in AI functions + every custom-app function.
  const targetOptions = useMemo<TargetOption[]>(() => {
    const builtIn: TargetOption[] = getAllAIFunctions().map((f) => ({
      app: f.appId,
      action: f.definition.name,
      label: `${f.appId} → ${f.definition.name}`,
      custom: false,
    }));
    const custom: TargetOption[] = [];
    for (const [id, app] of Object.entries(customApps)) {
      const prefix = sanitizeAppName(app.name);
      for (const fn of app.functions || []) {
        custom.push({
          app: id,
          action: `${prefix}_${fn.name}`,
          label: `${app.name} → ${fn.name}`,
          custom: true,
        });
      }
    }
    return [...custom, ...builtIn];
  }, [customApps]);

  const addParam = () => setParams((p) => [...p, { key: '', value: '' }]);
  const setParam = (i: number, patch: Partial<{ key: string; value: string }>) =>
    setParams((p) => p.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  const removeParam = (i: number) => setParams((p) => p.filter((_, idx) => idx !== i));

  const submit = () => {
    setError(null);
    const src = sourceEvent.trim();
    if (!name.trim()) return setError('Give the automation a name.');
    if (!src || !src.includes(':')) return setError('Source event must look like  appId:eventName');
    if (!target) return setError('Pick a target action.');

    const actionParams: Record<string, any> = {};
    for (const { key, value } of params) {
      if (key.trim()) actionParams[key.trim()] = value;
    }

    const newLink: EventLink = {
      id: `link_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: name.trim(),
      sourceEvent: src,
      targetApp: target.app,
      targetAction: target.action,
      actionParams,
      enabled: true,
      createdAt: Date.now(),
    };
    updateEventLinks?.([...links, newLink]);
    onCreated();
  };

  return (
    <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
      <Text style={styles.fieldLabel}>NAME</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="e.g. Refresh prices when stock updates"
        placeholderTextColor="#0a5a5a"
      />

      <Text style={styles.fieldLabel}>WHEN — SOURCE EVENT</Text>
      <TextInput
        style={styles.input}
        value={sourceEvent}
        onChangeText={setSourceEvent}
        placeholder="appId:eventName  (e.g. K7XM2:priceDrop)"
        placeholderTextColor="#0a5a5a"
        autoCapitalize="none"
      />
      {sourceSuggestions.length > 0 && (
        <View style={styles.chipWrap}>
          {sourceSuggestions.map((s) => (
            <Pressable key={s} style={styles.suggestChip} onPress={() => setSourceEvent(s)}>
              <Text style={styles.suggestChipText}>{s}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <Text style={styles.fieldLabel}>DO — TARGET ACTION</Text>
      {targetOptions.length === 0 ? (
        <Text style={styles.dim}>No callable actions found (no built-in functions or custom-app functions).</Text>
      ) : (
        <View style={styles.targetList}>
          {targetOptions.map((t) => {
            const selected = target?.app === t.app && target?.action === t.action;
            return (
              <Pressable
                key={`${t.app}:${t.action}`}
                style={[styles.targetRow, selected && styles.targetRowSelected]}
                onPress={() => setTarget(t)}
              >
                <Text style={[styles.targetText, selected && styles.targetTextSelected]}>
                  {t.custom ? '◆ ' : '○ '}{t.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      <View style={styles.paramHeader}>
        <Text style={styles.fieldLabel}>PARAMS (optional)</Text>
        <Pressable style={styles.smallBtn} onPress={addParam}>
          <Text style={styles.smallBtnText}>+ ADD</Text>
        </Pressable>
      </View>
      <Text style={styles.hint}>Use $event.fieldName to pass data from the event payload.</Text>
      {params.map((row, i) => (
        <View key={i} style={styles.paramRow}>
          <TextInput
            style={[styles.input, styles.paramKey]}
            value={row.key}
            onChangeText={(v) => setParam(i, { key: v })}
            placeholder="key"
            placeholderTextColor="#0a5a5a"
            autoCapitalize="none"
          />
          <TextInput
            style={[styles.input, styles.paramValue]}
            value={row.value}
            onChangeText={(v) => setParam(i, { value: v })}
            placeholder="value or $event.x"
            placeholderTextColor="#0a5a5a"
            autoCapitalize="none"
          />
          <Pressable style={[styles.smallBtn, styles.dangerBtn]} onPress={() => removeParam(i)}>
            <Text style={[styles.smallBtnText, styles.dangerText]}>×</Text>
          </Pressable>
        </View>
      ))}

      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable style={styles.createBtn} onPress={submit}>
        <Text style={styles.createBtnText}>[ CREATE AUTOMATION ]</Text>
      </Pressable>
    </ScrollView>
  );
}

/* ------------------------------ STYLES ----------------------------- */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  tabBar: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#004444' },
  tab: { paddingVertical: 8, paddingHorizontal: 14, borderRightWidth: 1, borderRightColor: '#002222' },
  tabActive: { backgroundColor: '#002a2a' },
  tabText: { fontFamily: 'Courier New', fontSize: 11, color: '#007a7a', letterSpacing: 1 },
  tabTextActive: { color: '#00ffff', fontWeight: 'bold' },

  banner: { backgroundColor: '#1a1400', borderBottomWidth: 1, borderBottomColor: '#3a2f00', paddingVertical: 5, paddingHorizontal: 12 },
  bannerText: { fontFamily: 'Courier New', fontSize: 10, color: '#ffcc00' },

  body: { flex: 1 },
  bodyContent: { padding: 12, paddingBottom: 40 },

  sectionLabel: { fontFamily: 'Courier New', fontSize: 11, color: '#00ffff', marginBottom: 8 },
  dim: { fontFamily: 'Courier New', fontSize: 11, color: '#557777', lineHeight: 16 },

  patternWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  patternChip: { borderWidth: 1, borderColor: '#005555', borderRadius: 3, paddingHorizontal: 6, paddingVertical: 2, backgroundColor: '#001818' },
  patternChipText: { fontFamily: 'Courier New', fontSize: 10, color: '#00cccc' },

  eventRow: { flexDirection: 'row', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: '#001818' },
  eventTime: { fontFamily: 'Courier New', fontSize: 10, color: '#557777', width: 64 },
  eventMain: { flex: 1 },
  eventType: { fontFamily: 'Courier New', fontSize: 11, color: '#00ff00' },
  eventSource: { color: '#557777', fontSize: 10 },
  eventData: { fontFamily: 'Courier New', fontSize: 10, color: '#888888', marginTop: 1 },

  linkCard: { borderWidth: 1, borderColor: '#005555', borderRadius: 4, padding: 10, marginBottom: 10, backgroundColor: '#001212' },
  linkHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: 8 },
  linkStatus: { fontFamily: 'Courier New', fontSize: 10, fontWeight: 'bold' },
  on: { color: '#00ff00' },
  off: { color: '#666666' },
  linkName: { fontFamily: 'Courier New', fontSize: 12, color: '#00ffff', flex: 1 },
  linkLine: { fontFamily: 'Courier New', fontSize: 11, color: '#99cccc', marginTop: 2 },
  linkParams: { fontFamily: 'Courier New', fontSize: 10, color: '#557777', marginTop: 4 },
  code: { color: '#ffff00' },
  linkActions: { flexDirection: 'row', gap: 8, marginTop: 8 },

  smallBtn: { borderWidth: 1, borderColor: '#00aaaa', borderRadius: 3, paddingHorizontal: 8, paddingVertical: 3 },
  smallBtnText: { fontFamily: 'Courier New', fontSize: 10, color: '#00cccc' },
  dangerBtn: { borderColor: '#aa3333' },
  dangerText: { color: '#ff5555' },

  fieldLabel: { fontFamily: 'Courier New', fontSize: 11, color: '#00ffff', marginTop: 12, marginBottom: 4 },
  input: {
    borderWidth: 1, borderColor: '#005555', borderRadius: 3, paddingHorizontal: 8, paddingVertical: 6,
    fontFamily: 'Courier New', fontSize: 12, color: '#00ffcc', backgroundColor: '#001010',
  },
  hint: { fontFamily: 'Courier New', fontSize: 10, color: '#557777', marginBottom: 6 },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  suggestChip: { borderWidth: 1, borderColor: '#004444', borderRadius: 3, paddingHorizontal: 6, paddingVertical: 2, backgroundColor: '#001414' },
  suggestChipText: { fontFamily: 'Courier New', fontSize: 10, color: '#00aaaa' },

  targetList: { borderWidth: 1, borderColor: '#003333', borderRadius: 3 },
  targetRow: { paddingVertical: 6, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: '#001818' },
  targetRowSelected: { backgroundColor: '#003030' },
  targetText: { fontFamily: 'Courier New', fontSize: 11, color: '#99cccc' },
  targetTextSelected: { color: '#00ffff', fontWeight: 'bold' },

  paramHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  paramRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  paramKey: { flex: 1 },
  paramValue: { flex: 2 },

  error: { fontFamily: 'Courier New', fontSize: 11, color: '#ff5555', marginTop: 12 },

  createBtn: { marginTop: 18, borderWidth: 1, borderColor: '#00ff00', borderRadius: 4, paddingVertical: 10, alignItems: 'center', backgroundColor: '#001a00' },
  createBtnText: { fontFamily: 'Courier New', fontSize: 12, color: '#00ff00', fontWeight: 'bold', letterSpacing: 1 },
});

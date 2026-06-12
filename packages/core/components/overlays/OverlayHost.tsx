import React from 'react';
import { View, Text, StyleSheet, Modal, Pressable, Platform, KeyboardAvoidingView } from 'react-native';
import AgenticCoder from '../../apps/AgenticCoder';
import Scheduler from '../../apps/Scheduler';
import EventsSubsystem from '../../apps/EventsSubsystem';
import { EventLink, CustomApp } from '../../types';

export type OverlayKind = 'coder' | 'scheduler' | 'events';

interface OverlayHostProps {
  open: OverlayKind | null;
  onClose: () => void;
  // Global agentic coder slice
  agenticCoderState: any;
  updateAgenticCoder: (updates: any) => void;
  // Global scheduler slice
  schedulerState: any;
  updateScheduler: (updates: any) => void;
  // Global events-subsystem slice (persisted overlay prefs; mostly the overlay
  // reads live bus data + eventLinks rather than this).
  eventsState?: any;
  updateEvents?: (updates: any) => void;
  // Cross-app event links + custom-app registry, for the EVENTS SUBSYSTEM view.
  eventLinks?: EventLink[];
  updateEventLinks?: (links: EventLink[]) => void;
  customApps?: Record<string, CustomApp>;
  // Workspace filtering: names of workspaces whose apps appear in the
  // currently-active Space, computed by the parent from customApps'
  // originWorkspace field. Empty array / undefined → don't apply filtering.
  relatedWorkspaceNames?: string[];
}

export default function OverlayHost({
  open,
  onClose,
  agenticCoderState,
  updateAgenticCoder,
  schedulerState,
  updateScheduler,
  eventsState,
  updateEvents,
  eventLinks,
  updateEventLinks,
  customApps,
  relatedWorkspaceNames,
}: OverlayHostProps) {
  if (!open) return null;

  const title =
    open === 'coder' ? 'AGENTIC CODER' :
    open === 'scheduler' ? 'SCHEDULER' :
    'EVENTS SUBSYSTEM';

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* KAV sits between the backdrop and the modal so the whole frame
            slides up when the iOS keyboard appears. Without this the
            AgenticCoder / Scheduler text inputs sit under the keyboard. */}
        <KeyboardAvoidingView
          style={styles.kav}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          pointerEvents="box-none"
        >
          <Pressable style={styles.modal} onPress={(e) => e.stopPropagation()}>
            <View style={styles.frame}>
              <View style={styles.header}>
                <Text style={styles.title}>{title}</Text>
                <Pressable style={styles.closeBtn} onPress={onClose}>
                  <Text style={styles.closeBtnText}>[ × ]</Text>
                </Pressable>
              </View>
              <View style={styles.body}>
                {open === 'coder' ? (
                  <AgenticCoder
                    appState={agenticCoderState || {}}
                    onUpdate={updateAgenticCoder}
                    relatedWorkspaceNames={relatedWorkspaceNames}
                  />
                ) : open === 'scheduler' ? (
                  <Scheduler
                    appState={schedulerState || {}}
                    onUpdate={updateScheduler}
                    relatedWorkspaceNames={relatedWorkspaceNames}
                  />
                ) : (
                  <EventsSubsystem
                    appState={eventsState || {}}
                    onUpdate={updateEvents}
                    eventLinks={eventLinks}
                    updateEventLinks={updateEventLinks}
                    customApps={customApps}
                  />
                )}
              </View>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  kav: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modal: {
    width: '100%',
    maxWidth: 1000,
    height: '90%',
    maxHeight: 900,
  },
  frame: {
    flex: 1,
    backgroundColor: '#001111',
    borderWidth: 2,
    borderColor: '#00ffff',
    borderRadius: 8,
    overflow: 'hidden',
    ...(Platform.OS === 'web' ? {
      boxShadow: '0 0 30px rgba(0, 255, 255, 0.5)',
    } : {
      shadowColor: '#00ffff',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.5,
      shadowRadius: 15,
    }),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#004444',
    backgroundColor: '#002a2a',
  },
  title: {
    fontFamily: 'Courier New',
    fontSize: 13,
    color: '#00ffff',
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  closeBtn: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  closeBtnText: {
    fontFamily: 'Courier New',
    fontSize: 12,
    color: '#00ffff',
  },
  body: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
});

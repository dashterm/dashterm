import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';

interface TerminalPanelProps {
  children: React.ReactNode;
  header?: string;
  style?: any;
}

export default function TerminalPanel({ children, header, style }: TerminalPanelProps) {
  return (
    <View style={[styles.panel, style]}>
      {header && (
        <Text style={styles.panelHeader}>► {header.toUpperCase()}</Text>
      )}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderWidth: 2,
    borderColor: '#00ffff',
    backgroundColor: 'rgba(0, 20, 20, 0.8)',
    padding: 15,
    marginBottom: 20,
    ...(Platform.OS === 'web' ? {
      boxShadow: '0 0 16px rgba(0, 255, 255, 0.2)'
    } : {
      shadowColor: '#00ffff',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.2,
      shadowRadius: 8,
    }),
  },
  panelHeader: {
    fontFamily: 'Courier New',
    fontSize: 12,
    letterSpacing: 1,
    color: '#00ffff',
    marginBottom: 15,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#00ffff',
    fontWeight: 'bold',
  },
});
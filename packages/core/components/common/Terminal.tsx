import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, Platform, TouchableOpacity } from 'react-native';

export interface CommandHistoryEntry {
  cmd: string;
  response: string;
}

interface TerminalProps {
  onCommand: (command: string) => Promise<string> | string;
  commandHistory: CommandHistoryEntry[];
  onHistoryChange: (history: CommandHistoryEntry[]) => void;
  placeholder?: string;
  footerLeft?: string;
  footerCenter?: string;
  footerRight?: string;
  primaryColor?: string;
  maxHistoryDisplay?: number;
  /** If true, the onCommand handler manages history updates itself (for apps that store history in persisted state) */
  externalHistoryManagement?: boolean;
}

export default function Terminal({
  onCommand,
  commandHistory,
  onHistoryChange,
  placeholder = 'Type HELP for commands...',
  footerLeft = 'MEM: 640K OK',
  footerCenter,
  footerRight,
  primaryColor = '#00FF00',
  maxHistoryDisplay = 5,
  externalHistoryManagement = false,
}: TerminalProps) {
  const [commandInput, setCommandInput] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [cursorVisible, setCursorVisible] = useState(true);
  const historyScrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);

  // Cursor blink effect
  useEffect(() => {
    const interval = setInterval(() => setCursorVisible(v => !v), 530);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll history to bottom when new entries added
  useEffect(() => {
    if (showHistory && historyScrollRef.current) {
      setTimeout(() => {
        historyScrollRef.current?.scrollToEnd({ animated: true });
      }, 50);
    }
  }, [commandHistory, showHistory]);

  const handleSubmit = async () => {
    const cmd = commandInput.trim();
    if (!cmd) return;

    // Handle CLEAR command internally (only if not externally managed)
    if (cmd.toUpperCase() === 'CLEAR' && !externalHistoryManagement) {
      onHistoryChange([]);
      setCommandInput('');
      // Refocus the input after clearing
      setTimeout(() => inputRef.current?.focus(), 0);
      return;
    }

    const response = await onCommand(cmd);

    // Only update history if not externally managed and we got a response
    if (!externalHistoryManagement && response) {
      onHistoryChange([...commandHistory, { cmd, response }]);
    }

    // Show history if we got a response (or if externally managed, show it anyway)
    if (response || externalHistoryManagement) {
      setShowHistory(true);
    }

    setCommandInput('');

    // Refocus the input after command execution
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const dynamicStyles = {
    historyPanel: {
      borderColor: primaryColor,
      borderWidth: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.9)',
    },
    commandText: {
      color: '#00FFFF',
    },
    responseText: {
      color: primaryColor,
    },
    toggleText: {
      color: primaryColor,
    },
    cursor: {
      color: primaryColor,
    },
  };

  return (
    <View style={styles.container}>
      {/* Collapsible Command History */}
      {showHistory && commandHistory.length > 0 && (
        <View style={[styles.historyPanel, dynamicStyles.historyPanel]}>
          <ScrollView
            ref={historyScrollRef}
            style={styles.historyScroll}
            showsVerticalScrollIndicator={true}
          >
            {commandHistory.slice(-maxHistoryDisplay).map((entry, i) => (
              <View key={i} style={styles.historyEntry}>
                <Text style={[styles.commandText, dynamicStyles.commandText]}>$ {entry.cmd}</Text>
                <Text style={[styles.responseText, dynamicStyles.responseText]}>{entry.response}</Text>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Command Input - always visible */}
      <View style={styles.inputPanel}>
        <TouchableOpacity
          style={styles.toggleButton}
          onPress={() => setShowHistory(!showHistory)}
        >
          <Text style={[styles.toggleText, dynamicStyles.toggleText]}>
            {showHistory ? '▼' : '▲'}
          </Text>
        </TouchableOpacity>
        <Text style={styles.prompt}>$</Text>
        <TextInput
          ref={inputRef}
          style={styles.commandInput}
          value={commandInput}
          onChangeText={setCommandInput}
          onSubmitEditing={handleSubmit}
          placeholder={placeholder}
          placeholderTextColor="#004444"
          autoCapitalize="none"
          returnKeyType="send"
        />
        <Text style={[styles.cursor, dynamicStyles.cursor, { opacity: cursorVisible ? 1 : 0 }]}>_</Text>
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>{footerLeft}</Text>
        {footerCenter && <Text style={styles.footerText}>{footerCenter}</Text>}
        {footerRight && <Text style={styles.footerText}>{footerRight}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexShrink: 0,
    borderTopWidth: 1,
    borderTopColor: '#333333',
    backgroundColor: '#0a0a0a',
    padding: 10,
  },
  historyPanel: {
    maxHeight: 200,
    marginBottom: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  historyScroll: {
    padding: 10,
  },
  historyEntry: {
    marginBottom: 10,
  },
  commandText: {
    fontFamily: 'Courier New',
    fontSize: 11,
  },
  responseText: {
    fontFamily: 'Courier New',
    fontSize: 11,
    marginTop: 3,
    ...(Platform.OS === 'web' ? {
      whiteSpace: 'pre-wrap',
    } : {}),
  },
  inputPanel: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  toggleButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 5,
  },
  toggleText: {
    fontFamily: 'Courier New',
    fontSize: 12,
  },
  prompt: {
    fontFamily: 'Courier New',
    fontSize: 14,
    color: '#00FFFF',
    marginRight: 10,
  },
  commandInput: {
    flex: 1,
    fontFamily: 'Courier New',
    fontSize: 13,
    color: '#00FF00',
    backgroundColor: 'transparent',
    padding: 0,
  },
  cursor: {
    fontFamily: 'Courier New',
    fontSize: 14,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: '#333333',
    paddingTop: 6,
    paddingBottom: 2,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footerText: {
    fontFamily: 'Courier New',
    fontSize: 10,
    color: '#666666',
  },
});

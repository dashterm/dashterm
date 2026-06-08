import React from 'react';
import { TextInput, Text, View, StyleSheet } from 'react-native';

interface TerminalInputProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  label?: string;
  multiline?: boolean;
  keyboardType?: 'default' | 'numeric' | 'email-address';
  style?: any;
}

export default function TerminalInput({
  value,
  onChangeText,
  placeholder,
  label,
  multiline = false,
  keyboardType = 'default',
  style
}: TerminalInputProps) {
  return (
    <View style={style}>
      {label && (
        <Text style={styles.label}>{label.toUpperCase()}:</Text>
      )}
      <TextInput
        style={[styles.input, multiline && styles.multilineInput]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#004444"
        multiline={multiline}
        keyboardType={keyboardType}
        textAlignVertical={multiline ? 'top' : 'center'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontFamily: 'Courier New',
    fontSize: 11,
    color: '#00cccc',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: '#00ffff',
    color: '#00ffff',
    padding: 12,
    fontFamily: 'Courier New',
    fontSize: 13,
  },
  multilineInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
});
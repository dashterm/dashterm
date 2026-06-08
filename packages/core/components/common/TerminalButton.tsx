import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';

interface TerminalButtonProps {
  onPress: () => void;
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'danger' | 'success';
  disabled?: boolean;
  style?: any;
}

export default function TerminalButton({
  onPress,
  children,
  variant = 'primary',
  disabled = false,
  style
}: TerminalButtonProps) {
  const buttonStyle = [
    styles.button,
    styles[variant],
    disabled && styles.disabled,
    style
  ];

  const textStyle = [
    styles.buttonText,
    styles[`${variant}Text`],
    disabled && styles.disabledText
  ];

  return (
    <TouchableOpacity
      style={buttonStyle}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={textStyle}>{children}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    paddingHorizontal: 15,
    paddingVertical: 8,
    minWidth: 120,
  },
  buttonText: {
    fontFamily: 'Courier New',
    fontSize: 11,
    textAlign: 'center',
    letterSpacing: 1,
    fontWeight: 'bold',
  },

  // Variants
  primary: {
    borderColor: '#00ffff',
  },
  primaryText: {
    color: '#00ffff',
  },

  secondary: {
    borderColor: '#00cccc',
  },
  secondaryText: {
    color: '#00cccc',
  },

  success: {
    borderColor: '#00ff00',
  },
  successText: {
    color: '#00ff00',
  },

  danger: {
    borderColor: '#ff0000',
  },
  dangerText: {
    color: '#ff0000',
  },

  // States
  disabled: {
    borderColor: '#333333',
  },
  disabledText: {
    color: '#333333',
  },
});
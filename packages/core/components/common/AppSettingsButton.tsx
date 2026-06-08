import React, { useState, useCallback } from 'react';
import {
  TouchableOpacity,
  Text,
  View,
  Modal,
  StyleSheet,
  ScrollView,
  Platform,
  Pressable,
} from 'react-native';
import { AppDefinition } from '../../registry/types';

interface AppSettingsButtonProps {
  appDefinition: AppDefinition;
  appState: any;
  onUpdateState: (updates: any) => void;
}

export default function AppSettingsButton({
  appDefinition,
  appState,
  onUpdateState
}: AppSettingsButtonProps) {
  const [showModal, setShowModal] = useState(false);

  // Only show button if app has settings
  if (!appDefinition.settings?.renderSettings) {
    return null;
  }

  const handleClose = useCallback(() => {
    setShowModal(false);
  }, []);

  return (
    <>
      <TouchableOpacity
        onPress={(e) => {
          e.stopPropagation();
          setShowModal(true);
        }}
        style={styles.button}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Text style={styles.buttonText}>⚙</Text>
      </TouchableOpacity>

      <Modal
        visible={showModal}
        transparent
        animationType="fade"
        onRequestClose={handleClose}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={handleClose}
        >
          <Pressable
            style={styles.modalContent}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {appDefinition.icon} {appDefinition.title} Settings
              </Text>
              <TouchableOpacity
                onPress={handleClose}
                style={styles.closeButton}
              >
                <Text style={styles.closeButtonText}>×</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              {appDefinition.settings.renderSettings({
                state: appState,
                updateState: onUpdateState,
                onClose: handleClose,
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: 8,
  },
  buttonText: {
    fontFamily: 'Courier New',
    fontSize: 10,
    color: '#00ffff',
    fontWeight: 'bold',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#0a0a0a',
    borderWidth: 2,
    borderColor: '#00ffff',
    borderRadius: 4,
    width: '100%',
    maxWidth: 500,
    maxHeight: '80%',
    ...(Platform.OS === 'web'
      ? {
          boxShadow: '0 0 30px rgba(0, 255, 255, 0.3)',
        }
      : {
          shadowColor: '#00ffff',
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.3,
          shadowRadius: 15,
        }),
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#00ffff',
    paddingHorizontal: 15,
    paddingVertical: 12,
    backgroundColor: 'rgba(0, 255, 255, 0.1)',
  },
  modalTitle: {
    fontFamily: 'Courier New',
    fontSize: 14,
    color: '#00ffff',
    fontWeight: 'bold',
  },
  closeButton: {
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButtonText: {
    fontFamily: 'Courier New',
    fontSize: 20,
    color: '#00ffff',
    fontWeight: 'bold',
  },
  modalBody: {
    padding: 15,
  },
});

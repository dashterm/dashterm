import React, { useState } from 'react';
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

interface AppInfoButtonProps {
  appDefinition: AppDefinition;
}

export default function AppInfoButton({ appDefinition }: AppInfoButtonProps) {
  const [showModal, setShowModal] = useState(false);

  const functionCount = appDefinition.aiFunctions?.length || 0;
  const emitsCount = appDefinition.events?.emits?.length || 0;
  const listensCount = appDefinition.events?.listens?.length || 0;
  const queryableCount = appDefinition.queryableData?.length || 0;
  const totalCount = functionCount + emitsCount + listensCount + queryableCount;

  if (totalCount === 0) {
    return null;
  }

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
        <Text style={styles.buttonText}>
          ⚡{totalCount}
        </Text>
      </TouchableOpacity>

      <Modal
        visible={showModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowModal(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setShowModal(false)}
        >
          <Pressable
            style={styles.modalContent}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {appDefinition.icon} {appDefinition.title}
              </Text>
              <TouchableOpacity
                onPress={() => setShowModal(false)}
                style={styles.closeButton}
              >
                <Text style={styles.closeButtonText}>×</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              {/* AI Functions Section */}
              {functionCount > 0 && (
                <View style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionIcon}>⚡</Text>
                    <Text style={styles.sectionTitle}>AI FUNCTIONS ({functionCount})</Text>
                  </View>
                  {appDefinition.aiFunctions?.map((fn) => (
                    <View key={fn.definition.name} style={styles.item}>
                      <Text style={styles.itemName}>{fn.definition.name}()</Text>
                      <Text style={styles.itemDesc}>{fn.definition.description}</Text>
                      {fn.definition.parameters?.required?.length > 0 && (
                        <Text style={styles.itemParams}>
                          Required: {fn.definition.parameters.required.join(', ')}
                        </Text>
                      )}
                    </View>
                  ))}
                </View>
              )}

              {/* Events Emitted Section */}
              {emitsCount > 0 && (
                <View style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionIcon}>📤</Text>
                    <Text style={styles.sectionTitle}>EVENTS EMITTED ({emitsCount})</Text>
                  </View>
                  {appDefinition.events?.emits?.map((evt) => (
                    <View key={evt.name} style={styles.item}>
                      <Text style={styles.itemName}>{appDefinition.id}:{evt.name}</Text>
                      <Text style={styles.itemDesc}>{evt.description}</Text>
                      {evt.dataSchema?.properties && (
                        <Text style={styles.itemParams}>
                          Payload: {Object.keys(evt.dataSchema.properties).join(', ')}
                        </Text>
                      )}
                    </View>
                  ))}
                </View>
              )}

              {/* Events Listened Section */}
              {listensCount > 0 && (
                <View style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionIcon}>📥</Text>
                    <Text style={styles.sectionTitle}>LISTENS TO ({listensCount})</Text>
                  </View>
                  {appDefinition.events?.listens?.map((listener, i) => (
                    <View key={i} style={styles.item}>
                      <Text style={styles.itemName}>{listener.eventPattern}</Text>
                      <Text style={styles.itemDesc}>{listener.description}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Queryable Data Section */}
              {queryableCount > 0 && (
                <View style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionIcon}>🔍</Text>
                    <Text style={styles.sectionTitle}>QUERYABLE DATA ({queryableCount})</Text>
                  </View>
                  {appDefinition.queryableData?.map((queryable) => (
                    <View key={queryable.schema.name} style={styles.item}>
                      <Text style={styles.itemName}>{queryable.schema.name}</Text>
                      <Text style={styles.itemDesc}>{queryable.schema.description}</Text>
                      <Text style={styles.itemParams}>
                        Fields: {Object.keys(queryable.schema.fields).join(', ')}
                      </Text>
                      {queryable.schema.examples && queryable.schema.examples.length > 0 && (
                        <Text style={styles.itemExamples}>
                          Example: "{queryable.schema.examples[0]}"
                        </Text>
                      )}
                    </View>
                  ))}
                </View>
              )}

              {/* No capabilities */}
              {totalCount === 0 && (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyText}>
                    This app has no AI functions or events registered.
                  </Text>
                </View>
              )}
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
    color: '#ffff00',
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
  section: {
    marginBottom: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    paddingBottom: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  sectionIcon: {
    fontSize: 14,
    marginRight: 8,
  },
  sectionTitle: {
    fontFamily: 'Courier New',
    fontSize: 11,
    color: '#00ff00',
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  item: {
    backgroundColor: 'rgba(0, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 4,
    padding: 10,
    marginBottom: 8,
  },
  itemName: {
    fontFamily: 'Courier New',
    fontSize: 12,
    color: '#ffff00',
    fontWeight: 'bold',
    marginBottom: 4,
  },
  itemDesc: {
    fontFamily: 'Courier New',
    fontSize: 11,
    color: '#aaaaaa',
    lineHeight: 16,
  },
  itemParams: {
    fontFamily: 'Courier New',
    fontSize: 10,
    color: '#666666',
    marginTop: 4,
    fontStyle: 'italic',
  },
  itemExamples: {
    fontFamily: 'Courier New',
    fontSize: 10,
    color: '#00ffff',
    marginTop: 4,
    fontStyle: 'italic',
  },
  emptyState: {
    padding: 20,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: 'Courier New',
    fontSize: 12,
    color: '#666666',
    textAlign: 'center',
  },
});

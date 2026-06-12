import React, { useState, useEffect, useRef, useMemo } from 'react';
import { View, Text, StyleSheet, Modal, TextInput, ScrollView, Platform, Pressable } from 'react-native';
import { getAllApps } from '../../registry';
import { Space, CustomApp } from '../../types';

interface Command {
  id: string;
  title: string;
  description: string;
  action: () => void;
  category: string;
  keywords?: string[];
}

interface CommandPaletteProps {
  visible: boolean;
  onClose: () => void;
  onAddApp: (appId: string) => void;
  onRemoveApp: (appId: string) => void;
  activeApps: string[];
  // Custom apps
  customApps?: Record<string, CustomApp>;
  onDeleteCustomApp?: (appId: string) => void;
  // Space management props
  spaces?: Space[];
  activeSpaceId?: string;
  onSwitchSpace?: (spaceId: string) => void;
  onCreateSpace?: () => void;
  onDeleteSpace?: (spaceId: string) => void;
  onRenameSpace?: (spaceId: string, name: string, icon?: string) => void;
  onUpdateSpaceGrid?: (spaceId: string, columns: number, rows: number) => void;
  // Global overlays — pinned to the top of the palette. Mobile uses these
  // since there's no keyboard for the CMD-K leader. The shortcut hints
  // appear next to the entries for desktop discoverability.
  onOpenCoder?: () => void;
  onOpenScheduler?: () => void;
  onOpenEvents?: () => void;
  onOpenSettings?: () => void;
}

export default function CommandPalette({
  visible,
  onClose,
  onAddApp,
  onRemoveApp,
  activeApps,
  customApps = {},
  onDeleteCustomApp,
  spaces = [],
  activeSpaceId,
  onSwitchSpace,
  onCreateSpace,
  onDeleteSpace,
  onRenameSpace,
  onUpdateSpaceGrid,
  onOpenCoder,
  onOpenScheduler,
  onOpenEvents,
  onOpenSettings,
}: CommandPaletteProps) {
  const [searchText, setSearchText] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [renameMode, setRenameMode] = useState<{ spaceId: string; currentName: string } | null>(null);
  const [renameText, setRenameText] = useState('');
  const inputRef = useRef<TextInput>(null);

  // Generate commands from registry and spaces
  const commands = useMemo((): Command[] => {
    const cmds: Command[] = [];

    // Global overlays — pinned at the top. Direct shortcut hints in the
    // description text for desktop users; mobile gets the same entry as
    // its primary opener.
    const isMac =
      Platform.OS === 'web' &&
      typeof navigator !== 'undefined' &&
      navigator.platform.indexOf('Mac') !== -1;
    const mod = isMac ? '⌘' : 'Ctrl';
    if (onOpenCoder) {
      cmds.push({
        id: 'open-agentic-coder',
        title: 'Open Agentic Coder',
        description: `Vibe-code and chat with Claude  (${mod}+J)`,
        category: 'Overlays',
        // Don't call onClose here: palette + coder share the same overlay
        // state, so openOverlay('coder') already hides the palette. Calling
        // onClose afterwards clobbers the open with null and nothing opens.
        action: () => {
          onOpenCoder();
        },
        keywords: ['agentic', 'coder', 'claude', 'chat', 'vibe', 'j'],
      });
    }
    if (onOpenScheduler) {
      cmds.push({
        id: 'open-scheduler',
        title: 'Open Scheduler',
        description: `View, run, and manage scheduled jobs  (${mod}+I)`,
        category: 'Overlays',
        action: () => {
          onOpenScheduler();
        },
        keywords: ['scheduler', 'cron', 'schedule', 'jobs', 'queue', 'i'],
      });
    }
    if (onOpenEvents) {
      cmds.push({
        id: 'open-events',
        title: 'Open Events Subsystem',
        description: 'Monitor and manage the event bus  (⌘B / Ctrl+B)',
        category: 'Overlays',
        action: () => {
          onOpenEvents();
        },
        keywords: ['events', 'bus', 'monitor', 'links', 'automations', 'subscribe', 'emit', 'b'],
      });
    }
    if (onOpenSettings) {
      cmds.push({
        id: 'open-settings',
        title: 'Open Settings',
        description: 'Users, AI providers, and secrets',
        category: 'Overlays',
        action: () => {
          onOpenSettings();
          onClose();
        },
        keywords: ['settings', 'users', 'providers', 'secrets', 'config', 'admin'],
      });
    }

    // System apps (Users / AI Providers / Secrets) live only in the reserved
    // Settings space, so don't offer them as addable tiles here.
    const registeredApps = getAllApps().filter((app) => !app.system);

    // App management commands for registered apps
    registeredApps.forEach(app => {
      const isActive = activeApps.includes(app.id);

      if (!isActive) {
        cmds.push({
          id: `add-${app.id}`,
          title: `Add ${app.title}`,
          description: `Add ${app.title} to current space`,
          category: 'Apps',
          action: () => onAddApp(app.id),
          keywords: ['add', 'open', app.title.toLowerCase(), app.id],
        });
      } else {
        cmds.push({
          id: `remove-${app.id}`,
          title: `Remove ${app.title}`,
          description: `Remove ${app.title} from current space`,
          category: 'Apps',
          action: () => onRemoveApp(app.id),
          keywords: ['remove', 'close', 'hide', app.title.toLowerCase(), app.id],
        });
      }
    });

    // Custom apps - allow adding/removing them from current space
    Object.entries(customApps).forEach(([customAppId, customApp]) => {
      // Check if this custom app is already in the current space
      const isActive = activeApps.includes(customAppId);

      if (!isActive) {
        cmds.push({
          id: `add-custom-${customAppId}`,
          title: `Add ${customApp.name}`,
          description: customApp.description || 'Custom app',
          category: 'Custom Apps',
          action: () => onAddApp(customAppId),
          keywords: ['add', 'open', 'custom', customApp.name.toLowerCase(), customAppId],
        });
      } else {
        cmds.push({
          id: `remove-custom-${customAppId}`,
          title: `Remove ${customApp.name}`,
          description: `Remove ${customApp.name} from current space`,
          category: 'Custom Apps',
          action: () => onRemoveApp(customAppId),
          keywords: ['remove', 'close', 'hide', 'custom', customApp.name.toLowerCase(), customAppId],
        });
      }

      // Always show delete option for custom apps (permanently deletes from DB)
      if (onDeleteCustomApp) {
        cmds.push({
          id: `delete-custom-${customAppId}`,
          title: `Delete ${customApp.name} Permanently`,
          description: `Permanently delete "${customApp.name}" from database (cannot be undone)`,
          category: 'Danger',
          action: () => {
            // Close palette first, then show confirm
            onClose();
            setTimeout(() => {
              if (window.confirm(`Are you sure you want to permanently delete "${customApp.name}"? This cannot be undone.`)) {
                console.log('[CommandPalette] Deleting custom app:', customAppId);
                onDeleteCustomApp(customAppId);
              }
            }, 100);
          },
          keywords: ['delete', 'destroy', 'permanent', 'custom', customApp.name.toLowerCase(), customAppId],
        });
      }
    });

    // Space management commands
    if (onCreateSpace) {
      cmds.push({
        id: 'create-space',
        title: 'Create New Space',
        description: 'Create a new dashboard space',
        category: 'Spaces',
        action: () => {
          onCreateSpace();
          onClose();
        },
        keywords: ['new', 'space', 'create', 'add', 'dashboard'],
      });
    }

    // Switch to space commands. The reserved Settings space is reached via the
    // dedicated "Open Settings" command above, so skip it here.
    if (onSwitchSpace && spaces.length > 0) {
      spaces.forEach((space, index) => {
        if (space.id !== activeSpaceId && !space.reserved) {
          cmds.push({
            id: `switch-space-${space.id}`,
            title: `Switch to "${space.name}"`,
            description: `Switch to the ${space.name} space`,
            category: 'Spaces',
            action: () => {
              onSwitchSpace(space.id);
              onClose();
            },
            keywords: ['switch', 'go', 'space', space.name.toLowerCase(), `${index + 1}`],
          });
        }
      });
    }

    // Rename current space (not the reserved Settings space)
    if (onRenameSpace && activeSpaceId) {
      const currentSpace = spaces.find(s => s.id === activeSpaceId);
      if (currentSpace && !currentSpace.reserved) {
        cmds.push({
          id: 'rename-space',
          title: 'Rename Current Space',
          description: `Rename "${currentSpace.name}"`,
          category: 'Spaces',
          action: () => {
            setRenameMode({ spaceId: currentSpace.id, currentName: currentSpace.name });
            setRenameText(currentSpace.name);
          },
          keywords: ['rename', 'space', 'edit', 'name'],
        });
      }
    }

    // Delete current space (the reserved Settings space can't be deleted)
    if (onDeleteSpace && activeSpaceId && spaces.length > 1) {
      const currentSpace = spaces.find(s => s.id === activeSpaceId);
      if (currentSpace && !currentSpace.reserved) {
        cmds.push({
          id: 'delete-space',
          title: 'Delete Current Space',
          description: `Delete "${currentSpace.name}" (cannot be undone)`,
          category: 'Spaces',
          action: () => {
            onDeleteSpace(currentSpace.id);
            onClose();
          },
          keywords: ['delete', 'remove', 'space'],
        });
      }
    }

    // Grid configuration commands
    if (onUpdateSpaceGrid && activeSpaceId) {
      const currentSpace = spaces.find(s => s.id === activeSpaceId);
      if (currentSpace) {
        // Column presets
        [2, 3, 4, 5, 6].forEach(cols => {
          if (cols !== currentSpace.gridColumns) {
            cmds.push({
              id: `grid-cols-${cols}`,
              title: `Set Grid to ${cols} Columns`,
              description: `Change current space to ${cols} columns`,
              category: 'Grid',
              action: () => {
                onUpdateSpaceGrid(currentSpace.id, cols, currentSpace.gridRows);
                onClose();
              },
              keywords: ['grid', 'columns', 'layout', `${cols}`],
            });
          }
        });

        // Row presets
        [2, 3, 4].forEach(rows => {
          if (rows !== currentSpace.gridRows) {
            cmds.push({
              id: `grid-rows-${rows}`,
              title: `Set Grid to ${rows} Rows`,
              description: `Change current space to ${rows} rows`,
              category: 'Grid',
              action: () => {
                onUpdateSpaceGrid(currentSpace.id, currentSpace.gridColumns, rows);
                onClose();
              },
              keywords: ['grid', 'rows', 'layout', `${rows}`],
            });
          }
        });
      }
    }

    // Quick actions
    cmds.push({
      id: 'close-palette',
      title: 'Close Command Palette',
      description: 'Close this command palette',
      category: 'System',
      action: onClose,
      keywords: ['close', 'cancel', 'exit'],
    });

    return cmds;
  }, [activeApps, customApps, spaces, activeSpaceId, onAddApp, onRemoveApp, onDeleteCustomApp, onClose, onSwitchSpace, onCreateSpace, onDeleteSpace, onRenameSpace, onUpdateSpaceGrid, onOpenCoder, onOpenScheduler, onOpenEvents, onOpenSettings]);

  // Filter commands based on search
  const filteredCommands = useMemo(() => {
    return commands.filter(cmd => {
      if (!searchText.trim()) return true;

      const searchLower = searchText.toLowerCase();
      return (
        cmd.title.toLowerCase().includes(searchLower) ||
        cmd.description.toLowerCase().includes(searchLower) ||
        cmd.category.toLowerCase().includes(searchLower) ||
        cmd.keywords?.some(keyword => keyword.includes(searchLower))
      );
    });
  }, [commands, searchText]);

  // Reset selection when search changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [searchText, filteredCommands.length]);

  // Focus input when modal opens
  useEffect(() => {
    if (visible && inputRef.current) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
    // Reset state when opening
    if (visible) {
      setSearchText('');
      setRenameMode(null);
      setRenameText('');
    }
  }, [visible]);

  // Handle keyboard navigation
  const handleKeyPress = (event: any) => {
    if (Platform.OS !== 'web') return;

    switch (event.nativeEvent.key) {
      case 'ArrowDown':
        event.preventDefault();
        setSelectedIndex(prev => Math.min(prev + 1, filteredCommands.length - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        event.preventDefault();
        if (filteredCommands[selectedIndex]) {
          executeCommand(filteredCommands[selectedIndex]);
        }
        break;
      case 'Escape':
        event.preventDefault();
        if (renameMode) {
          setRenameMode(null);
        } else {
          onClose();
        }
        break;
    }
  };

  const handleRenameKeyPress = (event: any) => {
    if (Platform.OS !== 'web') return;

    if (event.nativeEvent.key === 'Enter') {
      event.preventDefault();
      if (renameMode && renameText.trim() && onRenameSpace) {
        onRenameSpace(renameMode.spaceId, renameText.trim());
        setRenameMode(null);
        onClose();
      }
    } else if (event.nativeEvent.key === 'Escape') {
      event.preventDefault();
      setRenameMode(null);
    }
  };

  const executeCommand = (command: Command) => {
    command.action();
    // Skip onClose for commands whose action already mutates the overlay
    // state directly — palette + coder + scheduler share one state machine,
    // so calling onClose afterwards sets it back to null and the overlay
    // never opens. rename-space stays open by design.
    const SELF_CLOSING = new Set([
      'rename-space',
      'open-agentic-coder',
      'open-scheduler',
      'open-events',
    ]);
    if (!SELF_CLOSING.has(command.id)) {
      onClose();
    }
    setSearchText('');
  };

  if (!visible) return null;

  // Rename mode UI
  if (renameMode) {
    return (
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={() => setRenameMode(null)}
      >
        <Pressable style={styles.overlay} onPress={() => setRenameMode(null)}>
          <Pressable style={styles.modal} onPress={(e) => e.stopPropagation()}>
            <View style={styles.container}>
              <View style={styles.header}>
                <Text style={styles.title}>RENAME SPACE</Text>
                <Text style={styles.hint}>Enter new name and press Enter</Text>
              </View>

              <View style={styles.searchContainer}>
                <TextInput
                  style={styles.searchInput}
                  placeholder="Space name..."
                  placeholderTextColor="#666"
                  value={renameText}
                  onChangeText={setRenameText}
                  onKeyPress={handleRenameKeyPress}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoFocus
                />
              </View>

              <View style={styles.footer}>
                <Text style={styles.footerText}>
                  Enter to save • Esc to cancel
                </Text>
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    );
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.modal} onPress={(e) => e.stopPropagation()}>
          <View style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
              <Text style={styles.title}>COMMAND PALETTE</Text>
              <Text style={styles.hint}>
                {Platform.OS === 'web' ? 'Use arrows to navigate, Enter to select, Esc to close' : 'Tap to select'}
              </Text>
            </View>

            {/* Search Input */}
            <View style={styles.searchContainer}>
              <Text style={styles.searchIcon}>{">"}</Text>
              <TextInput
                ref={inputRef}
                style={styles.searchInput}
                placeholder="Type a command..."
                placeholderTextColor="#666"
                value={searchText}
                onChangeText={setSearchText}
                onKeyPress={handleKeyPress}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            {/* Commands List */}
            <ScrollView style={styles.commandsList} showsVerticalScrollIndicator={false}>
              {filteredCommands.length === 0 ? (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyText}>No commands found</Text>
                  <Text style={styles.emptyHint}>Try a different search term</Text>
                </View>
              ) : (
                filteredCommands.map((command, index) => (
                  <Pressable
                    key={command.id}
                    style={[
                      styles.commandItem,
                      index === selectedIndex && styles.commandItemSelected
                    ]}
                    onPress={() => executeCommand(command)}
                  >
                    <View style={styles.commandContent}>
                      <Text style={[
                        styles.commandTitle,
                        index === selectedIndex && styles.commandTitleSelected
                      ]}>
                        {command.title}
                      </Text>
                      <Text style={[
                        styles.commandDescription,
                        index === selectedIndex && styles.commandDescriptionSelected
                      ]}>
                        {command.description}
                      </Text>
                    </View>
                    <Text style={[
                      styles.commandCategory,
                      index === selectedIndex && styles.commandCategorySelected
                    ]}>
                      {command.category}
                    </Text>
                  </Pressable>
                ))
              )}
            </ScrollView>

            {/* Footer */}
            <View style={styles.footer}>
              <Text style={styles.footerText}>
                {filteredCommands.length} command{filteredCommands.length !== 1 ? 's' : ''} available
              </Text>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modal: {
    width: '100%',
    maxWidth: 600,
    maxHeight: '80%',
  },
  container: {
    backgroundColor: '#001111',
    borderWidth: 2,
    borderColor: '#00ffff',
    borderRadius: 8,
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
    padding: 20,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#004444',
  },
  title: {
    fontFamily: 'Courier New',
    fontSize: 16,
    color: '#00ffff',
    fontWeight: 'bold',
    marginBottom: 5,
  },
  hint: {
    fontFamily: 'Courier New',
    fontSize: 10,
    color: '#888',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    paddingTop: 15,
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#004444',
  },
  searchIcon: {
    fontFamily: 'Courier New',
    fontSize: 16,
    color: '#00ffff',
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    fontFamily: 'Courier New',
    fontSize: 14,
    color: '#ffffff',
    backgroundColor: '#002222',
    borderWidth: 1,
    borderColor: '#004444',
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    ...(Platform.OS === 'web' ? {
      outline: 'none',
    } : {}),
  },
  commandsList: {
    maxHeight: 300,
  },
  commandItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#003333',
  },
  commandItemSelected: {
    backgroundColor: '#004444',
    borderLeftWidth: 3,
    borderLeftColor: '#00ffff',
  },
  commandContent: {
    flex: 1,
  },
  commandTitle: {
    fontFamily: 'Courier New',
    fontSize: 14,
    color: '#ffffff',
    marginBottom: 2,
  },
  commandTitleSelected: {
    color: '#00ffff',
  },
  commandDescription: {
    fontFamily: 'Courier New',
    fontSize: 11,
    color: '#888',
  },
  commandDescriptionSelected: {
    color: '#aaa',
  },
  commandCategory: {
    fontFamily: 'Courier New',
    fontSize: 10,
    color: '#666',
    backgroundColor: '#002222',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 3,
  },
  commandCategorySelected: {
    backgroundColor: '#003333',
    color: '#00ffff',
  },
  emptyState: {
    alignItems: 'center',
    padding: 40,
  },
  emptyText: {
    fontFamily: 'Courier New',
    fontSize: 14,
    color: '#888',
    marginBottom: 5,
  },
  emptyHint: {
    fontFamily: 'Courier New',
    fontSize: 11,
    color: '#666',
  },
  footer: {
    padding: 15,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#004444',
  },
  footerText: {
    fontFamily: 'Courier New',
    fontSize: 10,
    color: '#666',
    textAlign: 'center',
  },
});

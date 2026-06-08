import React, {
  useState,
  useEffect,
  useMemo,
} from "react";
import {
  View,
  Text,
  Dimensions,
  Platform,
  Pressable,
  TouchableOpacity,
} from "react-native";
import Constants from "expo-constants";
import {
  AppState,
  AIState,
  UserProfile,
  Space,
  SpaceAppLayout,
  SpaceSettings,
  AppSettings,
} from "../../core/types";
import { getAllApps, getApp } from "../../core/registry";
import { CommandPalette } from "../../core/components/common";
import AppInfoButton from "../../core/components/common/AppInfoButton";
import AppSettingsButton from "../../core/components/common/AppSettingsButton";
import AppRenderer from "../../core/components/common/AppRenderer";
import { relayUrlToApiBase } from "../../core/utils/dashtermUrl";
import { useKeyboardShortcut } from "../../core/hooks/useKeyboardShortcut";
import { useOverlayShortcuts } from "../../core/hooks/useOverlayShortcuts";
import OverlayHost from "../../core/components/overlays/OverlayHost";
import { useAuth } from "../../core/hooks/useAuth";
import { styles } from "./WebDashboard/styles";
import { useGridDragDrop } from "./WebDashboard/useGridDragDrop";

interface WebDashboardProps {
  state: AppState;
  userProfile: UserProfile | null;
  isConnected: boolean;
  updateAIApp: (updates: Partial<AIState>) => void;
  updateWebLayout: (updates: Partial<AppState["webLayout"]>) => void;
  appActions: {
    addApp: (appKey: AppState["currentMobileApp"]) => void;
    removeApp: (appKey: AppState["currentMobileApp"]) => void;
    // Custom app actions now use the shared apps collection (apps/{shareCode}/)
    createCustomApp: (app: any) => Promise<string | null>;
    updateCustomApp: (appId: string, updates: any) => Promise<boolean>;
    deleteCustomApp: (appId: string) => Promise<boolean>;
  };
  updateCustomAppState: (appId: string, stateUpdates: any) => void;
  deleteCustomApp: (appId: string) => Promise<boolean>;
  // Space management
  createSpace: (name: string, icon?: string) => string;
  deleteSpace: (spaceId: string) => boolean;
  renameSpace: (spaceId: string, name: string, icon?: string) => void;
  switchSpace: (spaceId: string) => void;
  updateSpaceGrid: (
    spaceId: string,
    gridColumns: number,
    gridRows: number
  ) => void;
  updateSpaceSettings: (spaceId: string, settings: Partial<SpaceSettings>) => void;
  updateAppSettings: (settings: Partial<AppSettings>) => void;
  updateSpaceApps: (spaceId: string, apps: SpaceAppLayout[]) => void;
  addAppToSpace: (spaceId: string, appId: string, appType: string) => void;
  removeAppFromSpace: (spaceId: string, appId: string) => void;
  updateAppInSpace: (
    spaceId: string,
    appId: string,
    updates: Partial<SpaceAppLayout>
  ) => void;
  // Instance state management
  updateAppInstance: (instanceId: string, updates: any) => void;
  // Event links management
  updateEventLinks: (links: import("../../core/types").EventLink[]) => void;
  // Global overlays (AgenticCoder, Scheduler — opened via CMD-K)
  updateAgenticCoderOverlay: (updates: any) => void;
  updateSchedulerOverlay: (updates: any) => void;
}

const HEADER_HEIGHT = 60;
const FOOTER_HEIGHT = 40;
const GAP = 8;
const PADDING = 16;

export default function WebDashboard({
  state,
  userProfile,
  isConnected,
  updateAIApp,
  updateWebLayout,
  appActions,
  updateCustomAppState,
  deleteCustomApp,
  createSpace,
  deleteSpace,
  renameSpace,
  switchSpace,
  updateSpaceGrid,
  updateSpaceSettings,
  updateAppSettings,
  updateSpaceApps,
  addAppToSpace,
  removeAppFromSpace,
  updateAppInSpace,
  updateAppInstance,
  updateEventLinks,
  updateAgenticCoderOverlay,
  updateSchedulerOverlay,
}: WebDashboardProps) {
  const { signOut } = useAuth();
  // CMD-K leader: K=palette, A=coder, S=scheduler; bare CMD-K reopens last.
  const overlay = useOverlayShortcuts();
  const [dimensions, setDimensions] = useState(Dimensions.get("window"));
  const [editingSpaceName, setEditingSpaceName] = useState<string | null>(null);
  const [newSpaceName, setNewSpaceName] = useState("");
  const [spaceSettingsVisible, setSpaceSettingsVisible] = useState(false);
  const [appSettingsVisible, setAppSettingsVisible] = useState(false);
  const [settingsMenuVisible, setSettingsMenuVisible] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  });

  // Get app settings with defaults
  const appSettings = state?.webLayout?.appSettings || { dateFormat: 'US' as const };

  // Format date based on app settings
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr + 'T00:00:00');
    const format = appSettings.dateFormat || 'US';

    switch (format) {
      case 'UK':
        return date.toLocaleDateString('en-GB', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        });
      case 'ISO':
        return `${dateStr} - ${date.toLocaleDateString('en-US', { weekday: 'long' })}`;
      case 'US':
      default:
        return date.toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
    }
  };


  // Listen for window resize
  useEffect(() => {
    const subscription = Dimensions.addEventListener("change", ({ window }) => {
      setDimensions(window);
    });
    return () => subscription?.remove();
  }, []);

  // Get spaces from state with migration support
  const spaces = useMemo(() => {
    const webLayout = state?.webLayout;
    if (webLayout?.spaces && webLayout.spaces.length > 0) {
      return webLayout.spaces;
    }
    // Fallback to default space
    return [
      {
        id: "default",
        name: "Dashboard",
        gridColumns: 3,
        gridRows: 4,
        apps: [],
        createdAt: Date.now(),
        order: 0,
      },
    ] as Space[];
  }, [state?.webLayout?.spaces]);

  const activeSpaceId =
    state?.webLayout?.activeSpaceId || spaces[0]?.id || "default";
  const foundSpace = spaces.find((s) => s.id === activeSpaceId) || spaces[0];
  // Ensure activeSpace always has an apps array
  const activeSpace = {
    ...foundSpace,
    apps: foundSpace?.apps || [],
  };

  // The reserved Settings space is reached via the gear button — keep it out
  // of the normal tab bar and the ⌘1-9 rotation.
  const normalSpaces = useMemo(() => spaces.filter((s) => !s.reserved), [spaces]);
  const systemSpace = useMemo(() => spaces.find((s) => s.reserved), [spaces]);
  const isSystemActive = (activeSpace as Space)?.reserved === true;

  // Keyboard shortcuts for switching spaces (Cmd/Ctrl + 1-9)
  const isMac =
    Platform.OS === "web" &&
    typeof navigator !== "undefined" &&
    navigator.platform.indexOf("Mac") !== -1;

  // Create handlers for each number key (over the non-reserved spaces only)
  useKeyboardShortcut({
    key: "1",
    metaKey: isMac,
    ctrlKey: !isMac,
    onTrigger: () => normalSpaces[0] && switchSpace(normalSpaces[0].id),
  });
  useKeyboardShortcut({
    key: "2",
    metaKey: isMac,
    ctrlKey: !isMac,
    onTrigger: () => normalSpaces[1] && switchSpace(normalSpaces[1].id),
  });
  useKeyboardShortcut({
    key: "3",
    metaKey: isMac,
    ctrlKey: !isMac,
    onTrigger: () => normalSpaces[2] && switchSpace(normalSpaces[2].id),
  });
  useKeyboardShortcut({
    key: "4",
    metaKey: isMac,
    ctrlKey: !isMac,
    onTrigger: () => normalSpaces[3] && switchSpace(normalSpaces[3].id),
  });
  useKeyboardShortcut({
    key: "5",
    metaKey: isMac,
    ctrlKey: !isMac,
    onTrigger: () => normalSpaces[4] && switchSpace(normalSpaces[4].id),
  });
  useKeyboardShortcut({
    key: "6",
    metaKey: isMac,
    ctrlKey: !isMac,
    onTrigger: () => normalSpaces[5] && switchSpace(normalSpaces[5].id),
  });
  useKeyboardShortcut({
    key: "7",
    metaKey: isMac,
    ctrlKey: !isMac,
    onTrigger: () => normalSpaces[6] && switchSpace(normalSpaces[6].id),
  });
  useKeyboardShortcut({
    key: "8",
    metaKey: isMac,
    ctrlKey: !isMac,
    onTrigger: () => normalSpaces[7] && switchSpace(normalSpaces[7].id),
  });
  useKeyboardShortcut({
    key: "9",
    metaKey: isMac,
    ctrlKey: !isMac,
    onTrigger: () => normalSpaces[8] && switchSpace(normalSpaces[8].id),
  });

  // Calculate grid dimensions
  const gridHeight =
    dimensions.height - HEADER_HEIGHT - FOOTER_HEIGHT - PADDING * 2 - 30; // 30 for settings bar
  const gridWidth = dimensions.width - PADDING * 2;

  const cellWidth =
    (gridWidth - (activeSpace.gridColumns - 1) * GAP) / activeSpace.gridColumns;
  const cellHeight =
    (gridHeight - (activeSpace.gridRows - 1) * GAP) / activeSpace.gridRows;

  // Use the extracted drag/drop hook
  const {
    dragState,
    resizeState,
    gridRef,
    handleDragStart,
    handleResizeStart,
    getAppLayout,
    getCollidingApps,
    getPredictedPositions,
  } = useGridDragDrop({
    activeSpace,
    cellWidth,
    cellHeight,
    gap: GAP,
    updateAppInSpace,
  });

  const collidingApps = getCollidingApps();
  const collidingAppIds = new Set(collidingApps.map((a) => a.id));
  const predictedPositions = getPredictedPositions();

  const handleCreateSpace = () => {
    const name = `Space ${spaces.length + 1}`;
    createSpace(name);
  };

  const handleDeleteSpace = (spaceId: string) => {
    deleteSpace(spaceId);
  };

  const handleSpaceDoubleClick = (spaceId: string, currentName: string) => {
    setEditingSpaceName(spaceId);
    setNewSpaceName(currentName);
  };

  const handleSpaceNameSubmit = (spaceId: string) => {
    if (newSpaceName.trim()) {
      renameSpace(spaceId, newSpaceName.trim());
    }
    setEditingSpaceName(null);
    setNewSpaceName("");
  };

  // Per-user homehub API base for vibe-coded apps. Sourced from the user's
  // AgenticCoder relay URL in the user-state blob — no env vars, no hardcoding.
  const apiBase = relayUrlToApiBase(state.overlays?.agenticCoder?.relayUrl);

  // Helper to render app content using the shared AppRenderer component
  const renderAppContent = (appLayout: SpaceAppLayout) => {
    const instanceId = appLayout.id;
    const instanceState = state.appInstances?.[instanceId] || {};
    const updateInstance = (updates: any) => updateAppInstance(instanceId, updates);

    // Build system context for AI app
    const systemContext = {
      userProfile: userProfile!,
      deviceType: state.deviceType as 'web' | 'mobile',
      currentApp: "ai",
      customApps: state.customApps,
      appInstances: state.appInstances,
      spaces: spaces,
      activeSpaceId: activeSpaceId,
      currentAIInstanceId: instanceId,
      eventLinks: state.eventLinks,
    };

    // Build app actions for AI app
    const appActionsWithExtras = {
      ...appActions,
      updateAppInstance,
      updateEventLinks,
      addAppToSpace,
    };

    return (
      <AppRenderer
        appLayout={appLayout}
        instanceState={instanceState}
        updateInstance={updateInstance}
        userProfile={userProfile}
        customApps={state.customApps}
        systemContext={systemContext}
        appActions={appActionsWithExtras}
        updateCustomAppState={updateCustomAppState}
        selectedDate={activeSpace.settings?.showDatePicker ? selectedDate : undefined}
        apiBase={apiBase}
      />
    );
  };

  const getAppTitle = (appLayout: SpaceAppLayout): string => {
    const registeredApps = getAllApps();
    const registered = registeredApps.find(
      (a) => a.id === appLayout.type || a.type === appLayout.type
    );
    if (registered) return registered.title;

    // Check for custom app - look up by appLayout.type (for AI-created apps) or appLayout.id (legacy)
    const customAppId = state.customApps?.[appLayout.type] ? appLayout.type : appLayout.id;
    const customApp = state.customApps?.[customAppId];
    if (customApp) return customApp.name.toUpperCase();

    return appLayout.type.toUpperCase();
  };

  // Render grid cell placeholders for visual feedback
  const renderGridCells = () => {
    if (!dragState && !resizeState) return null;

    const cells = [];
    for (let row = 0; row < activeSpace.gridRows; row++) {
      for (let col = 0; col < activeSpace.gridColumns; col++) {
        const isTarget =
          dragState &&
          col >= dragState.currentColumn &&
          col <
            dragState.currentColumn +
              (activeSpace.apps.find((a) => a.id === dragState.appId)
                ?.colSpan || 1) &&
          row >= dragState.currentRow &&
          row <
            dragState.currentRow +
              (activeSpace.apps.find((a) => a.id === dragState.appId)
                ?.rowSpan || 1);

        // Show where the swapped apps will actually go using predicted positions
        let isSwapTarget = false;
        if (dragState && collidingApps.length > 0) {
          for (const collApp of collidingApps) {
            const predicted = predictedPositions.get(collApp.id);
            if (
              predicted &&
              col >= predicted.column &&
              col < predicted.column + collApp.colSpan &&
              row >= predicted.row &&
              row < predicted.row + collApp.rowSpan
            ) {
              isSwapTarget = true;
              break;
            }
          }
        }

        cells.push(
          <div
            key={`cell-${col}-${row}`}
            style={{
              position: "absolute",
              left: col * (cellWidth + GAP),
              top: row * (cellHeight + GAP),
              width: cellWidth,
              height: cellHeight,
              border: isTarget
                ? "2px dashed #00ffff"
                : isSwapTarget
                ? "2px dashed #ffff00"
                : "1px dashed #003333",
              borderRadius: 4,
              backgroundColor: isTarget
                ? "rgba(0, 255, 255, 0.1)"
                : isSwapTarget
                ? "rgba(255, 255, 0, 0.1)"
                : "transparent",
              pointerEvents: "none",
              transition: "all 0.15s ease",
            }}
          />
        );
      }
    }
    return cells;
  };

  return (
    <View style={[styles.dashboard, { height: dimensions.height }]}>
      {/* Header with Space Tabs */}
      <View style={[styles.header, { height: HEADER_HEIGHT }]}>
        <View style={styles.headerLeft}>
          <Text style={styles.title}>DASHTERM v{Constants.expoConfig?.version || '0.0.1'}</Text>
        </View>

        {/* Space Tabs */}
        <View style={styles.spaceTabs}>
          {normalSpaces.map((space, index) => (
            <Pressable
              key={space.id}
              style={[
                styles.spaceTab,
                space.id === activeSpaceId && styles.spaceTabActive,
              ]}
              onPress={() => switchSpace(space.id)}
              onLongPress={() => handleSpaceDoubleClick(space.id, space.name)}
            >
              {editingSpaceName === space.id ? (
                <input
                  type="text"
                  value={newSpaceName}
                  onChange={(e) => setNewSpaceName(e.target.value)}
                  onBlur={() => handleSpaceNameSubmit(space.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSpaceNameSubmit(space.id);
                    if (e.key === "Escape") setEditingSpaceName(null);
                  }}
                  autoFocus
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#00ffff",
                    fontFamily: "Courier New",
                    fontSize: 11,
                    width: 80,
                    outline: "none",
                  }}
                />
              ) : (
                <>
                  <Text
                    style={[
                      styles.spaceTabText,
                      space.id === activeSpaceId && styles.spaceTabTextActive,
                    ]}
                  >
                    {space.icon && `${space.icon} `}
                    {space.name}
                  </Text>
                  <Text style={styles.spaceShortcut}>
                    {index < 9 ? `${isMac ? "⌘" : "^"}${index + 1}` : ""}
                  </Text>
                </>
              )}
              {normalSpaces.length > 1 && space.id === activeSpaceId && (
                <Pressable
                  style={styles.spaceDeleteBtn}
                  onPress={() => handleDeleteSpace(space.id)}
                >
                  <Text style={styles.spaceDeleteText}>×</Text>
                </Pressable>
              )}
            </Pressable>
          ))}
          <Pressable style={styles.addSpaceBtn} onPress={handleCreateSpace}>
            <Text style={styles.addSpaceBtnText}>+</Text>
          </Pressable>
        </View>

        {/* Status and Settings Menu */}
        <View style={styles.headerRight}>
          <Text
            style={[
              styles.status,
              { color: isConnected ? "#00ff00" : "#ff0000" },
            ]}
          >
            {isConnected ? "CONNECTED" : "DISCONNECTED"}
          </Text>
          {userProfile && (
            <Text style={styles.user}>{userProfile.displayName}</Text>
          )}
          {systemSpace && (
            <Pressable
              style={[styles.gearBtn, isSystemActive && styles.gearBtnActive]}
              onPress={() => switchSpace(systemSpace.id)}
              accessibilityLabel="Open settings"
            >
              <Text style={[styles.gearBtnText, isSystemActive && styles.gearBtnTextActive]}>⚙</Text>
            </Pressable>
          )}
          <View style={{ position: 'relative' }}>
            <Pressable
              style={styles.settingsMenuBtn}
              onPress={() => setSettingsMenuVisible(!settingsMenuVisible)}
            >
              <Text style={styles.settingsMenuBtnText}>MENU</Text>
            </Pressable>
            {settingsMenuVisible && (
              <View style={styles.settingsMenu}>
                <Pressable
                  style={styles.settingsMenuItem}
                  onPress={() => {
                    setSettingsMenuVisible(false);
                    setSpaceSettingsVisible(true);
                  }}
                >
                  <Text style={styles.settingsMenuItemText}>
                    SPACE SETTINGS ({activeSpace.name})
                  </Text>
                </Pressable>
                <Pressable
                  style={styles.settingsMenuItem}
                  onPress={() => {
                    setSettingsMenuVisible(false);
                    setAppSettingsVisible(true);
                  }}
                >
                  <Text style={styles.settingsMenuItemText}>APP SETTINGS</Text>
                </Pressable>
                <View style={styles.settingsMenuDivider} />
                <Pressable
                  style={styles.settingsMenuItem}
                  onPress={() => {
                    setSettingsMenuVisible(false);
                    signOut();
                  }}
                >
                  <Text style={[styles.settingsMenuItemText, { color: '#ff6666' }]}>
                    SIGN OUT
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        </View>
      </View>

      {/* Grid Container */}
      <View style={[styles.gridContainer, { padding: PADDING }, isSystemActive && styles.gridContainerSystem]}>
        {isSystemActive && (
          <View style={styles.systemBanner}>
            <Text style={styles.systemBannerText}>
              ⚙ SYSTEM · SETTINGS — manage users, AI providers, and secrets
            </Text>
          </View>
        )}
        {/* Toolbar Bar */}
        <View style={styles.toolbarBar}>
          {/* Date Picker (if enabled) */}
          {activeSpace.settings?.showDatePicker && (
            <>
              <Pressable
                style={[styles.dateNavBtn, { marginRight: 4 }]}
                onPress={() => {
                  const [year, month, day] = selectedDate.split('-').map(Number);
                  const current = new Date(year, month - 1, day - 1);
                  const newDate = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
                  setSelectedDate(newDate);
                }}
              >
                <Text style={styles.dateNavBtnText}>◀</Text>
              </Pressable>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                style={{
                  backgroundColor: '#001a1a',
                  border: '1px solid #00ffff',
                  color: '#00ffff',
                  fontFamily: 'Courier New',
                  fontSize: 12,
                  padding: '4px 8px',
                  borderRadius: 2,
                  outline: 'none',
                  cursor: 'pointer',
                  colorScheme: 'dark',
                }}
              />
              <button
                onClick={() => {
                  const [year, month, day] = selectedDate.split('-').map(Number);
                  const current = new Date(year, month - 1, day + 1);
                  const newDate = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
                  setSelectedDate(newDate);
                }}
                style={{
                  backgroundColor: '#001a1a',
                  border: '1px solid #004444',
                  borderRadius: 2,
                  padding: '4px 8px',
                  cursor: 'pointer',
                  marginRight: 12,
                }}
              >
                <span style={{ fontFamily: 'Courier New', fontSize: 10, color: '#00ffff' }}>▶</span>
              </button>
              <Text style={styles.datePickerDisplay}>
                {formatDate(selectedDate)}
              </Text>
            </>
          )}
          <View style={{ flex: 1 }} />
          <Text style={styles.gridSettingsHint}>
            Drag title bar to move • Drag edges to resize
          </Text>
        </View>

        {/* Space Settings Modal */}
        {spaceSettingsVisible && (
          <View style={styles.modalOverlay}>
            <View style={styles.settingsModal}>
              <View style={styles.settingsModalHeader}>
                <Text style={styles.settingsModalTitle}>SPACE SETTINGS - {activeSpace.name}</Text>
                <Pressable onPress={() => setSpaceSettingsVisible(false)}>
                  <Text style={styles.settingsModalClose}>×</Text>
                </Pressable>
              </View>
              <View style={styles.settingsModalContent}>
                {/* Show Date Picker Toggle */}
                <Pressable
                  style={styles.settingsOption}
                  onPress={() => {
                    updateSpaceSettings(activeSpace.id, {
                      showDatePicker: !activeSpace.settings?.showDatePicker,
                    });
                  }}
                >
                  <Text style={styles.settingsOptionLabel}>Show Date Picker</Text>
                  <View
                    style={[
                      styles.settingsToggle,
                      activeSpace.settings?.showDatePicker && styles.settingsToggleActive,
                    ]}
                  >
                    <Text style={[
                      styles.settingsToggleText,
                      !activeSpace.settings?.showDatePicker && styles.settingsToggleTextOff,
                    ]}>
                      {activeSpace.settings?.showDatePicker ? 'ON' : 'OFF'}
                    </Text>
                  </View>
                </Pressable>

                {/* Grid Size Setting */}
                <View style={styles.settingsSection}>
                  <Text style={styles.settingsSectionLabel}>GRID SIZE</Text>
                  <View style={styles.gridSizeSelector}>
                    <Text style={styles.gridSizeLabel}>Columns:</Text>
                    {[2, 3, 4, 5, 6, 8, 10, 12].map((cols) => (
                      <Pressable
                        key={`cols-${cols}`}
                        style={[
                          styles.gridSizeBtn,
                          activeSpace.gridColumns === cols && styles.gridSizeBtnActive,
                        ]}
                        onPress={() =>
                          updateSpaceGrid(activeSpace.id, cols, activeSpace.gridRows)
                        }
                      >
                        <Text
                          style={[
                            styles.gridSizeBtnText,
                            activeSpace.gridColumns === cols &&
                              styles.gridSizeBtnTextActive,
                          ]}
                        >
                          {cols}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <View style={[styles.gridSizeSelector, { marginTop: 8 }]}>
                    <Text style={styles.gridSizeLabel}>Rows:</Text>
                    {[4, 6, 8, 10, 12, 16, 20, 24].map((rows) => (
                      <Pressable
                        key={`rows-${rows}`}
                        style={[
                          styles.gridSizeBtn,
                          activeSpace.gridRows === rows && styles.gridSizeBtnActive,
                        ]}
                        onPress={() =>
                          updateSpaceGrid(activeSpace.id, activeSpace.gridColumns, rows)
                        }
                      >
                        <Text
                          style={[
                            styles.gridSizeBtnText,
                            activeSpace.gridRows === rows &&
                              styles.gridSizeBtnTextActive,
                          ]}
                        >
                          {rows}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* App Settings Modal */}
        {appSettingsVisible && (
          <View style={styles.modalOverlay}>
            <View style={styles.settingsModal}>
              <View style={styles.settingsModalHeader}>
                <Text style={styles.settingsModalTitle}>APP SETTINGS</Text>
                <Pressable onPress={() => setAppSettingsVisible(false)}>
                  <Text style={styles.settingsModalClose}>×</Text>
                </Pressable>
              </View>
              <View style={styles.settingsModalContent}>
                {/* Date Format Setting */}
                <View style={styles.settingsSection}>
                  <Text style={styles.settingsSectionLabel}>DATE FORMAT</Text>
                  <View style={styles.dateFormatOptions}>
                    {[
                      { value: 'US', label: 'US (January 3, 2026)' },
                      { value: 'UK', label: 'UK (3 January 2026)' },
                      { value: 'ISO', label: 'ISO (2026-01-03)' },
                    ].map((option) => (
                      <Pressable
                        key={option.value}
                        style={[
                          styles.dateFormatOption,
                          appSettings.dateFormat === option.value && styles.dateFormatOptionActive,
                        ]}
                        onPress={() => updateAppSettings({ dateFormat: option.value as 'US' | 'UK' | 'ISO' })}
                      >
                        <View style={styles.dateFormatRadio}>
                          {appSettings.dateFormat === option.value && (
                            <View style={styles.dateFormatRadioInner} />
                          )}
                        </View>
                        <Text style={[
                          styles.dateFormatLabel,
                          appSettings.dateFormat === option.value && styles.dateFormatLabelActive,
                        ]}>
                          {option.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* Grid Area */}
        <div
          ref={gridRef}
          style={{
            position: "relative",
            width: gridWidth,
            height: gridHeight,
            userSelect: dragState || resizeState ? "none" : "auto",
          }}
        >
          {/* Grid cell placeholders during drag */}
          {renderGridCells()}

          {/* Apps */}
          {activeSpace.apps.map((appLayout) => {
            const layout = getAppLayout(appLayout);
            const isDragging = dragState?.appId === appLayout.id;
            const isResizing = resizeState?.appId === appLayout.id;
            const isActive = isDragging || isResizing;
            const isBeingSwapped = collidingAppIds.has(appLayout.id);

            // Calculate absolute position
            const left = layout.column * (cellWidth + GAP);
            const top = layout.row * (cellHeight + GAP);
            const width =
              layout.colSpan * cellWidth + (layout.colSpan - 1) * GAP;
            const height =
              layout.rowSpan * cellHeight + (layout.rowSpan - 1) * GAP;

            return (
              <div
                key={appLayout.id}
                style={{
                  position: "absolute",
                  left,
                  top,
                  width,
                  height,
                  display: "flex",
                  flexDirection: "column",
                  backgroundColor: "#000000",
                  border: isActive
                    ? "2px solid #00ff00"
                    : isBeingSwapped
                    ? "2px solid #ffff00"
                    : "2px solid #00ffff",
                  borderRadius: 4,
                  overflow: "hidden",
                  boxShadow: isActive
                    ? "0 0 20px rgba(0, 255, 0, 0.5)"
                    : isBeingSwapped
                    ? "0 0 20px rgba(255, 255, 0, 0.5)"
                    : "0 0 10px rgba(0, 255, 255, 0.2)",
                  zIndex: isActive ? 1000 : 1,
                  transition: isActive ? "none" : "all 0.2s ease",
                  opacity: isDragging ? 0.9 : isBeingSwapped ? 0.7 : 1,
                }}
              >
                {/* App Title Bar - Draggable */}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                    backgroundColor: isActive ? "#00ff00" : "#00ffff",
                    paddingLeft: 10,
                    paddingRight: 10,
                    paddingTop: 4,
                    paddingBottom: 4,
                    minHeight: 28,
                    cursor: "grab",
                  }}
                  onMouseDown={(e) => handleDragStart(appLayout.id, e)}
                >
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    {/* Custom App Indicator with Share Code */}
                    {(() => {
                      const customAppId = state.customApps?.[appLayout.type] ? appLayout.type : appLayout.id;
                      const customApp = state.customApps?.[customAppId];
                      if (!customApp) return null;

                      const handleCopyShareCode = (e: React.MouseEvent) => {
                        e.stopPropagation();
                        navigator.clipboard.writeText(customApp.id).then(() => {
                          // Visual feedback - could add a toast notification here
                          console.log(`📋 Copied share code: ${customApp.id}`);
                        });
                      };

                      return (
                        <>
                          <span
                            style={{
                              backgroundColor: 'rgba(255, 0, 255, 0.8)',
                              color: '#ffffff',
                              fontFamily: 'Courier New',
                              fontSize: 8,
                              fontWeight: 'bold',
                              padding: '1px 4px',
                              borderRadius: 2,
                              marginRight: 4,
                              letterSpacing: 0.5,
                            }}
                            title="AI-Generated Custom App"
                          >
                            AI
                          </span>
                          <span
                            onClick={handleCopyShareCode}
                            style={{
                              backgroundColor: 'rgba(0, 0, 0, 0.6)',
                              border: '1px solid #ff00ff',
                              color: '#ff00ff',
                              fontFamily: 'Courier New',
                              fontSize: 9,
                              fontWeight: 'bold',
                              padding: '1px 6px',
                              borderRadius: 2,
                              marginRight: 6,
                              letterSpacing: 1,
                              cursor: 'pointer',
                              userSelect: 'none',
                            }}
                            title={`Share code: ${customApp.id}\nClick to copy • Share this code with others to let them use your app`}
                          >
                            {customApp.id}
                          </span>
                        </>
                      );
                    })()}
                    <span
                      style={{
                        fontFamily: "Courier New",
                        fontSize: 11,
                        fontWeight: "bold",
                        color: "#000000",
                        letterSpacing: 1,
                      }}
                    >
                      {getAppTitle(appLayout)}
                      {isResizing && ` (${layout.colSpan}×${layout.rowSpan})`}
                    </span>
                    {/* Date Picker Indicator - shows if app uses date picker */}
                    {(() => {
                      const appDef = getApp(appLayout.type);
                      if (appDef?.usesDatePicker && activeSpace.settings?.showDatePicker) {
                        return (
                          <span
                            style={{
                              marginLeft: 6,
                              fontSize: 10,
                              opacity: 0.8,
                            }}
                            title="Uses date picker"
                          >
                            📅
                          </span>
                        );
                      }
                      return null;
                    })()}
                    {/* App Info Button - shows AI functions and events */}
                    {(() => {
                      const appDef = getApp(appLayout.type);
                      if (appDef) {
                        return <AppInfoButton appDefinition={appDef} />;
                      }
                      // Check for custom app AI functions and queryable data
                      const customAppId = state.customApps?.[appLayout.type] ? appLayout.type : appLayout.id;
                      const customApp = state.customApps?.[customAppId];
                      const functions = customApp?.functions ?? [];
                      const queryableData = customApp?.queryableData ?? [];
                      const totalCount = functions.length + queryableData.length;
                      if (totalCount > 0) {
                        const tooltipParts = [];
                        if (functions.length > 0) {
                          tooltipParts.push(`AI Functions: ${functions.map((f: any) => f.name).join(', ')}`);
                        }
                        if (queryableData.length > 0) {
                          tooltipParts.push(`Queryable Data: ${queryableData.map((q: any) => q.schema?.name || q.name).join(', ')}`);
                        }
                        return (
                          <span
                            style={{
                              backgroundColor: 'rgba(0, 0, 0, 0.6)',
                              border: '1px solid #000000',
                              borderRadius: 4,
                              paddingLeft: 6,
                              paddingRight: 6,
                              paddingTop: 2,
                              paddingBottom: 2,
                              marginLeft: 8,
                              fontFamily: 'Courier New',
                              fontSize: 10,
                              color: '#ffff00',
                              fontWeight: 'bold',
                            }}
                            title={tooltipParts.join('\n')}
                          >
                            ⚡{totalCount}
                          </span>
                        );
                      }
                      return null;
                    })()}
                    {/* App Settings Button - shows settings modal */}
                    {(() => {
                      const appDef = getApp(appLayout.type);
                      const instanceState = state.appInstances?.[appLayout.id] || {};
                      return appDef?.settings ? (
                        <AppSettingsButton
                          appDefinition={appDef}
                          appState={instanceState}
                          onUpdateState={(updates) => updateAppInstance(appLayout.id, updates)}
                        />
                      ) : null;
                    })()}
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      style={{
                        padding: "2px 6px",
                        backgroundColor: "rgba(0,0,0,0.1)",
                        border: "none",
                        borderRadius: 2,
                        cursor: "pointer",
                        fontFamily: "Courier New",
                        fontSize: 12,
                        color: "#ff6666",
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeAppFromSpace(activeSpace.id, appLayout.id);
                      }}
                      title="Remove from space"
                    >
                      ×
                    </button>
                  </div>
                </div>

                {/* App Content — small inset so the inner UI doesn't kiss the
                    window's cyan border. The border belongs to the chrome, not
                    the app. */}
                <div
                  style={{
                    flex: 1,
                    overflow: "hidden",
                    pointerEvents: isDragging ? "none" : "auto",
                    display: "flex",
                    flexDirection: "column",
                    minHeight: 0,
                    padding: 8,
                  }}
                >
                  {renderAppContent(appLayout)}
                </div>

                {/* Resize Handles */}
                {/* Right edge */}
                <div
                  style={{
                    position: "absolute",
                    right: 0,
                    top: 40,
                    bottom: 20,
                    width: 8,
                    cursor: "ew-resize",
                    backgroundColor:
                      isResizing && resizeState?.edge === "right"
                        ? "rgba(0, 255, 0, 0.3)"
                        : "transparent",
                  }}
                  onMouseDown={(e) =>
                    handleResizeStart(appLayout.id, "right", e)
                  }
                />
                {/* Bottom edge */}
                <div
                  style={{
                    position: "absolute",
                    bottom: 0,
                    left: 20,
                    right: 20,
                    height: 8,
                    cursor: "ns-resize",
                    backgroundColor:
                      isResizing && resizeState?.edge === "bottom"
                        ? "rgba(0, 255, 0, 0.3)"
                        : "transparent",
                  }}
                  onMouseDown={(e) =>
                    handleResizeStart(appLayout.id, "bottom", e)
                  }
                />
                {/* Corner */}
                <div
                  style={{
                    position: "absolute",
                    right: 0,
                    bottom: 0,
                    width: 16,
                    height: 16,
                    cursor: "nwse-resize",
                    backgroundColor:
                      isResizing && resizeState?.edge === "corner"
                        ? "rgba(0, 255, 0, 0.5)"
                        : "rgba(0, 255, 255, 0.3)",
                    borderTopLeftRadius: 4,
                  }}
                  onMouseDown={(e) =>
                    handleResizeStart(appLayout.id, "corner", e)
                  }
                >
                  <span
                    style={{
                      position: "absolute",
                      right: 2,
                      bottom: 0,
                      fontFamily: "Courier New",
                      fontSize: 10,
                      color: "#00ffff",
                    }}
                  >
                    ⋱
                  </span>
                </div>

                {/* Size indicator during resize */}
                {isResizing && (
                  <div
                    style={{
                      position: "absolute",
                      top: "50%",
                      left: "50%",
                      transform: "translate(-50%, -50%)",
                      backgroundColor: "rgba(0, 0, 0, 0.9)",
                      border: "2px solid #00ff00",
                      borderRadius: 8,
                      padding: "12px 20px",
                      zIndex: 10,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "Courier New",
                        fontSize: 24,
                        fontWeight: "bold",
                        color: "#00ff00",
                      }}
                    >
                      {layout.colSpan} × {layout.rowSpan}
                    </span>
                  </div>
                )}
              </div>
            );
          })}

          {/* Empty state when no apps */}
          {activeSpace.apps.length === 0 && (
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <span
                style={{
                  fontFamily: "Courier New",
                  fontSize: 16,
                  color: "#666666",
                  marginBottom: 8,
                }}
              >
                No apps in this space
              </span>
              <span
                style={{
                  fontFamily: "Courier New",
                  fontSize: 12,
                  color: "#444444",
                }}
              >
                Press {isMac ? "⌘" : "Ctrl"}+K to open command palette and add
                apps
              </span>
            </div>
          )}
        </div>
      </View>

      {/* Footer */}
      <View style={[styles.footer, { height: FOOTER_HEIGHT }]}>
        <Text style={styles.footerText}>
          {isMac ? "⌘" : "Ctrl"}+K: Commands • {isMac ? "⌘" : "Ctrl"}+1-9:
          Switch Spaces • Drag to move/resize
        </Text>
      </View>

      {/* Command Palette (one of the three overlays) */}
      <CommandPalette
        visible={overlay.open === 'palette'}
        onClose={overlay.closeOverlay}
        onAddApp={(appId) => addAppToSpace(activeSpace.id, appId, appId)}
        onRemoveApp={(appId) => removeAppFromSpace(activeSpace.id, appId)}
        activeApps={[
          ...activeSpace.apps.map((a) => a.id),
          ...activeSpace.apps.map((a) => a.type), // Include types for custom app matching
        ]}
        customApps={state.customApps}
        onDeleteCustomApp={deleteCustomApp}
        spaces={spaces}
        activeSpaceId={activeSpaceId}
        onSwitchSpace={switchSpace}
        onCreateSpace={handleCreateSpace}
        onDeleteSpace={handleDeleteSpace}
        onRenameSpace={renameSpace}
        onUpdateSpaceGrid={updateSpaceGrid}
        onOpenCoder={() => overlay.openOverlay('coder')}
        onOpenScheduler={() => overlay.openOverlay('scheduler')}
        onOpenSettings={systemSpace ? () => switchSpace(systemSpace.id) : undefined}
      />

      {/* Global overlays — AgenticCoder + Scheduler. Composed from the same
          components that used to live as tile plugins, now fed global state. */}
      <OverlayHost
        open={overlay.open === 'coder' ? 'coder' : overlay.open === 'scheduler' ? 'scheduler' : null}
        onClose={overlay.closeOverlay}
        agenticCoderState={state.overlays?.agenticCoder}
        updateAgenticCoder={updateAgenticCoderOverlay}
        schedulerState={state.overlays?.scheduler}
        updateScheduler={updateSchedulerOverlay}
        relatedWorkspaceNames={Array.from(new Set(
          activeSpace.apps
            .map((a) => state.customApps?.[a.type]?.originWorkspace)
            .filter((n): n is string => !!n)
        ))}
      />
    </View>
  );
}

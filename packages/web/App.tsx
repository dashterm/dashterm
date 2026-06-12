import React from "react";
import { View, Text } from "react-native";
import { useRealtimeStateWithAuth } from "../core/hooks/useRealtimeStateWithAuth";
import { useAuth } from "../core/hooks/useAuth";
import { registerAllApps } from "../core/apps";
import LoginPage from "../core/components/common/LoginPage";
import PasswordResetScreen from "../core/components/common/PasswordResetScreen";
import WebDashboard from "./layouts/WebDashboard";

registerAllApps();

export default function App() {
  const {
    state,
    userProfile,
    isConnected,
    isAuthenticated,
    isLoading,
    updateAIApp,
    updateWebLayout,
    addApp,
    removeApp,
    createCustomApp,
    updateCustomApp,
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
    updateEventsOverlay,
  } = useRealtimeStateWithAuth();

  const { mustResetPassword } = useAuth();

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  // Seeded admin / any user whose operator flagged them — must rotate the
  // password before they get to see the dashboard.
  if (mustResetPassword) {
    return <PasswordResetScreen />;
  }

  if (!state || isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: "#000", justifyContent: "center", alignItems: "center" }}>
        <Text style={{ color: "#00ffff", fontFamily: "Courier New" }}>LOADING DASHTERM...</Text>
      </View>
    );
  }

  return (
    <WebDashboard
      state={state}
      userProfile={userProfile}
      isConnected={isConnected}
      updateAIApp={updateAIApp}
      updateWebLayout={updateWebLayout}
      appActions={{
        addApp,
        removeApp,
        createCustomApp,
        updateCustomApp,
        deleteCustomApp,
      }}
      updateCustomAppState={updateCustomAppState}
      deleteCustomApp={deleteCustomApp}
      createSpace={createSpace}
      deleteSpace={deleteSpace}
      renameSpace={renameSpace}
      switchSpace={switchSpace}
      updateSpaceGrid={updateSpaceGrid}
      updateSpaceSettings={updateSpaceSettings}
      updateAppSettings={updateAppSettings}
      updateSpaceApps={updateSpaceApps}
      addAppToSpace={addAppToSpace}
      removeAppFromSpace={removeAppFromSpace}
      updateAppInSpace={updateAppInSpace}
      updateAppInstance={updateAppInstance}
      updateEventLinks={updateEventLinks}
      updateAgenticCoderOverlay={updateAgenticCoderOverlay}
      updateSchedulerOverlay={updateSchedulerOverlay}
      updateEventsOverlay={updateEventsOverlay}
    />
  );
}

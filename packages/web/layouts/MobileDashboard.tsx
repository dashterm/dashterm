import React, { useEffect, useRef, useState } from "react";
import { View, Text, Pressable } from "react-native";
import type { Space, SpaceAppLayout } from "../../core/types";
import { getApp } from "../../core/registry";
import AppInfoButton from "../../core/components/common/AppInfoButton";
import AppSettingsButton from "../../core/components/common/AppSettingsButton";

/**
 * Mobile/narrow-viewport layout for the dashboard.
 *
 * The desktop WebDashboard renders an absolute-positioned grid (drag to move,
 * drag to resize) that's unusable on a phone. This restores the original native
 * behaviour: a space selector at the top and a full-width pager you swipe
 * left/right to move between the apps in the current space — one app per screen.
 *
 * It reuses the dashboard's own `renderAppContent`/`getAppTitle` closures, so an
 * app renders identically to the grid, just full-width.
 */
interface MobileDashboardProps {
  displayVersion: string;
  isConnected: boolean;
  normalSpaces: Space[];
  activeSpace: Space;
  activeSpaceId: string;
  isSystemActive: boolean;
  customApps: Record<string, any> | undefined;
  appInstances: Record<string, any> | undefined;
  switchSpace: (id: string) => void;
  onCreateSpace: () => void;
  onOpenPalette: () => void;
  onOpenSettings?: () => void;
  removeAppFromSpace: (spaceId: string, appId: string) => void;
  updateAppInstance: (instanceId: string, updates: any) => void;
  renderAppContent: (appLayout: SpaceAppLayout) => React.ReactNode;
  getAppTitle: (appLayout: SpaceAppLayout) => string;
}

export default function MobileDashboard({
  displayVersion,
  isConnected,
  normalSpaces,
  activeSpace,
  activeSpaceId,
  isSystemActive,
  customApps,
  appInstances,
  switchSpace,
  onCreateSpace,
  onOpenPalette,
  onOpenSettings,
  removeAppFromSpace,
  updateAppInstance,
  renderAppContent,
  getAppTitle,
}: MobileDashboardProps) {
  const apps = activeSpace.apps || [];
  const pagerRef = useRef<HTMLDivElement | null>(null);
  const [page, setPage] = useState(0);

  // Reset to the first app whenever the space changes.
  useEffect(() => {
    setPage(0);
    if (pagerRef.current) pagerRef.current.scrollLeft = 0;
  }, [activeSpaceId]);

  const onPagerScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const w = el.clientWidth || 1;
    const i = Math.round(el.scrollLeft / w);
    if (i !== page) setPage(i);
  };

  const goToPage = (i: number) => {
    const el = pagerRef.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#0a0a0a", minHeight: 0 }}>
      {/* Compact header */}
      <View style={{ borderBottomWidth: 1, borderBottomColor: "#00ffff", backgroundColor: "#001414" }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: 12,
            paddingTop: 8,
            paddingBottom: 6,
          }}
        >
          <Text style={{ fontFamily: "Courier New", fontSize: 14, color: "#00ff00", letterSpacing: 1 }}>
            DASHTERM <Text style={{ color: "#00ffff", fontSize: 10 }}>v{displayVersion}</Text>
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
            <View
              style={{
                width: 9,
                height: 9,
                borderRadius: 5,
                backgroundColor: isConnected ? "#00ff00" : "#ff0000",
              }}
            />
            <Pressable onPress={onOpenPalette} hitSlop={8}>
              <Text style={{ fontFamily: "Courier New", fontSize: 22, color: "#00ffff", lineHeight: 22 }}>+</Text>
            </Pressable>
            {onOpenSettings && (
              <Pressable onPress={onOpenSettings} hitSlop={8}>
                <Text style={{ fontFamily: "Courier New", fontSize: 16, color: "#00ffff" }}>⚙</Text>
              </Pressable>
            )}
          </View>
        </View>

        {/* Space selector — horizontal scroll */}
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            gap: 6,
            overflowX: "auto",
            padding: "0 10px 8px",
            scrollbarWidth: "none",
          }}
        >
          {normalSpaces.map((s) => {
            const active = s.id === activeSpaceId;
            return (
              <button
                key={s.id}
                onClick={() => switchSpace(s.id)}
                style={{
                  flex: "0 0 auto",
                  fontFamily: "Courier New",
                  fontSize: 12,
                  padding: "5px 12px",
                  borderRadius: 3,
                  border: `1px solid ${active ? "#00ff00" : "#005555"}`,
                  background: active ? "rgba(0,255,0,0.12)" : "transparent",
                  color: active ? "#00ff00" : "#00aaaa",
                  whiteSpace: "nowrap",
                  cursor: "pointer",
                }}
              >
                {s.icon ? `${s.icon} ` : ""}
                {s.name}
              </button>
            );
          })}
          <button
            onClick={onCreateSpace}
            style={{
              flex: "0 0 auto",
              fontFamily: "Courier New",
              fontSize: 14,
              padding: "4px 12px",
              borderRadius: 3,
              border: "1px solid #005555",
              background: "transparent",
              color: "#00aaaa",
              cursor: "pointer",
            }}
            title="New space"
          >
            +
          </button>
        </div>
      </View>

      {/* App pager — one app full-width per page, swipe to move between them */}
      {apps.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 30 }}>
          <Text style={{ fontFamily: "Courier New", fontSize: 14, color: "#666666" }}>No apps in this space</Text>
          <Pressable
            onPress={onOpenPalette}
            style={{ marginTop: 16, borderWidth: 1, borderColor: "#00ff00", paddingVertical: 10, paddingHorizontal: 18 }}
          >
            <Text style={{ fontFamily: "Courier New", fontSize: 13, color: "#00ff00" }}>[ + ADD APP ]</Text>
          </Pressable>
        </View>
      ) : (
        <div
          ref={pagerRef}
          onScroll={onPagerScroll}
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "row",
            width: "100%",
            maxWidth: "100%",
            overflowX: "auto",
            overflowY: "hidden",
            scrollSnapType: "x mandatory",
            overscrollBehaviorX: "contain",
            WebkitOverflowScrolling: "touch",
            minHeight: 0,
          }}
        >
          {apps.map((appLayout) => {
            const appDef = getApp(appLayout.type);
            const customAppId = customApps?.[appLayout.type] ? appLayout.type : appLayout.id;
            const customApp = customApps?.[customAppId];
            const instanceState = appInstances?.[appLayout.id] || {};
            return (
              <div
                key={appLayout.id}
                style={{
                  flex: "0 0 100%",
                  width: "100%",
                  maxWidth: "100%",
                  height: "100%",
                  scrollSnapAlign: "start",
                  display: "flex",
                  flexDirection: "column",
                  minWidth: 0,
                  // Clip an over-wide app to the page so it can't scroll
                  // horizontally and fight the swipe-between-apps gesture.
                  overflow: "hidden",
                }}
              >
                {/* Title bar (no drag/resize on mobile) */}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    backgroundColor: "#00ffff",
                    padding: "5px 10px",
                    gap: 8,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    {customApp && (
                      <span
                        style={{
                          backgroundColor: "rgba(255,0,255,0.8)",
                          color: "#ffffff",
                          fontFamily: "Courier New",
                          fontSize: 8,
                          fontWeight: "bold",
                          padding: "1px 4px",
                          borderRadius: 2,
                        }}
                        title="AI-generated custom app"
                      >
                        AI
                      </span>
                    )}
                    <span
                      style={{
                        fontFamily: "Courier New",
                        fontSize: 12,
                        fontWeight: "bold",
                        color: "#000000",
                        letterSpacing: 1,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {getAppTitle(appLayout)}
                    </span>
                    {appDef ? <AppInfoButton appDefinition={appDef} /> : null}
                    {appDef?.settings ? (
                      <AppSettingsButton
                        appDefinition={appDef}
                        appState={instanceState}
                        onUpdateState={(updates: any) => updateAppInstance(appLayout.id, updates)}
                      />
                    ) : null}
                  </div>
                  {!isSystemActive && (
                    <button
                      onClick={() => removeAppFromSpace(activeSpace.id, appLayout.id)}
                      style={{
                        border: "none",
                        background: "transparent",
                        color: "#cc0000",
                        fontFamily: "Courier New",
                        fontSize: 16,
                        cursor: "pointer",
                        padding: "0 4px",
                      }}
                      title="Remove from space"
                    >
                      ×
                    </button>
                  )}
                </div>

                {/* App content */}
                <div
                  style={{
                    flex: 1,
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                    minHeight: 0,
                    minWidth: 0,
                    width: "100%",
                    maxWidth: "100%",
                    boxSizing: "border-box",
                    padding: 8,
                  }}
                >
                  {renderAppContent(appLayout)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Page indicator */}
      {apps.length > 1 && (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            paddingVertical: 10,
            backgroundColor: "#001414",
            borderTopWidth: 1,
            borderTopColor: "#003333",
          }}
        >
          {apps.map((a, i) => (
            <Pressable key={a.id} onPress={() => goToPage(i)} hitSlop={6}>
              <View
                style={{
                  width: i === page ? 22 : 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: i === page ? "#00ff00" : "#005555",
                }}
              />
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

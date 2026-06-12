# DashTerm - AI-Enhanced Multi-App Ecosystem (OSS)

React Native + Expo (web target) dashboard backed by a native Node + sqlite
gateway. Argon2id passwords, JWT cookies, WebSocket push for cross-tab sync,
and a multi-provider AI proxy (Claude / GPT / Gemini / Ollama). Terminal /
Matrix aesthetic. Web: Spaces-based grid with drag-and-drop.

## Commands
- Boot the gateway + Expo dev server: `npm run dev`
- Build the web bundle: `npx expo export --platform web --output-dir web-dist`
- Build CLI + server: `npm install` (the postinstall does both)
- TypeCheck: `PATH="/opt/homebrew/bin:$PATH" npx tsc --noEmit`

## Project Structure
```
packages/
├── server/             # Node + Fastify gateway (the OSS install's default)
│   └── src/
│       ├── ai/         # provider adapters + registry (anthropic, openai,
│       │               # gemini, ollama, types, registry)
│       ├── compilation/ # esbuild TSX → IIFE JS for vibe-coded apps
│       ├── routes/     # auth, state, users, apps, compile, ai, ws
│       ├── migrations/ # numbered .sql migrations
│       ├── db.ts, auth.ts, realtime.ts, config.ts, index.ts, cli.ts
├── core/
│   ├── registry/       # Plugin-based app registry
│   ├── apps/           # AIAssistant, AgenticCoder, Scheduler, UserManagement
│   ├── components/     # AppRenderer, LoginPage, PasswordResetScreen, …
│   ├── hooks/          # useAuth, useRealtimeStateWithAuth, useSharedApps
│   ├── storage/        # DashTermApiProvider — talks to the native gateway
│   └── services/ai/    # AIAssistant chat orchestrator → /api/ai/chat proxy
└── web/                # Expo web entry: App.tsx + WebDashboard layout

cli/
└── src/                # Node CLI — start / onboard / daemon / provider /
                        # users / doctor

scripts/install.sh      # Curl-installer
```

## Styling
The terminal aesthetic — colors, typography, boot sequences, panel patterns,
and settings UI. Quick reference:
- Colors: #00ffff (cyan), #00ff00 (green), #ff0000 (red), #ffff00 (yellow), #0a0a0a (bg)
- Font: 'Courier New' monospace only
- NO internal headers - window container provides title

## Adding a New App

### Step 1: Create Component (`packages/core/apps/[AppName]/index.tsx`)
```typescript
import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';

interface Props {
  appState: any;
  onUpdate: (updates: any) => void;
}

export default function MyApp({ appState, onUpdate }: Props) {
  const state = { items: [], ...(appState || {}) };
  return (
    <ScrollView style={styles.container}>
      <View style={styles.panel}>
        <Text style={styles.label}>+-- MAIN --+</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  panel: { borderWidth: 1, borderColor: '#00ffff', padding: 15, margin: 10 },
  label: { fontFamily: 'Courier New', fontSize: 11, color: '#00ffff' },
});
```

### Step 2: Create Plugin (`packages/core/apps/[AppName]/plugin.ts`)
```typescript
import { AppDefinition, AppComponentProps, AppContext } from '../../registry/types';
import MyApp from './index';

export const myAppPlugin: AppDefinition = {
  id: 'myapp',
  type: 'myapp',
  title: 'MY APP',
  description: 'Description',
  icon: '📱',
  component: ({ state, updateState }: AppComponentProps) => MyApp({ appState: state, onUpdate: updateState }),
  defaultState: { items: [] },
  gridDefaults: { colSpan: 2, rowSpan: 3 },
  aiFunctions: [],
  getSummary: (state) => `${state?.items?.length || 0} items`,
};
```

### Step 3: Register (`packages/core/apps/index.ts`)
```typescript
import { myAppPlugin } from './MyApp/plugin';
registerApp(myAppPlugin);
```
That's the only wiring needed to render it. The shared `AppRenderer`
(`packages/core/components/common/AppRenderer.tsx`, used by
`packages/web/layouts/WebDashboard.tsx`) looks each tile up in the registry by
`type` — there is no per-app switch to edit.

### Step 4: Add default state (`packages/core/hooks/state/defaultAppStates.ts`)
```typescript
// In getDefaultStateForAppType()
case 'myapp': return { items: [] };
```

## Adding Settings to an App

1. Create settings component with `AppSettingsContext` props (state, updateState, onClose)
2. Add to plugin:
```typescript
settings: {
  renderSettings: (ctx) => React.createElement(MySettings, ctx),
}
```

Mirror an existing app's settings component (e.g.
`packages/core/apps/AgenticCoder/Settings.tsx`) for UI patterns and styles.

## Key Interfaces

```typescript
interface AppDefinition<TState = any> {
  id: string;
  type: string;
  title: string;
  description: string;
  icon?: string;
  component: ComponentType<AppComponentProps>;
  defaultState: TState;
  aiFunctions: AppAIFunction[];
  gridDefaults: GridDefaults;
  getSummary?: (state: TState) => string;
  events?: AppEvents;
  settings?: AppSettings;
  queryableData?: AppQueryableData[];  // NEW: Enables AI data queries
}

interface AppContext {
  state: any;
  updateState: (updates: any) => void;
  userProfile: UserProfile | null;
  allAppStates: Record<string, any>;
  emit: (eventName: string, data: any) => void;
  subscribe: (eventPattern: string, handler: AppEventHandler) => () => void;
}

interface AppSettingsContext {
  state: any;
  updateState: (updates: any) => void;
  onClose: () => void;
}
```

## Instance-Based State (Web Spaces)

Each app instance has independent state stored at `appState/appInstances/{instanceId}/`.
- `addAppToSpace()` generates unique ID and initializes default state
- `updateAppInstance(instanceId, updates)` updates instance state
- Multiple instances of same app type have separate data

## AI Integration

### Adding AI Functions to App
```typescript
aiFunctions: [{
  definition: {
    name: 'addItem',
    description: 'Add item',
    parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
  handler: (args, context) => {
    context.updateState({ items: [...context.state.items, { id: Date.now(), name: args.name }] });
    return `Added ${args.name}`;
  },
}],
```

### Adding Queryable Data to App
Enables users to ask questions about app data via AI (e.g., "What workouts did I do last week?"):

```typescript
queryableData: [{
  schema: {
    name: 'items',
    description: 'Items stored in the app',
    itemName: 'item',
    fields: {
      name: { type: 'string', description: 'Item name', searchable: true },
      createdAt: { type: 'date', description: 'When created', sortable: true, filterable: true },
      completed: { type: 'boolean', description: 'Completion status', filterable: true },
    },
    examples: ['What items do I have?', 'Show completed items from last week'],
  },
  getData: (options, context) => {
    let items = context.state?.items || [];
    // Apply filters, dateRange, search, sort, limit from options
    return { items, total: items.length, filtered: items.length };
  },
}],
```

### Required Updates for AI State Access
When adding AI functions, update these files or functions receive empty state `{}`:

1. **`packages/core/services/ai/appStateHelpers.ts`** - Add to `getAppStateFromContext()` and `updateAppState()`
2. **`packages/core/apps/AIAssistant/index.tsx`** - Add to `appActions` prop type
3. **`packages/core/types/index.ts`** - Add to `SystemContext` interface
4. **`packages/core/components/common/AppRenderer.tsx`** - Add to `systemContext` and `appActions`
5. **`packages/web/layouts/WebDashboard.tsx`** - Add to AIAssistant's `systemContext` and `appActions`

## Database Structure
```
# User-specific data
users/{uid}/
├── profile/ (displayName, email, photoURL)
└── appState/
    ├── workoutApp/, todoApp/, etc. (global/mobile state)
    └── appInstances/{instanceId}/ (web Spaces instance state)

# Shared custom apps (AI-generated)
apps/{shareCode}/
├── id          # 5-char share code (e.g., "K7XM2")
├── name        # Display name
├── description
├── code        # React component source
├── compiledCode
├── functions   # AI-callable functions
├── queryableData
├── ownerId     # Creator's uid
├── ownerName
├── visibility  # 'private' | 'unlisted' | 'public'
├── createdAt, updatedAt, version
└── category (optional)
```

### Custom App Sharing
- Each custom app has a unique 5-character share code (e.g., "K7XM2")
- Share code displayed in app title bar - click to copy
- Apps stored in shared collection, accessible by anyone with the code
- App state is per-user (stored in appInstances), code is shared

## Custom App Compilation & Rendering

Vibe-coded apps (pushed via the VibeCoder app, or generated by AI) follow a
distinct compile/render path from registered apps.

### Compile pipeline (`packages/server/src/compilation/codeCompiler.ts`)
1. **Strip all imports.** The shim already provides `View`, `Text`, `StyleSheet`,
   etc., so any `import { View } from 'react-native'` in user code would
   double-declare and crash esbuild. The strip regex covers:
   - Multi-line `import { ... } from 'mod'` (uses `[\s\S]*?`, not `.*`)
   - Bare side-effect `import 'mod'`
   - TS-style `import x = require(...)`
2. **Wrap user code in an IIFE.** Any leftover `const View = ...` (e.g. from a
   CommonJS-style `const { View } = require('react-native')` that slipped past
   the strip pass) shadows the shim's binding inside the IIFE instead of
   crashing the compile with "View has already been declared".
3. **esbuild** compiles TSX → IIFE JS (`format: 'iife'`, `bundle: false`,
   `globalName: 'CustomAppModule'`), targeting es2018.
4. Result stored at `apps/{shareCode}.compiledCode` (the `apps` table in
   the gateway's sqlite).

### Shim (`packages/server/src/compilation/reactNativeShims.ts`)
- Inline 500-line template literal injected before user code at compile time.
- Maps RN components to web equivalents: `View`→`div`, `Text`→`span`, etc.
- `TextInput` has terminal-aesthetic defaults (transparent bg, cyan text,
  monospace, green caret) merged under user style. `placeholderTextColor` is
  honored via a scoped `::placeholder` rule.
- When adding RN APIs that compiled apps need, add them here. Anything not in
  the shim won't be defined at runtime.

### Render path
- **Web** (`packages/core/components/DynamicAppRenderer.tsx`): `new Function(...)`
  evals `compiledCode` in the page's JS context. Fast, direct.
- **Mobile** (`packages/core/components/WebViewAppRenderer.tsx`): renders inside
  a `react-native-webview` because **Hermes blocks `new Function`/`eval`**.
  The WebView loads React from a CDN, injects `compiledCode`, and bridges
  state + events back to RN via `postMessage`. (The mobile shell lives in a
  separate repo; this renderer is the web-side contract for it.)
- **Compile endpoint:** lives on the gateway at `POST /api/compile`
  (same origin as everything else — relative URLs work), e.g.
  http://localhost:8765/api/compile.

### Custom-app discovery flow
1. User pushes app from AgenticCoder → gateway upserts into the `apps` table at share-code (ownerId=user)
2. `useRealtimeStateWithAuth.ts` listener auto-loads owned apps into
   `state.customApps` (no manual add).
3. To put a tile in a Space, open the CommandPalette (⌘K on web).
4. `WebDashboard.tsx` routes `state.customApps[id]` through `AppRenderer`,
   which renders it with `DynamicAppRenderer`.

## AI Details
- The gateway hosts a multi-provider proxy at `POST /api/ai/chat` (OpenAI-
  shape wire). Adapters in `packages/server/src/ai/`: Anthropic, OpenAI,
  Gemini, Ollama. Operators register providers via
  `dashterm provider add NAME --kind <…> --model <…> --api-key <…>`;
  each app can route to a different provider via `dashterm provider bind`.
- Default model picks: Anthropic `claude-haiku-4-5`, OpenAI `gpt-4o-mini`,
  Gemini `gemini-3-flash-preview`, Ollama `llama3.2`. Override at request
  time via the `model` field on `/api/ai/chat`.
- The dashboard never sees an API key — keys live in sqlite, owned by the
  gateway process.

## Events Subsystem (cross-app communication)

In-memory pub/sub event bus (`packages/core/registry/eventBus.ts`, singleton
`appEventBus`) lets apps talk to each other. Events are typed `sourceApp:name`;
patterns support exact, `ns:*`, and `*`. **Client-local / per-tab** — events do
not sync across tabs or devices.

- **Custom (vibe-coded) apps** receive an `events` prop from
  `DynamicAppRenderer.tsx`: `events.emit(name, data)` fires `<thisAppId>:name`;
  `events.on(pattern, handler)` returns an unsubscribe fn (subscribe inside a
  `useEffect` — the renderer also auto-drains subscriptions on unmount/recompile).
  The authoring contract is documented in `packages/server/src/agent/session.ts`.
- **Built-in plugins** get `emit`/`subscribe` on their `AppContext` (AI function
  handlers + `events.listens`). Discovery via `getAllEmittedEvents()` /
  `getAllEventListeners()` / `getAllAIFunctions()` (registry — built-ins only).
- **Event links** (automations) live in `state.eventLinks` (`EventLink[]`),
  engine in `packages/core/services/ai/eventLinks.ts`. `executeEventLinkAction`
  routes built-in targets via the registry and custom-app targets via
  `handleCustomAppFunction` (target named `{appNameSanitized}_{fn}`).
- **Always-on wiring** lives in `WebDashboard.tsx` (a top-level `useEffect`
  calling `aiService.registerAppActions` → `initializeEventListeners` →
  `registerDynamicEventLinks`), NOT in the AIAssistant tile — so links fire
  regardless of which tiles are placed.
- **EVENTS SUBSYSTEM overlay** (`packages/core/apps/EventsSubsystem/`, opened with
  **⌘B / Ctrl+B**): live bus monitor + event-link list/toggle/delete + a create-link
  builder. This is the UI for managing automations (replaces doing it via AI chat).
  Note: command id `open-events` must stay in CommandPalette's `SELF_CLOSING` set,
  else the palette closes the overlay the instant it opens.

## Web Dashboard (Spaces)
- Grid: 2-6 columns, 4/6/8/12 rows
- Drag title bar to reposition
- Drag edges/corners to resize
- ⌘K: Command palette
- ⌘J: Agentic Coder · ⌘I: Scheduler · **⌘B / Ctrl+B: Events Subsystem**
- ⌘1-9: Switch spaces
- Title bar shows: App title, ⚡ (AI functions + queryable data), ⚙ (settings), × (close)

## Development Guidelines
1. Always use safe state defaults: `state?.value || defaultValue`
2. Use `useRealtimeStateWithAuth` for state load + write-through to the gateway
3. Break large components (>500 lines) into separate files
4. Web is the target; mobile lives in a separate repo
5. Use Platform.OS conditionals for web-specific styles when porting RN code

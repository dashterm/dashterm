// React Native Web compatibility shims for dynamic app compilation
// These shims are injected into compiled custom apps to provide RN API compatibility in the browser

export const reactNativeShims = `
// React Native Web compatibility shims - these will be available at runtime

// ============ REACT HOOKS ============
// These are extracted from window.React for use in compiled code
const { useState, useEffect, useRef, useCallback, useMemo, useReducer, useContext, useLayoutEffect, useId, useDeferredValue, useTransition, useSyncExternalStore, useInsertionEffect, useDebugValue, useImperativeHandle, forwardRef, memo, createContext, createRef, Children, cloneElement, isValidElement, Fragment } = window.React;

// ============ PLATFORM & DIMENSIONS ============
const Platform = {
  OS: 'web',
  Version: 0,
  select: (options) => options.web !== undefined ? options.web : options.default,
  isPad: false,
  isTVOS: false,
  isTV: false
};

const Dimensions = {
  get: (dim) => dim === 'window'
    ? { width: window.innerWidth, height: window.innerHeight }
    : { width: window.screen.width, height: window.screen.height },
  addEventListener: (type, handler) => {
    window.addEventListener('resize', handler);
    return { remove: () => window.removeEventListener('resize', handler) };
  },
  removeEventListener: (type, handler) => window.removeEventListener('resize', handler)
};

// React Native specific hooks
const useWindowDimensions = () => {
  const [dimensions, setDimensions] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
    scale: window.devicePixelRatio || 1,
    fontScale: 1
  });

  useEffect(() => {
    const handleResize = () => {
      setDimensions({
        width: window.innerWidth,
        height: window.innerHeight,
        scale: window.devicePixelRatio || 1,
        fontScale: 1
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return dimensions;
};

const useColorScheme = () => {
  const [colorScheme, setColorScheme] = useState(
    window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia?.('(prefers-color-scheme: dark)');
    const handler = (e) => setColorScheme(e.matches ? 'dark' : 'light');
    mediaQuery?.addEventListener?.('change', handler);
    return () => mediaQuery?.removeEventListener?.('change', handler);
  }, []);

  return colorScheme;
};

// Accessibility hook
const useAccessibilityInfo = () => ({
  isReduceMotionEnabled: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false,
  isScreenReaderEnabled: false,
  isBoldTextEnabled: false,
  isGrayscaleEnabled: false,
  isInvertColorsEnabled: false,
  isReduceTransparencyEnabled: false
});

// Back handler (no-op on web)
const BackHandler = {
  exitApp: () => {},
  addEventListener: () => ({ remove: () => {} }),
  removeEventListener: () => {}
};

// PixelRatio
const PixelRatio = {
  get: () => window.devicePixelRatio || 1,
  getFontScale: () => 1,
  getPixelSizeForLayoutSize: (layoutSize) => Math.round(layoutSize * (window.devicePixelRatio || 1)),
  roundToNearestPixel: (layoutSize) => Math.round(layoutSize * (window.devicePixelRatio || 1)) / (window.devicePixelRatio || 1)
};

// Appearance API
const Appearance = {
  getColorScheme: () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  addChangeListener: (listener) => {
    const mediaQuery = window.matchMedia?.('(prefers-color-scheme: dark)');
    const handler = (e) => listener({ colorScheme: e.matches ? 'dark' : 'light' });
    mediaQuery?.addEventListener?.('change', handler);
    return { remove: () => mediaQuery?.removeEventListener?.('change', handler) };
  },
  removeChangeListener: () => {}
};

// Vibration (no-op on web, or use navigator.vibrate if available)
const Vibration = {
  vibrate: (pattern) => navigator.vibrate?.(pattern),
  cancel: () => navigator.vibrate?.(0)
};

// Share API
const Share = {
  share: async (content, options) => {
    if (navigator.share) {
      await navigator.share({ title: content.title, text: content.message, url: content.url });
      return { action: 'sharedAction' };
    }
    return { action: 'dismissedAction' };
  }
};

// ============ STYLESHEET ============
const StyleSheet = {
  create: (styles) => {
    const flattenedStyles = {};
    for (const [key, style] of Object.entries(styles)) {
      flattenedStyles[key] = style;
    }
    return flattenedStyles;
  },
  flatten: (styles) => {
    if (!styles) return {};
    if (Array.isArray(styles)) {
      return Object.assign({}, ...styles.filter(Boolean));
    }
    return styles;
  },
  absoluteFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  absoluteFillObject: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  hairlineWidth: 1
};

// ============ HELPER FUNCTIONS ============
// RN treats a numeric lineHeight as density-independent PIXELS, but the DOM
// (and React's unitless-property list) reads a bare lineHeight number as a
// MULTIPLIER -- so RN muscle memory like lineHeight:19 renders as 19x the
// font size (~247px). Coerce numbers that look like pixel line heights (RN
// values are >= the font size) to an explicit px string; leave small values
// (<= 4) alone so a deliberate CSS multiplier like 1.4 still works. Clone only
// when we actually change something -- the input is a shared StyleSheet entry.
const normalizeRNStyle = (s) => {
  if (s && typeof s.lineHeight === 'number' && s.lineHeight > 4) {
    return { ...s, lineHeight: s.lineHeight + 'px' };
  }
  return s;
};
const flattenStyle = (style) => normalizeRNStyle(Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : (style || {}));

// React Native's <View> is a flex container by default — column direction,
// items stretch, do not shrink, position relative. Without these defaults the
// host <div> falls back to CSS block layout and any flexDirection / flex
// children silently break. These mirror what react-native-web sets via its
// "rn-view" base class.
const RN_VIEW_BASE = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'stretch',
  alignContent: 'flex-start',
  flexShrink: 0,
  position: 'relative',
  boxSizing: 'border-box',
  minHeight: 0,
  minWidth: 0,
  margin: 0,
  padding: 0,
  border: '0 solid black',
};

// RN <Text> is essentially inline content. Use display:inline so it composes
// with surrounding flex children the way RN-Web does. Color/font are normally
// supplied by the caller, but inherit-friendly defaults keep nested text sane.
const RN_TEXT_BASE = {
  display: 'inline',
  boxSizing: 'border-box',
  margin: 0,
  padding: 0,
  wordWrap: 'break-word',
};

// ============ BASIC COMPONENTS ============
// RN's onLayout has no DOM equivalent, so measure the host node with a
// ResizeObserver and synthesize the { nativeEvent: { layout } } payload that RN
// code (e.g. charts sizing to their container) expects. Only wired up when a
// component actually passes onLayout, so the common refless View stays a plain
// <div> with no observer overhead.
const __useOnLayout = (onLayout) => {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || typeof onLayout !== 'function') return;
    const fire = () => {
      const r = node.getBoundingClientRect();
      onLayout({ nativeEvent: { layout: { x: node.offsetLeft, y: node.offsetTop, width: r.width, height: r.height } } });
    };
    fire();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(fire);
    ro.observe(node);
    return () => ro.disconnect();
  }, [onLayout]);
  return ref;
};

const View = ({ style, onLayout, ...props }) => {
  const ref = __useOnLayout(onLayout);
  return React.createElement('div', {
    ...props,
    ...(onLayout ? { ref } : {}),
    style: { ...RN_VIEW_BASE, ...flattenStyle(style) },
  });
};

const Text = ({ style, numberOfLines, ellipsizeMode, ...props }) => {
  const flatStyle = { ...RN_TEXT_BASE, ...flattenStyle(style) };
  if (numberOfLines) {
    flatStyle.overflow = 'hidden';
    flatStyle.textOverflow = 'ellipsis';
    flatStyle.display = '-webkit-box';
    flatStyle.WebkitLineClamp = numberOfLines;
    flatStyle.WebkitBoxOrient = 'vertical';
  }
  return React.createElement('span', { ...props, style: flatStyle });
};

const TouchableOpacity = ({ style, onPress, activeOpacity, disabled, ...props }) => {
  return React.createElement('button', {
    ...props,
    disabled,
    style: {
      ...RN_VIEW_BASE,
      border: 'none',
      background: 'transparent',
      padding: 0,
      textAlign: 'inherit',
      font: 'inherit',
      color: 'inherit',
      cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      ...flattenStyle(style)
    },
    onClick: disabled ? undefined : onPress
  });
};

const TouchableHighlight = TouchableOpacity;
const TouchableWithoutFeedback = TouchableOpacity;
const Pressable = ({ style, onPress, disabled, ...props }) => {
  const resolvedStyle = typeof style === 'function' ? style({ pressed: false }) : style;
  return React.createElement('button', {
    ...props,
    disabled,
    style: {
      ...RN_VIEW_BASE,
      border: 'none',
      background: 'transparent',
      padding: 0,
      textAlign: 'inherit',
      font: 'inherit',
      color: 'inherit',
      cursor: disabled ? 'default' : 'pointer',
      ...flattenStyle(resolvedStyle)
    },
    onClick: disabled ? undefined : onPress
  });
};

// ============ INPUT COMPONENTS ============
const TextInput = ({ style, value, onChangeText, onSubmitEditing, placeholder, placeholderTextColor, secureTextEntry, multiline, numberOfLines, keyboardType, autoCapitalize, autoCorrect, editable, maxLength, ...props }) => {
  const flatStyle = flattenStyle(style);
  // Default to the DashTerm terminal aesthetic: transparent dark background,
  // cyan border, cyan text, monospace font. User-supplied style overrides.
  const mergedStyle = {
    background: 'transparent',
    color: '#00ffff',
    fontFamily: '"Courier New", ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 13,
    border: '1px solid #004444',
    borderRadius: 2,
    padding: '6px 8px',
    outline: 'none',
    caretColor: '#00ff00',
    ...flatStyle
  };
  const inputProps = {
    ...props,
    style: mergedStyle,
    placeholder,
    disabled: editable === false,
    maxLength,
    type: secureTextEntry ? 'password' : (keyboardType === 'numeric' || keyboardType === 'number-pad' ? 'number' : 'text')
  };

  if (value !== undefined && onChangeText) {
    inputProps.value = value;
    inputProps.onChange = (e) => onChangeText(e.target.value);
  } else if (value !== undefined) {
    inputProps.defaultValue = value;
  }

  if (onSubmitEditing) {
    inputProps.onKeyDown = (e) => { if (e.key === 'Enter' && !multiline) onSubmitEditing(); };
  }

  // Apply placeholderTextColor via a unique class + scoped <style> rule
  // (React Native maps this prop to the ::placeholder pseudo on web).
  if (placeholderTextColor) {
    const cls = 'rn-ph-' + Math.abs(hashString(String(placeholderTextColor))).toString(36);
    inputProps.className = (inputProps.className ? inputProps.className + ' ' : '') + cls;
    ensurePlaceholderRule(cls, placeholderTextColor);
  } else if (typeof document !== 'undefined') {
    // Default placeholder color matches the terminal aesthetic.
    inputProps.className = (inputProps.className ? inputProps.className + ' ' : '') + 'rn-ph-default';
    ensurePlaceholderRule('rn-ph-default', '#005555');
  }

  if (multiline) {
    return React.createElement('textarea', { ...inputProps, rows: numberOfLines || 4 });
  }
  return React.createElement('input', inputProps);
};

function hashString(s) {
  var h = 0;
  for (var i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
  return h;
}

function ensurePlaceholderRule(cls, color) {
  if (typeof document === 'undefined') return;
  if (document.getElementById('rn-ph-style-' + cls)) return;
  var style = document.createElement('style');
  style.id = 'rn-ph-style-' + cls;
  style.textContent = '.' + cls + '::placeholder { color: ' + color + '; opacity: 1; }';
  document.head.appendChild(style);
}

const Switch = ({ value, onValueChange, disabled, trackColor, thumbColor, ...props }) => {
  return React.createElement('input', {
    type: 'checkbox',
    checked: value,
    onChange: (e) => onValueChange && onValueChange(e.target.checked),
    disabled,
    style: { cursor: disabled ? 'default' : 'pointer' }
  });
};

// ============ SCROLL & LIST COMPONENTS ============
const ScrollView = ({ style, contentContainerStyle, horizontal, showsVerticalScrollIndicator, showsHorizontalScrollIndicator, ...props }) => {
  return React.createElement('div', {
    ...props,
    style: {
      ...RN_VIEW_BASE,
      overflow: 'auto',
      flexDirection: horizontal ? 'row' : 'column',
      ...flattenStyle(style)
    }
  });
};

const FlatList = ({ data, renderItem, keyExtractor, style, contentContainerStyle, ListHeaderComponent, ListFooterComponent, ListEmptyComponent, horizontal, numColumns, ItemSeparatorComponent, ...props }) => {
  const items = data || [];
  const containerStyle = {
    ...RN_VIEW_BASE,
    overflow: 'auto',
    flexDirection: horizontal ? 'row' : 'column',
    ...flattenStyle(style)
  };

  const innerStyle = numColumns > 1
    ? {
        display: 'grid',
        gridTemplateColumns: \`repeat(\${numColumns}, 1fr)\`,
        ...flattenStyle(contentContainerStyle)
      }
    : { ...RN_VIEW_BASE, ...flattenStyle(contentContainerStyle) };

  const children = [];

  if (ListHeaderComponent) {
    children.push(React.createElement('div', { key: '__header__' },
      typeof ListHeaderComponent === 'function' ? React.createElement(ListHeaderComponent) : ListHeaderComponent
    ));
  }

  if (items.length === 0 && ListEmptyComponent) {
    children.push(React.createElement('div', { key: '__empty__' },
      typeof ListEmptyComponent === 'function' ? React.createElement(ListEmptyComponent) : ListEmptyComponent
    ));
  } else {
    items.forEach((item, index) => {
      const key = keyExtractor ? keyExtractor(item, index) : (item.key || item.id || index);
      children.push(React.createElement('div', { key }, renderItem({ item, index })));
      if (ItemSeparatorComponent && index < items.length - 1) {
        children.push(React.createElement('div', { key: \`sep_\${index}\` },
          typeof ItemSeparatorComponent === 'function' ? React.createElement(ItemSeparatorComponent) : ItemSeparatorComponent
        ));
      }
    });
  }

  if (ListFooterComponent) {
    children.push(React.createElement('div', { key: '__footer__' },
      typeof ListFooterComponent === 'function' ? React.createElement(ListFooterComponent) : ListFooterComponent
    ));
  }

  return React.createElement('div', { style: containerStyle },
    React.createElement('div', { style: innerStyle }, children)
  );
};

const SectionList = ({ sections, renderItem, renderSectionHeader, keyExtractor, style, contentContainerStyle, ListHeaderComponent, ListFooterComponent, ListEmptyComponent, ...props }) => {
  const containerStyle = { ...RN_VIEW_BASE, overflow: 'auto', ...flattenStyle(style) };
  const children = [];

  if (ListHeaderComponent) {
    children.push(React.createElement('div', { key: '__header__' },
      typeof ListHeaderComponent === 'function' ? React.createElement(ListHeaderComponent) : ListHeaderComponent
    ));
  }

  const allSections = sections || [];
  if (allSections.length === 0 && ListEmptyComponent) {
    children.push(React.createElement('div', { key: '__empty__' },
      typeof ListEmptyComponent === 'function' ? React.createElement(ListEmptyComponent) : ListEmptyComponent
    ));
  } else {
    allSections.forEach((section, sectionIndex) => {
      if (renderSectionHeader) {
        children.push(React.createElement('div', { key: \`section_\${sectionIndex}\` },
          renderSectionHeader({ section })
        ));
      }
      (section.data || []).forEach((item, itemIndex) => {
        const key = keyExtractor ? keyExtractor(item, itemIndex) : (item.key || item.id || \`\${sectionIndex}_\${itemIndex}\`);
        children.push(React.createElement('div', { key }, renderItem({ item, index: itemIndex, section })));
      });
    });
  }

  if (ListFooterComponent) {
    children.push(React.createElement('div', { key: '__footer__' },
      typeof ListFooterComponent === 'function' ? React.createElement(ListFooterComponent) : ListFooterComponent
    ));
  }

  return React.createElement('div', { style: containerStyle },
    React.createElement('div', { style: { ...RN_VIEW_BASE, ...flattenStyle(contentContainerStyle) } }, children)
  );
};

// ============ IMAGE COMPONENT ============
const Image = ({ source, style, resizeMode, ...props }) => {
  const src = source?.uri || (typeof source === 'string' ? source : '');
  const flatStyle = flattenStyle(style);
  if (resizeMode) {
    flatStyle.objectFit = resizeMode === 'contain' ? 'contain' : resizeMode === 'cover' ? 'cover' : resizeMode === 'stretch' ? 'fill' : 'contain';
  }
  return React.createElement('img', { ...props, src, style: flatStyle });
};

const ImageBackground = ({ source, style, imageStyle, children, resizeMode, ...props }) => {
  const src = source?.uri || (typeof source === 'string' ? source : '');
  const flatStyle = flattenStyle(style);
  flatStyle.backgroundImage = src ? \`url(\${src})\` : undefined;
  flatStyle.backgroundSize = resizeMode === 'cover' ? 'cover' : resizeMode === 'contain' ? 'contain' : 'cover';
  flatStyle.backgroundPosition = 'center';
  flatStyle.backgroundRepeat = 'no-repeat';
  return React.createElement('div', { ...props, style: flatStyle }, children);
};

// ============ MODAL & OVERLAY ============
const Modal = ({ visible, transparent, animationType, onRequestClose, children, ...props }) => {
  if (!visible) return null;
  return React.createElement('div', {
    style: {
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: transparent ? 'transparent' : 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999
    },
    onClick: (e) => { if (e.target === e.currentTarget && onRequestClose) onRequestClose(); }
  }, children);
};

// ============ ACTIVITY INDICATOR ============
const ActivityIndicator = ({ size, color, animating, ...props }) => {
  if (animating === false) return null;
  const sizeVal = size === 'large' ? 36 : size === 'small' ? 20 : (typeof size === 'number' ? size : 24);
  return React.createElement('div', {
    style: {
      width: sizeVal,
      height: sizeVal,
      border: \`3px solid \${color || '#00ffff'}\`,
      borderTopColor: 'transparent',
      borderRadius: '50%',
      animation: 'spin 1s linear infinite'
    }
  });
};

// ============ SAFE AREA ============
const SafeAreaView = View;

// ============ STATUS BAR ============
const StatusBar = () => null;

// ============ KEYBOARD ============
const Keyboard = {
  dismiss: () => { if (document.activeElement) document.activeElement.blur(); },
  addListener: () => ({ remove: () => {} }),
  removeListener: () => {},
  removeAllListeners: () => {}
};

const KeyboardAvoidingView = View;

// ============ ALERT ============
const Alert = {
  alert: (title, message, buttons) => {
    if (buttons && buttons.length > 0) {
      const result = window.confirm(\`\${title}\\n\\n\${message || ''}\`);
      const btn = result ? buttons.find(b => b.style !== 'cancel') : buttons.find(b => b.style === 'cancel');
      if (btn && btn.onPress) btn.onPress();
    } else {
      window.alert(\`\${title}\\n\\n\${message || ''}\`);
    }
  }
};

// ============ LINKING ============
const Linking = {
  openURL: (url) => { window.open(url, '_blank'); return Promise.resolve(); },
  canOpenURL: () => Promise.resolve(true),
  getInitialURL: () => Promise.resolve(window.location.href)
};

// ============ CLIPBOARD ============
const Clipboard = {
  setString: (text) => navigator.clipboard?.writeText(text),
  getString: () => navigator.clipboard?.readText() || Promise.resolve('')
};

// ============ ANIMATED (Basic) ============
const Animated = {
  View,
  Text,
  Image,
  ScrollView,
  FlatList,
  Value: class { constructor(v) { this._value = v; } },
  timing: () => ({ start: (cb) => cb && cb() }),
  spring: () => ({ start: (cb) => cb && cb() }),
  sequence: () => ({ start: (cb) => cb && cb() }),
  parallel: () => ({ start: (cb) => cb && cb() }),
  delay: () => ({ start: (cb) => cb && cb() }),
  event: () => () => {},
  add: () => new Animated.Value(0),
  subtract: () => new Animated.Value(0),
  multiply: () => new Animated.Value(0),
  divide: () => new Animated.Value(0),
  createAnimatedComponent: (c) => c
};

// ============ APP STATE ============
const AppState = {
  currentState: 'active',
  addEventListener: () => ({ remove: () => {} }),
  removeEventListener: () => {}
};

// ============ REFRESH CONTROL ============
const RefreshControl = ({ refreshing, onRefresh, colors, tintColor, ...props }) => {
  if (!refreshing) return null;
  return React.createElement('div', {
    style: { textAlign: 'center', padding: 10, color: tintColor || colors?.[0] || '#00ffff' }
  }, 'Refreshing...');
};

// ============ REACT-NATIVE-SVG ============
// react-native-svg primitives mapped to native SVG DOM elements. React renders
// SVG tags directly, and RN-svg prop names (x, y, cx, d, fill, stroke,
// strokeWidth, strokeDasharray, textAnchor, fontSize, gradientUnits, ...) line
// up with the camelCase SVG attributes React already understands, so each shim
// is a thin passthrough that just flattens an optional RN style object. The SVG
// <text> element collides with RN's <Text>, so it is exposed as the global
// SvgText and as Svg.Text -- never as a bare Text. Symbol lives only on the
// namespace so it can't shadow the JS Symbol built-in inside the IIFE.
const __svgEl = (tag) => ({ style, children, ...props }) =>
  React.createElement(tag, style ? { ...props, style: flattenStyle(style) } : props, children);

const Rect = __svgEl('rect');
const Circle = __svgEl('circle');
const Ellipse = __svgEl('ellipse');
const Line = __svgEl('line');
const Polyline = __svgEl('polyline');
const Polygon = __svgEl('polygon');
const Path = __svgEl('path');
const G = __svgEl('g');
const Defs = __svgEl('defs');
const LinearGradient = __svgEl('linearGradient');
const RadialGradient = __svgEl('radialGradient');
const Stop = __svgEl('stop');
const ClipPath = __svgEl('clipPath');
const Mask = __svgEl('mask');
const Pattern = __svgEl('pattern');
const Marker = __svgEl('marker');
const Use = __svgEl('use');
const TSpan = __svgEl('tspan');
const TextPath = __svgEl('textPath');
const ForeignObject = __svgEl('foreignObject');
const SvgText = __svgEl('text');

const Svg = ({ style, children, ...props }) =>
  React.createElement('svg', style ? { ...props, style: flattenStyle(style) } : props, children);

// react-native-svg's default export also exposes every primitive as a property,
// so "import Svg from 'react-native-svg'" with <Svg.Path/> / <Svg.Text/> works no
// matter how a named import was aliased before import-stripping removed it.
Object.assign(Svg, {
  Rect, Circle, Ellipse, Line, Polyline, Polygon, Path, G, Defs,
  LinearGradient, RadialGradient, Stop, ClipPath, Mask, Pattern, Marker,
  Use, TSpan, TextPath, ForeignObject, Text: SvgText, Symbol: __svgEl('symbol')
});

// Add CSS animation for spinner
if (typeof document !== 'undefined' && !document.getElementById('rn-shim-styles')) {
  const style = document.createElement('style');
  style.id = 'rn-shim-styles';
  style.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
  document.head.appendChild(style);
}

// ============ DASHTERM (secrets + AI) ============
// The bridge to gateway services available to every custom app.
//   dashterm.secrets.fetch(url, opts)  — call a 3rd-party API using a stored
//       secret WITHOUT seeing its value: put {{secret.NAME}} in url/headers/body
//       and the gateway substitutes it server-side. Resolves to
//       { status, ok, headers, body }.
//   dashterm.secrets.names()           — resolves to a string[] of your secret
//       names (for building pickers); never returns values.
//   dashterm.vars.get(name)            — resolves to the VALUE of a stored
//       variable: non-secret config (a base URL, hostname, username) the user
//       can see and edit. dashterm.vars.all() resolves to a { name: value }
//       map; dashterm.vars.names() to a string[]. Use {{var.NAME}} in a
//       secrets.fetch request to substitute one server-side, exactly like
//       {{secret.NAME}}. Keep credentials in secrets, not vars.
//   dashterm.ai.chat(messages, opts?)  — OpenAI-shaped chat routed to the
//       provider bound to this app (or the default). Resolves to the gateway's
//       chat response.
// On web these hit the gateway directly (cookie-authed); inside the mobile
// WebView they delegate to DashTermBridge.request so the native shell, which
// holds the session, makes the authenticated call.
const __mfRequest = function (path, init) {
  if (typeof window !== 'undefined' && window.DashTermBridge && typeof window.DashTermBridge.request === 'function') {
    return window.DashTermBridge.request(path, init || {});
  }
  // Gateway base — the same origin the dashboard's own /api calls use. Falls
  // back to the per-app relay base, then same-origin.
  const base = (typeof window !== 'undefined' && typeof window.DASHTERM_GATEWAY_BASE === 'string')
    ? window.DASHTERM_GATEWAY_BASE
    : ((typeof window !== 'undefined' && window.DASHTERM_API_BASE) || '');
  return fetch(base + path, Object.assign({ credentials: 'include' }, init)).then(function (r) {
    return r.text().then(function (t) {
      let data;
      try { data = t ? JSON.parse(t) : null; } catch (e) { data = t; }
      if (!r.ok) {
        throw new Error((data && data.error) ? data.error : ('HTTP ' + r.status));
      }
      return data;
    });
  });
};
const dashterm = {
  secrets: {
    fetch: function (url, options) {
      options = options || {};
      return __mfRequest('/api/secrets/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: url,
          method: options.method,
          headers: options.headers,
          body: options.body,
        }),
      });
    },
    names: function () {
      return __mfRequest('/api/secrets', { method: 'GET' }).then(function (d) {
        return d && d.secrets ? d.secrets.map(function (s) { return s.name; }) : [];
      });
    },
  },
  vars: {
    all: function () {
      return __mfRequest('/api/vars', { method: 'GET' }).then(function (d) {
        var out = {};
        var list = d && d.vars ? d.vars : [];
        for (var i = 0; i < list.length; i++) { out[list[i].name] = list[i].value; }
        return out;
      });
    },
    get: function (name) {
      return dashterm.vars.all().then(function (m) { return m[name]; });
    },
    names: function () {
      return __mfRequest('/api/vars', { method: 'GET' }).then(function (d) {
        return d && d.vars ? d.vars.map(function (v) { return v.name; }) : [];
      });
    },
  },
  ai: {
    chat: function (messages, opts) {
      opts = opts || {};
      return __mfRequest('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appId: opts.appId,
          messages: messages,
          temperature: opts.temperature,
          maxTokens: opts.maxTokens,
          tools: opts.tools,
          model: opts.model,
        }),
      });
    },
  },
};
if (typeof window !== 'undefined') {
  window.dashterm = dashterm;
}
`;

/**
 * Autostart unit templates for `dashterm start` (the native gateway).
 *
 * Placeholders:
 *   {{NODE_BIN}}        absolute path to the Node binary
 *   {{DASHTERM_BIN}}   absolute path to the `dashterm` CLI entry
 *   {{HOME}}            user's home directory
 *   {{DATA_DIR}}        DASHTERM_DATA_DIR (~/.dashterm by default)
 *   {{PORT}}            DASHTERM_PORT (8765 by default)
 *   {{BIND}}            DASHTERM_BIND (127.0.0.1 by default)
 *   {{LOG_PATH}}        ~/.dashterm/gateway.log
 *   {{ERR_LOG_PATH}}    ~/.dashterm/gateway.err.log
 */

export const MACOS_PLIST_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>com.dashterm.gateway</string>
    <key>ProgramArguments</key>
    <array>
      <string>{{NODE_BIN}}</string>
      <string>{{DASHTERM_BIN}}</string>
      <string>start</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
      <key>SuccessfulExit</key>
      <false/>
      <key>Crashed</key>
      <true/>
    </dict>
    <key>WorkingDirectory</key>
    <string>{{HOME}}</string>
    <key>StandardOutPath</key>
    <string>{{LOG_PATH}}</string>
    <key>StandardErrorPath</key>
    <string>{{ERR_LOG_PATH}}</string>
    <key>EnvironmentVariables</key>
    <dict>
      <key>PATH</key>
      <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
      <key>DASHTERM_DATA_DIR</key>
      <string>{{DATA_DIR}}</string>
      <key>DASHTERM_PORT</key>
      <string>{{PORT}}</string>
      <key>DASHTERM_BIND</key>
      <string>{{BIND}}</string>
      {{EXTRA_ENV}}
    </dict>
    <key>ProcessType</key>
    <string>Background</string>
  </dict>
</plist>
`;

export const LINUX_SERVICE_TEMPLATE = `[Unit]
Description=DashTerm native gateway
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=DASHTERM_DATA_DIR={{DATA_DIR}}
Environment=DASHTERM_PORT={{PORT}}
Environment=DASHTERM_BIND={{BIND}}
Environment=PATH=/usr/local/bin:/usr/bin:/bin
{{EXTRA_ENV}}
ExecStart={{NODE_BIN}} {{DASHTERM_BIN}} start
WorkingDirectory={{HOME}}
Restart=on-failure
RestartSec=5
StandardOutput=append:{{LOG_PATH}}
StandardError=append:{{ERR_LOG_PATH}}

[Install]
WantedBy=default.target
`;

export function renderTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_m, key) => vars[key] ?? '');
}

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
 *
 * Windows-only extras:
 *   {{TASK_SCRIPT}}     absolute path to the generated gateway.cmd launcher
 *   {{DESCRIPTION}}     scheduled-task description string
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

/**
 * Windows Task Scheduler spec. The launchd/systemd analog of "run at login,
 * no admin" is a Scheduled Task with a LogonTrigger + LeastPrivilege run
 * level. We register it from XML (schtasks /Create /XML) rather than the bare
 * CLI flags so we can express crash-restart and on-battery behaviour:
 *   - <RestartOnFailure> ≈ launchd KeepAlive / systemd Restart=on-failure
 *   - DisallowStartIfOnBatteries=false keeps the gateway alive on laptops
 *   - MultipleInstancesPolicy=IgnoreNew = single instance, like the others
 * The action points at {{TASK_SCRIPT}} (gateway.cmd) which sets DASHTERM_*
 * env then runs the gateway — mirroring the env baked into the plist/unit.
 *
 * NOTE: schtasks /XML expects UTF-16 LE with a BOM; the writer handles that.
 */
export const WINDOWS_TASK_XML_TEMPLATE = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>{{DESCRIPTION}}</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>3</Count>
    </RestartOnFailure>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>{{TASK_SCRIPT}}</Command>
    </Exec>
  </Actions>
</Task>
`;

/**
 * The gateway.cmd the scheduled task runs. Sets DASHTERM_* env (the Windows
 * equivalent of the plist EnvironmentVariables / systemd Environment= lines)
 * then launches the gateway in the foreground so the task stays "Running"
 * for as long as node lives. stdout/stderr are appended to the same log
 * files the plist/unit redirect to. Written CRLF, UTF-8 without BOM.
 */
export const WINDOWS_TASK_SCRIPT_TEMPLATE = `@echo off
rem DashTerm native gateway (autostart)
set "DASHTERM_DATA_DIR={{DATA_DIR}}"
set "DASHTERM_PORT={{PORT}}"
set "DASHTERM_BIND={{BIND}}"
{{EXTRA_ENV}}
"{{NODE_BIN}}" "{{DASHTERM_BIN}}" start >> "{{LOG_PATH}}" 2>> "{{ERR_LOG_PATH}}"
`;

export function renderTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_m, key) => vars[key] ?? '');
}

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PROBE_INTERVAL_MS = 45 * 1000;
const PROBE_TIMEOUT_MS = 12 * 1000;
const FAILURE_THRESHOLD = 3;
const FRAME_FAILURE_WINDOW_MS = 5 * 60 * 1000;
const MAX_RESTARTS_PER_HOUR = 3;
const RESTART_HISTORY_WINDOW_MS = 60 * 60 * 1000;
const RESTART_HISTORY_FILE = path.join(os.tmpdir(), 'chaos-bot-whatsapp-restarts.json');
const MANUAL_ACTION_STATES = new Set(['UNPAIRED', 'UNPAIRED_IDLE', 'PAIRING']);
const monitors = new WeakMap();

function isWhatsAppFrameError(error) {
    const message = String(error && error.message || error || '');
    return /detached frame|target closed|execution context was destroyed|cannot find context with specified id|session closed|protocol error \(runtime\.callfunctionon\): promise was collected/i.test(message);
}

function readRestartHistory(now) {
    try {
        const values = JSON.parse(fs.readFileSync(RESTART_HISTORY_FILE, 'utf8'));
        if (!Array.isArray(values)) return [];
        return values.filter(value =>
            Number.isFinite(value) &&
            value <= now &&
            now - value < RESTART_HISTORY_WINDOW_MS
        );
    } catch (_) {
        return [];
    }
}

function reserveRestartSlot(now) {
    const history = readRestartHistory(now);
    if (history.length >= MAX_RESTARTS_PER_HOUR) {
        return { allowed: false, count: history.length };
    }

    history.push(now);
    try {
        fs.writeFileSync(RESTART_HISTORY_FILE, JSON.stringify(history), { mode: 0o600 });
    } catch (error) {
        console.error('[WA WATCHDOG] Could not save restart-rate history:', error.message);
    }
    return { allowed: true, count: history.length };
}

function startWhatsAppHealthWatchdog(client) {
    if (!client || typeof client.getState !== 'function' || monitors.has(client)) return;

    let consecutiveFailures = 0;
    let probeInProgress = false;
    let restartInProgress = false;
    let restartSuppressed = false;
    let lastManualState = '';
    let recentFrameFailures = [];

    function resetFailures() {
        if (consecutiveFailures > 0) {
            console.log('[WA WATCHDOG] WhatsApp connection check recovered.');
        }
        consecutiveFailures = 0;
        lastManualState = '';
    }

    function restartThroughPm2(reason) {
        if (restartInProgress || restartSuppressed) return;

        const now = Date.now();
        const reservation = reserveRestartSlot(now);
        if (!reservation.allowed) {
            restartSuppressed = true;
            console.error(
                '[WA WATCHDOG] Restart suppressed after ' + reservation.count +
                ' automatic restarts in the last hour. Check the WhatsApp session and PM2 logs.'
            );
            return;
        }

        restartInProgress = true;
        console.error('[WA WATCHDOG] WhatsApp remains unhealthy; restarting chaos-bot through PM2. Reason: ' + reason);

        const pm2Command = process.platform === 'win32' ? 'pm2.cmd' : 'pm2';
        execFile(
            pm2Command,
            ['restart', 'chaos-bot', '--node-args=--max-old-space-size=1024'],
            {
                cwd: path.resolve(__dirname, '../..'),
                windowsHide: true
            },
            (error, stdout, stderr) => {
                if (error) {
                    console.error('[WA WATCHDOG] PM2 restart command failed; exiting so PM2 can recover the process:', error.message);
                    if (stderr) console.error(stderr);
                    setTimeout(() => process.exit(1), 500);
                    return;
                }

                console.log('[WA WATCHDOG] PM2 accepted the incident recovery restart.');
                if (stdout) console.log(stdout.trim());
            }
        );
    }

    function recordProbeFailure(reason) {
        consecutiveFailures += 1;
        console.error(
            '[WA WATCHDOG] WhatsApp health probe failed (' +
            consecutiveFailures + '/' + FAILURE_THRESHOLD + '): ' + reason
        );
        if (consecutiveFailures >= FAILURE_THRESHOLD) restartThroughPm2(reason);
    }

    async function probe() {
        if (probeInProgress || restartInProgress || restartSuppressed) return;
        probeInProgress = true;

        let timeoutHandle;
        try {
            const page = client.pupPage;
            if (page && typeof page.isClosed === 'function' && page.isClosed()) {
                throw new Error('WhatsApp Web browser page is closed.');
            }

            const state = await Promise.race([
                client.getState(),
                new Promise((_, reject) => {
                    timeoutHandle = setTimeout(
                        () => reject(new Error('WhatsApp connection-state probe timed out.')),
                        PROBE_TIMEOUT_MS
                    );
                })
            ]);

            if (state === 'CONNECTED') {
                resetFailures();
                return;
            }

            if (MANUAL_ACTION_STATES.has(String(state || '').toUpperCase())) {
                const manualState = String(state).toUpperCase();
                if (lastManualState !== manualState) {
                    console.error(
                        '[WA WATCHDOG] WhatsApp state is ' + manualState +
                        '; a new device link may be required, so automatic restarts are paused.'
                    );
                    lastManualState = manualState;
                }
                consecutiveFailures = 0;
                return;
            }

            recordProbeFailure('client.getState() returned ' + String(state || 'no state'));
        } catch (error) {
            recordProbeFailure(error.message);
        } finally {
            if (timeoutHandle) clearTimeout(timeoutHandle);
            probeInProgress = false;
        }
    }

    function reportFrameFailure(error) {
        const now = Date.now();
        recentFrameFailures = recentFrameFailures.filter(
            timestamp => now - timestamp < FRAME_FAILURE_WINDOW_MS
        );
        recentFrameFailures.push(now);

        console.error('[WA WATCHDOG] A WhatsApp browser-frame error occurred during message handling.');

        if (recentFrameFailures.length >= 2) {
            restartThroughPm2('repeated detached-frame errors during message handling');
            return;
        }

        // A failed frame operation is one warning; verify the client state before restarting.
        consecutiveFailures = Math.max(consecutiveFailures, FAILURE_THRESHOLD - 1);
        void probe();
    }

    monitors.set(client, { reportFrameFailure });

    client.on('change_state', state => {
        if (state === 'CONNECTED') resetFailures();
    });

    client.on('ready', resetFailures);

    client.on('disconnected', reason => {
        const reasonText = String(reason || 'unknown');
        if (/LOGOUT|UNPAIRED/i.test(reasonText)) {
            console.error(
                '[WA WATCHDOG] WhatsApp disconnected with reason ' + reasonText +
                '; automatic restarts are paused because re-linking may be required.'
            );
            return;
        }

        consecutiveFailures = Math.max(consecutiveFailures, FAILURE_THRESHOLD - 1);
        void probe();
    });

    const timer = setInterval(() => { void probe(); }, PROBE_INTERVAL_MS);
    if (typeof timer.unref === 'function') timer.unref();

    console.log('[WA WATCHDOG] WhatsApp health watchdog active; probing every 45 seconds.');
    void probe();
}

function reportWhatsAppFrameFailure(client, error) {
    if (!isWhatsAppFrameError(error)) return false;
    const monitor = client && monitors.get(client);
    if (monitor) monitor.reportFrameFailure(error);
    return true;
}

module.exports = {
    isWhatsAppFrameError,
    reportWhatsAppFrameFailure,
    startWhatsAppHealthWatchdog
};

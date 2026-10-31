const { execFile } = require('child_process');
const path = require('path');
const cron = require('node-cron');
const { getActivitySnapshot } = require('../bot/activity');
const { hasActiveGames } = require('../games/activeGameStatus');

const RESTART_CRON = '10 3 * * *';
const TIMEZONE = 'Africa/Nairobi';
const IDLE_CHECK_INTERVAL_MS = 60 * 1000;

let scheduled = false;
let restartDue = false;
let restartInProgress = false;
let lastBlocker = '';
let lastRestartErrorAt = 0;

function getRestartBlocker() {
    const activity = getActivitySnapshot();

    if (activity.activeHandlers > 0) {
        return `still processing ${activity.activeHandlers} incoming message(s)`;
    }

    if (activity.idleForMs < activity.requiredIdleMs) {
        const minutesIdle = Math.floor(activity.idleForMs / 60_000);
        return `only ${minutesIdle} minute(s) have been idle; 15 minutes are required`;
    }

    if (hasActiveGames()) {
        return 'a game session is still active';
    }

    return '';
}

function attemptScheduledRestart() {
    if (!restartDue || restartInProgress) return;

    let blocker;
    try {
        blocker = getRestartBlocker();
    } catch (error) {
        blocker = `idle check failed: ${error.message}`;
    }

    if (blocker) {
        if (blocker !== lastBlocker) {
            console.log(`[SCHEDULED RESTART] Deferred: ${blocker}.`);
            lastBlocker = blocker;
        }
        return;
    }

    restartInProgress = true;
    lastBlocker = '';
    console.log('[SCHEDULED RESTART] Idle window is clear; restarting chaos-bot through PM2.');

    // Match the existing !owner restart PM2 command, with a final idle check before it runs.
    setTimeout(() => {
        let finalBlocker;
        try {
            finalBlocker = getRestartBlocker();
        } catch (error) {
            finalBlocker = `idle check failed: ${error.message}`;
        }

        if (finalBlocker) {
            restartInProgress = false;
            lastBlocker = '';
            console.log(`[SCHEDULED RESTART] Cancelled before PM2 restart: ${finalBlocker}.`);
            return;
        }

        const pm2Command = process.platform === 'win32' ? 'pm2.cmd' : 'pm2';
        execFile(
            pm2Command,
            ['restart', 'chaos-bot', '--node-args=--max-old-space-size=1024'],
            {
                cwd: path.resolve(__dirname, '../..'),
                windowsHide: true
            },
            (error, stdout, stderr) => {
                restartInProgress = false;

                if (error) {
                    restartDue = true;
                    const now = Date.now();
                    if (now - lastRestartErrorAt >= 5 * 60 * 1000) {
                        console.error('[SCHEDULED RESTART] PM2 restart failed; will retry while idle:', error.message);
                        if (stderr) console.error(stderr);
                        lastRestartErrorAt = now;
                    }
                    return;
                }

                restartDue = false;
                console.log('[SCHEDULED RESTART] PM2 accepted the daily restart.');
                if (stdout) console.log(stdout.trim());
            }
        );
    }, 1500);
}

function startScheduledRestart() {
    if (scheduled) return;
    scheduled = true;

    cron.schedule(RESTART_CRON, () => {
        if (!restartDue) {
            restartDue = true;
            console.log('[SCHEDULED RESTART] 03:10 Africa/Nairobi restart is due; checking for an idle window.');
        }
        attemptScheduledRestart();
    }, {
        name: 'chaos-bot-daily-idle-restart',
        timezone: TIMEZONE,
        noOverlap: true
    });

    const idleCheckTimer = setInterval(attemptScheduledRestart, IDLE_CHECK_INTERVAL_MS);
    if (typeof idleCheckTimer.unref === 'function') idleCheckTimer.unref();

    console.log('[SCHEDULED RESTART] Daily idle restart scheduled for 03:10 Africa/Nairobi.');
}

module.exports = { startScheduledRestart };

const RESTART_IDLE_MS = 15 * 60 * 1000;

let lastActivityAt = Date.now();
let activeHandlers = 0;

function beginIncomingActivity() {
    lastActivityAt = Date.now();
    activeHandlers += 1;
    let completed = false;

    return () => {
        if (completed) return;
        completed = true;
        activeHandlers = Math.max(0, activeHandlers - 1);
        lastActivityAt = Date.now();
    };
}

function getActivitySnapshot() {
    return {
        lastActivityAt,
        activeHandlers,
        idleForMs: Date.now() - lastActivityAt,
        requiredIdleMs: RESTART_IDLE_MS
    };
}

module.exports = { beginIncomingActivity, getActivitySnapshot, RESTART_IDLE_MS };

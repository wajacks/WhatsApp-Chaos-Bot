const { getNairobiCalendarDay } = require('../../utils/nairobiTime');

const CLASS_TERMS = /\b(?:class(?:es)?|lecture(?:s)?|lesson(?:s)?|unit(?:s)?|timetable|schedule)\b/i;
const RELATIVE_DAY = /\b(today|tomorrow)\b/i;
const QUESTION_INTENT = /\b(?:what|which|do i have|will i have|am i having|tell me|show me|list|any|what's|whats)\b/i;

function getRequestedOffset(prompt) {
    const text = String(prompt || '').trim();
    if (!CLASS_TERMS.test(text) || !RELATIVE_DAY.test(text)) return null;
    if (!QUESTION_INTENT.test(text) && !/\?\s*$/.test(text)) return null;
    return /\btomorrow\b/i.test(text) ? 1 : 0;
}

function buildRelativeClassScheduleReply(prompt, getMyClassPortalSummary, referenceDate = new Date()) {
    const offset = getRequestedOffset(prompt);
    if (offset === null || typeof getMyClassPortalSummary !== 'function') return null;

    let summary;
    try {
        summary = getMyClassPortalSummary();
    } catch (error) {
        console.error('[AI CLASS SCHEDULE] Could not read the Class Portal timetable:', error.message);
        return 'I could not read your Class Portal timetable right now. Please try again shortly.';
    }

    if (!summary || !summary.authorized) {
        return String(summary && summary.message || 'Your Class Portal timetable is unavailable.');
    }

    const target = getNairobiCalendarDay(offset, referenceDate);
    const classes = Array.isArray(summary.classes) ? summary.classes : [];
    const entries = [];

    for (const classData of classes) {
        const schedule = Array.isArray(classData.schedule) ? classData.schedule : [];
        for (const item of schedule) {
            const matchesDate = item.date
                ? String(item.date) === target.dateKey
                : String(item.day || '').toLowerCase() === target.weekday;
            if (!matchesDate || !String(item.unit || '').trim()) continue;
            entries.push({
                className: String(classData.className || '').trim(),
                unit: String(item.unit).trim(),
                time: String(item.time || '').trim()
            });
        }
    }

    const dayWord = offset === 1 ? 'Tomorrow' : 'Today';
    const dateSentence = 'In Nairobi time, ' + dayWord.toLowerCase() + ' is ' +
        target.weekdayLabel + ', ' + target.dateLabel + '.';

    if (!entries.length) {
        return dateSentence + ' I do not see any classes listed for you that day in the Class Portal timetable.';
    }

    const includeClassName = classes.length > 1;
    const lines = entries.map(entry => {
        const classLabel = includeClassName && entry.className ? ' (' + entry.className + ')' : '';
        const timeLabel = entry.time ? ' at ' + entry.time : '';
        return '• ' + entry.unit + classLabel + timeLabel;
    });

    return dateSentence + ' Your Class Portal timetable lists:\\n' + lines.join('\\n');
}

module.exports = { buildRelativeClassScheduleReply, getRequestedOffset };

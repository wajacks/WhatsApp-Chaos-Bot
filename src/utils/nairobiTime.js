const NAIROBI_TIME_ZONE = 'Africa/Nairobi';

function getNairobiCalendarDay(offsetDays = 0, referenceDate = new Date()) {
    const offset = Number.isInteger(offsetDays) ? offsetDays : 0;
    const dateParts = Object.fromEntries(
        new Intl.DateTimeFormat('en-CA', {
            timeZone: NAIROBI_TIME_ZONE,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).formatToParts(referenceDate).map(part => [part.type, part.value])
    );

    // Build a UTC calendar date from Nairobi's local date parts, then move by whole calendar days.
    const calendarDate = new Date(Date.UTC(
        Number(dateParts.year),
        Number(dateParts.month) - 1,
        Number(dateParts.day) + offset
    ));
    const year = calendarDate.getUTCFullYear();
    const month = String(calendarDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(calendarDate.getUTCDate()).padStart(2, '0');
    const weekdayLabel = new Intl.DateTimeFormat('en-US', {
        timeZone: 'UTC',
        weekday: 'long'
    }).format(calendarDate);
    const dateLabel = new Intl.DateTimeFormat('en-KE', {
        timeZone: 'UTC',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    }).format(calendarDate);

    return {
        dateKey: year + '-' + month + '-' + day,
        weekday: weekdayLabel.toLowerCase(),
        weekdayLabel,
        dateLabel
    };
}

function getNairobiDateTime(referenceDate = new Date()) {
    const calendarDay = getNairobiCalendarDay(0, referenceDate);
    const time = new Intl.DateTimeFormat('en-KE', {
        timeZone: NAIROBI_TIME_ZONE,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    }).format(referenceDate);

    return {
        ...calendarDay,
        time,
        timeZone: NAIROBI_TIME_ZONE
    };
}

module.exports = { NAIROBI_TIME_ZONE, getNairobiCalendarDay, getNairobiDateTime };

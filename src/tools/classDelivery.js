const DELIVERY_MODES = Object.freeze({
    PHYSICAL: 'PHYSICAL',
    ONLINE: 'ONLINE'
});

function cleanDeliveryValue(value, maxLength) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function isValidMeetingLink(value) {
    const link = cleanDeliveryValue(value, 500);
    if (!link) return true;
    try {
        const parsed = new URL(link);
        return ['http:', 'https:'].includes(parsed.protocol);
    } catch {
        return false;
    }
}

function formatDeliveryDetails(slot) {
    const mode = String(slot?.deliveryMode || '').toUpperCase();
    if (mode === DELIVERY_MODES.PHYSICAL) {
        const room = cleanDeliveryValue(slot.room, 80);
        return room ? `Physical · Room: ${room}` : 'Physical';
    }
    if (mode === DELIVERY_MODES.ONLINE) {
        const platform = cleanDeliveryValue(slot.onlinePlatform, 50);
        const meetingLink = cleanDeliveryValue(slot.meetingLink, 500);
        const meetingPassword = cleanDeliveryValue(slot.meetingPassword, 100);
        return [
            'Online',
            platform ? `Platform: ${platform}` : '',
            meetingLink ? `Link: ${meetingLink}` : '',
            meetingPassword ? `Password: ${meetingPassword}` : ''
        ].filter(Boolean).join(' · ');
    }
    return '';
}

function applyDeliveryDetails(slot, details) {
    const mode = String(details?.deliveryMode || '').toUpperCase();
    const base = { ...(slot || {}) };
    delete base.room;
    delete base.onlinePlatform;
    delete base.meetingLink;
    delete base.meetingPassword;
    if (mode === DELIVERY_MODES.PHYSICAL) {
        const room = cleanDeliveryValue(details.room, 80);
        if (!room) throw new Error('Enter a room or type TBA if it is not known yet.');
        return { ...base, deliveryMode: mode, room };
    }
    if (mode === DELIVERY_MODES.ONLINE) {
        const onlinePlatform = cleanDeliveryValue(details.onlinePlatform, 50);
        const meetingLink = cleanDeliveryValue(details.meetingLink, 500);
        const meetingPassword = cleanDeliveryValue(details.meetingPassword, 100);
        if (!meetingLink) throw new Error('A meeting link is required for an online class.');
        if (!isValidMeetingLink(meetingLink)) throw new Error('Enter a valid meeting link beginning with http:// or https://.');
        return {
            ...base,
            deliveryMode: mode,
            ...(onlinePlatform ? { onlinePlatform } : {}),
            meetingLink,
            ...(meetingPassword ? { meetingPassword } : {})
        };
    }
    throw new Error('Choose Physical or Online.');
}

function getTimetableSlotIdentity(slot) {
    const startMinutes = slot?.startMinutes === null || slot?.startMinutes === undefined || slot?.startMinutes === ''
        ? NaN
        : Number(slot.startMinutes);
    const endMinutes = slot?.endMinutes === null || slot?.endMinutes === undefined || slot?.endMinutes === ''
        ? NaN
        : Number(slot.endMinutes);
    return {
        unit: String(slot?.unit || ''),
        startMinutes: Number.isFinite(startMinutes) ? startMinutes : null,
        endMinutes: Number.isFinite(endMinutes) ? endMinutes : null,
        time: String(slot?.time || slot?.startTime || '')
    };
}

function updateTimetableSlotDetails(classData, day, identity, details) {
    const schedule = classData?.timetable?.[String(day || '').toLowerCase()];
    if (!Array.isArray(schedule)) return false;
    const index = schedule.findIndex(slot => {
        if (String(slot?.unit || '') !== String(identity?.unit || '')) return false;
        if (identity?.startMinutes !== null && identity?.startMinutes !== undefined) {
            if (Number(slot?.startMinutes) !== Number(identity.startMinutes)) return false;
            if (identity?.endMinutes !== null && identity?.endMinutes !== undefined &&
                Number(slot?.endMinutes) !== Number(identity.endMinutes)) return false;
            return true;
        }
        return String(slot?.time || slot?.startTime || '') === String(identity?.time || '');
    });
    if (index < 0) return false;
    schedule[index] = applyDeliveryDetails(schedule[index], details);
    return true;
}

module.exports = {
    DELIVERY_MODES,
    cleanDeliveryValue,
    isValidMeetingLink,
    formatDeliveryDetails,
    applyDeliveryDetails,
    getTimetableSlotIdentity,
    updateTimetableSlotDetails
};

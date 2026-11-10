const test = require('node:test');
const assert = require('node:assert/strict');
const {
    applyDeliveryDetails,
    formatDeliveryDetails,
    getTimetableSlotIdentity,
    isValidMeetingLink,
    updateTimetableSlotDetails
} = require('../src/tools/classDelivery');

test('delivery details append to an existing slot without changing its timetable fields', () => {
    const slot = {
        unit: 'CALCULUS I', time: '7:00 AM', startTime: '7:00 AM',
        startMinutes: 420, endMinutes: 600, duration: 3
    };
    const classData = { timetable: { monday: [slot] } };
    const identity = getTimetableSlotIdentity(slot);

    assert.equal(updateTimetableSlotDetails(classData, 'Monday', identity, {
        deliveryMode: 'PHYSICAL', room: ' Block B, Room 12 '
    }), true);
    assert.deepEqual(classData.timetable.monday[0], {
        ...slot, deliveryMode: 'PHYSICAL', room: 'Block B, Room 12'
    });
});

test('switching a class to Online stores the link and optional password and clears stale room data', () => {
    const slot = {
        unit: 'PROGRAMMING', time: '10:00 AM', deliveryMode: 'PHYSICAL', room: 'Lab 2'
    };
    const online = applyDeliveryDetails(slot, {
        deliveryMode: 'ONLINE', onlinePlatform: 'Google Meet',
        meetingLink: 'https://meet.google.com/example', meetingPassword: '9062'
    });

    assert.equal(online.room, undefined);
    assert.equal(formatDeliveryDetails(online), 'Online · Platform: Google Meet · Link: https://meet.google.com/example · Password: 9062');
    assert.equal(isValidMeetingLink('javascript:alert(1)'), false);
    assert.equal(isValidMeetingLink('https://meet.google.com/example'), true);
});

test('switching an Online class to Physical clears prior meeting credentials', () => {
    const slot = {
        unit: 'PROGRAMMING', time: '10:00 AM', deliveryMode: 'ONLINE',
        onlinePlatform: 'Zoom', meetingLink: 'https://zoom.us/j/123', meetingPassword: 'secret'
    };
    const physical = applyDeliveryDetails(slot, { deliveryMode: 'PHYSICAL', room: 'TBA' });

    assert.equal(physical.deliveryMode, 'PHYSICAL');
    assert.equal(physical.room, 'TBA');
    assert.equal(physical.meetingLink, undefined);
    assert.equal(physical.meetingPassword, undefined);
});

test('delivery details are not written if the selected timetable slot no longer exists', () => {
    const classData = { timetable: { monday: [{ unit: 'CALCULUS I', time: '7:00 AM', startMinutes: 420 }] } };
    assert.equal(updateTimetableSlotDetails(classData, 'monday', {
        unit: 'CALCULUS I', startMinutes: 500, endMinutes: null, time: '8:20 AM'
    }, { deliveryMode: 'PHYSICAL', room: 'Room 12' }), false);
    assert.equal(classData.timetable.monday[0].deliveryMode, undefined);
});

test('Online delivery requires a link', () => {
    assert.throws(() => applyDeliveryDetails({}, {
        deliveryMode: 'ONLINE', onlinePlatform: 'Zoom', meetingPassword: 'secret'
    }), /meeting link is required/);
});

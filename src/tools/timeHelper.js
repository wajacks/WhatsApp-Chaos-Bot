// src/tools/timeHelper.js

/**
 * Converts a time string (e.g., "08:00 AM", "2pm", "14:30") into total minutes from midnight.
 */
function timeToMinutes(timeStr) {
  if (!timeStr) return null;
  const match = timeStr.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/i);
  if (!match) return null;

  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2] || '0', 10);
  const period = match[3] ? match[3].toLowerCase() : null;

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  if (period) {
      if (period.startsWith('p') && hours !== 12) hours += 12;
      if (period.startsWith('a') && hours === 12) hours = 0;
  }

  return (hours * 60) + minutes;
}

/**
* Converts total minutes from midnight back into a clean 12-hour format string.
*/
function minutesToTime(minutes) {
  let hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const period = hrs >= 12 ? 'PM' : 'AM';
  
  hrs = hrs % 12;
  if (hrs === 0) hrs = 12;
  
  const minsStr = mins < 10 ? `0${mins}` : mins;
  return `${hrs}:${minsStr} ${period}`;
}

/**
* Checks if a new time slot overlaps with any existing classes in a specific day's array.
* Overlap logic: (Start A < End B) AND (End A > Start B)
*/
function checkCollision(dayScheduleArray, newStartMins, newEndMins, ignoreClassName = null) {
  if (!dayScheduleArray || dayScheduleArray.length === 0) return false;

  for (const existingClass of dayScheduleArray) {
      // Skip checking against itself if we are modifying an existing class
      if (ignoreClassName && existingClass.unit === ignoreClassName) continue;

      const existingStart = existingClass.startMinutes;
      const existingEnd = existingClass.endMinutes;

      // Strict > and < ensures back-to-back classes (e.g., 8-11 and 11-2) do not trigger a collision
      if (newStartMins < existingEnd && newEndMins > existingStart) {
          return {
              collision: true,
              conflict: existingClass
          };
      }
  }
  return { collision: false };
}

module.exports = {
  timeToMinutes,
  minutesToTime,
  checkCollision
};
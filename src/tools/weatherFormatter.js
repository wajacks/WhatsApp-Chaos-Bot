// ============================================================
// WEATHER RESPONSE BUILDER
// ============================================================

function buildWeatherResponse(weatherData, userName) {
    const formatTime = (isoStr) => {
        if (!isoStr) return 'N/A';
        return new Date(isoStr).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    return `🌤️ *CHAOS WEATHER SYSTEM*\n` +
        `━━━━━━━━━━━━━━━━━━\n\n` +
        `📍 *Location:* ${weatherData.city}, ${weatherData.country}\n` +
        `🌐 *Coords:* ${weatherData.latitude}, ${weatherData.longitude}\n\n` +
        `🌡️ *Temp:* ${weatherData.temp}°C (Feels like ${weatherData.feelsLike}°C)\n` +
        `📊 *Min/Max:* ${weatherData.tempMin}°C / ${weatherData.tempMax}°C\n` +
        `☁️ *Conditions:* ${weatherData.condition}\n` +
        `☁️ *Clouds:* ${weatherData.clouds}%\n` +
        `💧 *Humidity:* ${weatherData.humidity}%\n` +
        `🎈 *Pressure:* ${weatherData.pressure} hPa\n` +
        `👁️ *Visibility:* ${weatherData.visibility} m\n\n` +
        `💨 *Wind:* ${weatherData.windSpeed} m/s (${weatherData.windDirection}°)\n` +
        `🌬️ *Gusts:* ${weatherData.windGust} m/s\n\n` +
        `🌅 *Sunrise:* ${formatTime(weatherData.sunrise)}\n` +
        `🌇 *Sunset:* ${formatTime(weatherData.sunset)}\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `👤 *${userName}* • *ONLINE🟢*\n` +
        `\`wantam\``;
}

module.exports = { buildWeatherResponse };

async function handleWeatherCommand({ message, lowerText, text, userName, getWeather, buildWeatherResponse }) {
    if (!lowerText.startsWith('!weather')) return false;

    const city = text.replace(/^!weather/i, '').trim();
    if (!city) {
        await message.reply('Please specify a city, e.g., `!weather Nairobi`.');
        return true;
    }

    try {
        const weatherData = await getWeather({ city });
        if (weatherData.error) {
            await message.reply(weatherData.error);
        } else {
            await message.reply(buildWeatherResponse(weatherData, userName));
        }
    } catch (weatherError) {
        console.error('❌ Weather Command Error:', weatherError);
        await message.reply('❌ *Weather System Error*');
    }
    return true;
}

module.exports = { handleWeatherCommand };

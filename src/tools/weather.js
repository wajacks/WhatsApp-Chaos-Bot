require('dotenv').config();
const axios = require('axios');

const apiKey = process.env.OPENWEATHERMAP_API_KEY;

async function getWeather({ city } = {}) {
    if (!apiKey) {
        console.error('Weather API Error: OPENWEATHERMAP_API_KEY is missing in environment variables.');
        return { error: 'API key configuration missing.' };
    }

    if (!city || typeof city !== 'string') {
        return { error: 'A valid city name must be provided.' };
    }

    try {
        const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&units=metric&appid=${apiKey}`;
        const res = await axios.get(url);
        const { data } = res;

        return {
            city: data.name,
            country: data.sys.country,
            temp: Math.round(data.main.temp),
            feelsLike: Math.round(data.main.feels_like),
            tempMin: Math.round(data.main.temp_min),
            tempMax: Math.round(data.main.temp_max),
            condition: data.weather[0]?.description || 'Unknown',
            humidity: data.main.humidity,
            pressure: data.main.pressure,
            windSpeed: data.wind.speed,
            windDirection: data.wind.deg,
            windGust: data.wind.gust || 0,
            clouds: data.clouds.all,
            visibility: data.visibility || 0,
            sunrise: new Date(data.sys.sunrise * 1000).toISOString(),
            sunset: new Date(data.sys.sunset * 1000).toISOString(),
            latitude: data.coord.lat,
            longitude: data.coord.lon
        };
    } catch (e) {
        const errorMessage = e.response?.data?.message || e.message;
        console.error(`Weather API Error [${city}]:`, errorMessage);

        return {
            error: `Could not fetch weather for "${city}": ${errorMessage}`
        };
    }
}

module.exports = {
    getWeather
};
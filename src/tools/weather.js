require('dotenv').config();
const axios = require('axios');

const apiKey = process.env.OPENWEATHERMAP_API_KEY; // Use the API key from .env

async function getWeather({ city }) {
    try {
        const url = `https://api.openweathermap.org/data/2.5/weather?q=${city}&units=metric&appid=${apiKey}`;
        const res = await axios.get(url);

        return {
            city: res.data.name,
            country: res.data.sys.country,
            temp: Math.round(res.data.main.temp),
            feelsLike: Math.round(res.data.main.feels_like),
            condition: res.data.weather[0].description,
            humidity: res.data.humidity
        };
    } catch (e) {
        return { error: `Could not fetch weather for ${city}` };
    }
}

module.exports = { getWeather };
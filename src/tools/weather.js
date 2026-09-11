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
          tempMin: Math.round(res.data.main.temp_min),
          tempMax: Math.round(res.data.main.temp_max),
      
          condition: res.data.weather[0].description,
          conditionMain: res.data.weather[0].main,
          icon: res.data.weather[0].icon,
      
          humidity: res.data.main.humidity,
          pressure: res.data.main.pressure,
      
          windSpeed: res.data.wind.speed,
          windDirection: res.data.wind.deg,
          windGust: res.data.wind.gust,
      
          clouds: res.data.clouds.all,
          visibility: res.data.visibility,
      
          sunrise: res.data.sys.sunrise,
          sunset: res.data.sys.sunset,
      
          latitude: res.data.coord.lat,
          longitude: res.data.coord.lon
      };
    } catch (e) {
        return { error: `Could not fetch weather for ${city}` };
    }
}

module.exports = { getWeather };
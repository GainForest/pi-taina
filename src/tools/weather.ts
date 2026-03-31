export interface WeatherResult {
  current: {
    temperature: number; // °C
    feelsLike: number; // °C apparent temperature
    humidity: number; // %
    windSpeed: number; // km/h
    windDirection: number; // degrees
    precipitation: number; // mm
    weatherCode: number; // WMO code
    weatherDescription: string; // human-readable (e.g. 'Partly cloudy')
    weatherEmoji: string; // e.g. '⛅'
    isDay: boolean;
  };
  daily: Array<{
    date: string; // ISO date
    temperatureMax: number; // °C
    temperatureMin: number; // °C
    precipitationSum: number; // mm
    precipitationProbabilityMax: number; // %
    windSpeedMax: number; // km/h
    weatherCode: number;
    weatherDescription: string;
    weatherEmoji: string;
    sunrise: string; // ISO time
    sunset: string; // ISO time
  }>;
  location: {
    latitude: number;
    longitude: number;
    elevation: number; // meters
    timezone: string;
  };
}

export function mapWeatherCode(
  code: number,
  isDay: boolean
): { description: string; emoji: string } {
  switch (code) {
    case 0:
      return {
        description: "Clear sky",
        emoji: isDay ? "☀️" : "🌙",
      };
    case 1:
      return {
        description: "Mainly clear",
        emoji: isDay ? "🌤️" : "🌙",
      };
    case 2:
      return {
        description: "Partly cloudy",
        emoji: isDay ? "⛅" : "☁️",
      };
    case 3:
      return {
        description: "Overcast",
        emoji: "☁️",
      };
    case 45:
    case 48:
      return {
        description: "Fog",
        emoji: "🌫️",
      };
    case 51:
      return {
        description: "Light drizzle",
        emoji: "🌦️",
      };
    case 53:
      return {
        description: "Moderate drizzle",
        emoji: "🌦️",
      };
    case 55:
      return {
        description: "Dense drizzle",
        emoji: "🌦️",
      };
    case 56:
    case 57:
      return {
        description: "Freezing drizzle",
        emoji: "🌧️❄️",
      };
    case 61:
      return {
        description: "Slight rain",
        emoji: "🌧️",
      };
    case 63:
      return {
        description: "Moderate rain",
        emoji: "🌧️",
      };
    case 65:
      return {
        description: "Heavy rain",
        emoji: "🌧️",
      };
    case 66:
    case 67:
      return {
        description: "Freezing rain",
        emoji: "🌧️❄️",
      };
    case 71:
      return {
        description: "Slight snow",
        emoji: "🌨️",
      };
    case 73:
      return {
        description: "Moderate snow",
        emoji: "🌨️",
      };
    case 75:
      return {
        description: "Heavy snow",
        emoji: "🌨️",
      };
    case 77:
      return {
        description: "Snow grains",
        emoji: "🌨️",
      };
    case 80:
      return {
        description: "Slight rain showers",
        emoji: "🌦️",
      };
    case 81:
      return {
        description: "Moderate rain showers",
        emoji: "🌦️",
      };
    case 82:
      return {
        description: "Violent rain showers",
        emoji: "🌦️",
      };
    case 85:
    case 86:
      return {
        description: "Snow showers",
        emoji: "🌨️",
      };
    case 95:
      return {
        description: "Thunderstorm",
        emoji: "⛈️",
      };
    case 96:
    case 99:
      return {
        description: "Thunderstorm with hail",
        emoji: "⛈️🧊",
      };
    default:
      return {
        description: "Unknown",
        emoji: "🌡️",
      };
  }
}

interface OpenMeteoResponse {
  latitude: number;
  longitude: number;
  elevation: number;
  timezone: string;
  current: {
    temperature_2m: number;
    apparent_temperature: number;
    relative_humidity_2m: number;
    wind_speed_10m: number;
    wind_direction_10m: number;
    precipitation: number;
    weather_code: number;
    is_day: number;
  };
  daily: {
    time: string[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_sum: number[];
    precipitation_probability_max: number[];
    wind_speed_10m_max: number[];
    weather_code: number[];
    sunrise: string[];
    sunset: string[];
  };
}

export async function getWeather(
  latitude: number,
  longitude: number
): Promise<WeatherResult | { error: string }> {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current:
      "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m,is_day",
    daily:
      "temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,weather_code,sunrise,sunset",
    timezone: "auto",
    forecast_days: "3",
  });

  const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;

  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `Network error: ${message}` };
  }

  if (!response.ok) {
    return {
      error: `Open-Meteo returned HTTP ${response.status}: ${response.statusText}`,
    };
  }

  let data: OpenMeteoResponse;
  try {
    data = (await response.json()) as OpenMeteoResponse;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `Failed to parse response: ${message}` };
  }

  if (!data.current || !data.daily) {
    return { error: "Invalid response structure from Open-Meteo" };
  }

  const isDay = data.current.is_day === 1;
  const currentWeather = mapWeatherCode(data.current.weather_code, isDay);

  const daily = data.daily.time.map((date, i) => {
    const dailyWeather = mapWeatherCode(data.daily.weather_code[i] ?? 0, true);
    return {
      date,
      temperatureMax: data.daily.temperature_2m_max[i] ?? 0,
      temperatureMin: data.daily.temperature_2m_min[i] ?? 0,
      precipitationSum: data.daily.precipitation_sum[i] ?? 0,
      precipitationProbabilityMax:
        data.daily.precipitation_probability_max[i] ?? 0,
      windSpeedMax: data.daily.wind_speed_10m_max[i] ?? 0,
      weatherCode: data.daily.weather_code[i] ?? 0,
      weatherDescription: dailyWeather.description,
      weatherEmoji: dailyWeather.emoji,
      sunrise: data.daily.sunrise[i] ?? "",
      sunset: data.daily.sunset[i] ?? "",
    };
  });

  return {
    current: {
      temperature: data.current.temperature_2m,
      feelsLike: data.current.apparent_temperature,
      humidity: data.current.relative_humidity_2m,
      windSpeed: data.current.wind_speed_10m,
      windDirection: data.current.wind_direction_10m,
      precipitation: data.current.precipitation,
      weatherCode: data.current.weather_code,
      weatherDescription: currentWeather.description,
      weatherEmoji: currentWeather.emoji,
      isDay,
    },
    daily,
    location: {
      latitude: data.latitude,
      longitude: data.longitude,
      elevation: data.elevation,
      timezone: data.timezone,
    },
  };
}

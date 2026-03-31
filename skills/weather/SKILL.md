---
name: weather
description: Get weather conditions and forecasts. Use when the user asks about weather, temperature, rain, wind, or wants to plan field work or outdoor activities. Provides current conditions and a 3-day forecast for any location.
---

# Weather

## What It Does
Gets current weather conditions and a 3-day forecast for any location. Great for planning field work, AudioMoth deployments, or outdoor activities.

## When to Trigger
- User asks about weather, temperature, rain, wind, or humidity
- User wants to know if conditions are good for field work or outdoor activities
- User is planning an AudioMoth deployment and wants to check the forecast

## Conversation Flow

1. **User asks about weather** — if no location, ask: "📍 Where do you want the forecast for?"
2. If they give a place name, call `geocode_location` to get coordinates. Do NOT proceed without coordinates.
3. Call `weather_report` with the coordinates
4. Present the results in a friendly, concise format (see below)

## How to Present the Data

- Lead with current conditions: weather emoji + description + location
- Show temperature and feels-like on the same line
- Include humidity and wind speed
- For the 3-day forecast, one line per day: day name + emoji + high/low + rain chance
- **If rain is expected, mention it prominently** — this matters for field work planning
- Keep it to 5–8 lines total — not a data dump
- Round all temperatures to whole numbers

Example format:
```
⛅ Partly cloudy in Manaus right now
🌡️ 32°C (feels like 36°C) · 💧 85% humidity · 💨 12 km/h

Next 3 days:
🌧️ Tue: 24–33°C · 80% rain
⛅ Wed: 23–31°C · 40% rain
☀️ Thu: 22–34°C · 10% rain
```

## Don't
- List every data point — pick the most useful ones
- Use technical jargon or weather codes
- Forget to mention rain if it's coming — that's often the most important thing

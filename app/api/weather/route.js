import { NextResponse } from "next/server";
import { searchPlaces } from "../../../lib/geocode";

// Open-Meteo weather codes -> OpenWeather-style condition + icon
function fromCode(code, isDay) {
  const s = isDay ? "d" : "n";
  if (code === 0) return { condition: "Clear", description: "clear sky", icon: `01${s}` };
  if (code === 1) return { condition: "Clear", description: "mainly clear", icon: `01${s}` };
  if (code === 2) return { condition: "Clouds", description: "partly cloudy", icon: `02${s}` };
  if (code === 3) return { condition: "Clouds", description: "overcast", icon: `04${s}` };
  if (code === 45 || code === 48) return { condition: "Mist", description: "fog", icon: `50${s}` };
  if (code >= 51 && code <= 57) return { condition: "Drizzle", description: "drizzle", icon: `09${s}` };
  if (code >= 61 && code <= 67) return { condition: "Rain", description: "rain", icon: `10${s}` };
  if (code >= 71 && code <= 77) return { condition: "Snow", description: "snow", icon: `13${s}` };
  if (code >= 80 && code <= 82) return { condition: "Rain", description: "rain showers", icon: `09${s}` };
  if (code === 85 || code === 86) return { condition: "Snow", description: "snow showers", icon: `13${s}` };
  if (code >= 95) return { condition: "Thunderstorm", description: "thunderstorm", icon: `11${s}` };
  return { condition: "Clouds", description: "cloudy", icon: `04${s}` };
}

async function openMeteo(lat, lon) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,apparent_temperature,relative_humidity_2m,pressure_msl,wind_speed_10m,weather_code,is_day` +
    `&timezone=auto`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Open-Meteo failed");
  const d = await res.json();
  const c = d.current;
  return {
    timezone: d.utc_offset_seconds,
    reading: {
      source: "Open-Meteo",
      temp: c.temperature_2m,
      feelsLike: c.apparent_temperature,
      humidity: c.relative_humidity_2m,
      pressure: Math.round(c.pressure_msl),
      wind: c.wind_speed_10m,
      ...fromCode(c.weather_code, c.is_day === 1),
    },
  };
}

async function openWeather(lat, lon, key) {
  const params = new URLSearchParams({ units: "metric", appid: key, lat, lon });
  const res = await fetch(`https://api.openweathermap.org/data/2.5/weather?${params}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error("OpenWeatherMap failed");
  const d = await res.json();
  return {
    timezone: d.timezone,
    reading: {
      source: "OpenWeatherMap",
      temp: d.main.temp,
      feelsLike: d.main.feels_like,
      humidity: d.main.humidity,
      pressure: d.main.pressure,
      wind: d.wind.speed * 3.6, // m/s -> km/h
      condition: d.weather[0].main,
      description: d.weather[0].description,
      icon: d.weather[0].icon,
    },
  };
}

async function weatherApi(lat, lon, name, country, key) {
  const get = async (q) => {
    const res = await fetch(
      `https://api.weatherapi.com/v1/current.json?key=${key}&q=${encodeURIComponent(q)}`,
      { cache: "no-store" }
    );
    if (!res.ok) throw new Error("WeatherAPI failed");
    return res.json();
  };
  // Its own city lookup lands on the real city centre, but a common name can match a
  // different place, so fall back to coordinates when the match is far from the spot.
  let data;
  if (name && name !== "Your location") {
    data = await get(`${name}, ${country}`).catch(() => null);
    if (data) {
      const dLat = data.location.lat - Number(lat);
      const dLon = (data.location.lon - Number(lon)) * Math.cos((Number(lat) * Math.PI) / 180);
      if (Math.hypot(dLat, dLon) * 111 > 30) data = null;
    }
  }
  if (!data) data = await get(`${lat},${lon}`);
  const { current: c } = data;
  const text = c.condition.text.toLowerCase();
  const s = c.is_day === 1 ? "d" : "n";
  let condition = "Clouds";
  let icon = `04${s}`;
  if (/sunny|clear/.test(text)) [condition, icon] = ["Clear", `01${s}`];
  else if (/partly/.test(text)) icon = `02${s}`;
  else if (/thunder/.test(text)) [condition, icon] = ["Thunderstorm", `11${s}`];
  else if (/snow|sleet|ice|blizzard/.test(text)) [condition, icon] = ["Snow", `13${s}`];
  else if (/drizzle/.test(text)) [condition, icon] = ["Drizzle", `09${s}`];
  else if (/rain|shower/.test(text)) [condition, icon] = ["Rain", `10${s}`];
  else if (/mist|fog|haze|smoke/.test(text)) [condition, icon] = ["Mist", `50${s}`];
  return {
    reading: {
      source: "WeatherAPI",
      temp: c.temp_c,
      feelsLike: c.feelslike_c,
      humidity: c.humidity,
      pressure: Math.round(c.pressure_mb),
      wind: c.wind_kph,
      condition,
      description: text,
      icon,
    },
  };
}

// Real observation from the nearest airport weather station (METAR), if one is close.
async function airport(lat, lon, isDay) {
  const la = Number(lat);
  const lo = Number(lon);
  const d = 0.5;
  const res = await fetch(
    `https://aviationweather.gov/api/data/metar?bbox=${la - d},${lo - d},${la + d},${lo + d}&format=json`,
    { cache: "no-store" }
  );
  if (!res.ok) throw new Error("no airport data");
  const list = await res.json();
  const km = (s) => {
    const r = (x) => (x * Math.PI) / 180;
    const a =
      Math.sin(r(s.lat - la) / 2) ** 2 +
      Math.cos(r(la)) * Math.cos(r(s.lat)) * Math.sin(r(s.lon - lo) / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(a));
  };
  const fresh = Date.now() / 1000 - 3 * 3600;
  const near = list
    .filter((s) => typeof s.temp === "number" && s.obsTime > fresh)
    .map((s) => ({ s, dist: km(s) }))
    .filter((x) => x.dist <= 40)
    .sort((a, b) => a.dist - b.dist)[0];
  if (!near) throw new Error("no airport nearby");

  const { s } = near;
  const t = s.temp;
  const td = typeof s.dewp === "number" ? s.dewp : t - 10;
  const m = (x) => Math.exp((17.62 * x) / (243.12 + x));
  const clear = ["CLR", "SKC", "FEW"].includes(s.cover);
  const suffix = isDay ? "d" : "n";
  return {
    reading: {
      source: "Airport station",
      temp: t,
      feelsLike: t,
      humidity: Math.round(100 * (m(td) / m(t))),
      pressure: s.altim,
      wind: (s.wspd || 0) * 1.852, // knots -> km/h
      condition: clear ? "Clear" : "Clouds",
      description: clear ? "clear sky" : "cloudy",
      icon: clear ? `01${suffix}` : `04${suffix}`,
    },
  };
}

async function geocode(city) {
  const r = (await searchPlaces(city))[0];
  return r ? { lat: r.lat, lon: r.lon, name: r.name, country: r.countryCode } : null;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const city = searchParams.get("city")?.trim();
  let lat = searchParams.get("lat");
  let lon = searchParams.get("lon");
  let name = searchParams.get("name") || "Your location";
  let country = searchParams.get("country") || "";

  if (!city && !(lat && lon)) {
    return NextResponse.json({ error: "Please enter a city name." }, { status: 400 });
  }

  try {
    // Resolve a typed city to coordinates once, so every source reads the same spot.
    if (city) {
      const g = await geocode(city);
      if (!g) {
        return NextResponse.json({ error: "City not found. Check the spelling and try again." }, { status: 404 });
      }
      ({ lat, lon, name, country } = g);
    }

    const key = process.env.OPENWEATHER_API_KEY;
    const wKey = process.env.WEATHERAPI_KEY;
    const [ow, om, wa] = await Promise.allSettled([
      key ? openWeather(lat, lon, key) : Promise.reject(new Error("no key")),
      openMeteo(lat, lon),
      wKey ? weatherApi(lat, lon, name, country, wKey) : Promise.reject(new Error("no key")),
    ]);
    const isDay = (ow.value || om.value)?.reading.icon.endsWith("d") ?? true;
    const ap = await airport(lat, lon, isDay).then(
      (v) => v,
      () => null
    );
    // Order matters: the first reading is the default.
    const ok = [wa.value, ap, ow.value, om.value].filter(Boolean);
    if (!ok.length) {
      return NextResponse.json({ error: "Could not load the weather. Please try again." }, { status: 502 });
    }

    return NextResponse.json({
      city: name,
      country,
      timezone: (ow.value || om.value)?.timezone ?? 0,
      readings: ok.map((o) => o.reading),
    });
  } catch {
    return NextResponse.json({ error: "Network problem. Please try again." }, { status: 502 });
  }
}

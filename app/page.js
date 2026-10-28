"use client";

import { useEffect, useState } from "react";

const THEMES = {
  Clear: "clear",
  Clouds: "clouds",
  Rain: "rain",
  Drizzle: "rain",
  Thunderstorm: "rain",
  Snow: "snow",
};

export default function Home() {
  const [query, setQuery] = useState("");
  const [data, setData] = useState(null);
  const [source, setSource] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [unit, setUnit] = useState("C");
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  // Fetch city suggestions shortly after the user stops typing.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/suggest?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        setSuggestions(await res.json());
        setActive(-1);
      } catch {}
    }, 400);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  function pick(s) {
    setQuery(`${s.name}${s.region ? ", " + s.region : ""}, ${s.countryCode}`);
    setOpen(false);
    setSuggestions([]);
    const p = new URLSearchParams({ lat: s.lat, lon: s.lon, name: s.name, country: s.countryCode });
    load(p.toString());
  }

  function onKeyDown(e) {
    if (!open || !suggestions.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a <= 0 ? suggestions.length - 1 : a - 1));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      pick(suggestions[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  async function load(qs) {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/weather?${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong.");
      setData(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    try {
      const saved = localStorage.getItem("unit");
      if (saved === "C" || saved === "F") setUnit(saved);
    } catch {}
    load("city=London");
  }, []);

  function changeUnit(u) {
    setUnit(u);
    try {
      localStorage.setItem("unit", u);
    } catch {}
  }

  function onSubmit(e) {
    e.preventDefault();
    setOpen(false);
    if (suggestions.length) return pick(suggestions[0]);
    if (query.trim()) load(`city=${encodeURIComponent(query.trim())}`);
  }

  function useMyLocation() {
    if (!navigator.geolocation) return setError("Your browser cannot share location.");
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      (p) => load(`lat=${p.coords.latitude}&lon=${p.coords.longitude}`),
      () => {
        setLoading(false);
        setError("Location permission was denied.");
      }
    );
  }

  function changeSource(s) {
    setSource(s);
  }

  // The chosen source's reading, merged onto the shared city info.
  const weather = data && { ...data, ...(data.readings.find((r) => r.source === source) || data.readings[0]) };

  const show = (c) => Math.round(unit === "C" ? c : (c * 9) / 5 + 32);

  const isNight = weather?.icon?.endsWith("n");
  const theme = isNight ? "night" : THEMES[weather?.condition] || "clouds";

  const localTime = weather
    ? new Date(Date.now() + weather.timezone * 1000).toLocaleString("en-US", {
        timeZone: "UTC",
        weekday: "long",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";

  return (
    <main className={`page ${theme}`}>
      <div className="shell">
        <form className="search" onSubmit={onSubmit}>
          <div className="field">
            <input
              id="city"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onBlur={() => setTimeout(() => setOpen(false), 150)}
              onKeyDown={onKeyDown}
              placeholder="Search any city or town"
              aria-label="City name"
              aria-autocomplete="list"
              autoComplete="off"
            />
            {open && suggestions.length > 0 && (
              <ul className="suggest" role="listbox">
                {suggestions.map((s, i) => (
                  <li
                    key={s.id}
                    role="option"
                    aria-selected={i === active}
                    className={i === active ? "on" : ""}
                    onMouseDown={() => pick(s)}
                    onMouseEnter={() => setActive(i)}
                  >
                    <strong>{s.name}</strong>
                    <span className="muted">
                      {[s.region, s.country].filter(Boolean).join(", ")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button type="button" className="ghost" onClick={useMyLocation} title="Use my location" aria-label="Use my location">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="3" />
              <circle cx="12" cy="12" r="8" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
            </svg>
          </button>
          <button type="submit" className="primary">Search</button>
        </form>

        {error && <p className="error" role="alert">{error}</p>}

        <section className={`card ${loading ? "busy" : ""}`}>
          {weather ? (
            <>
              <div className="top">
                <div>
                  <h1>
                    {weather.city}
                    {weather.country ? <span>, {weather.country}</span> : null}
                  </h1>
                  <p className="muted">{localTime}</p>
                </div>
                <div className="units" role="group" aria-label="Temperature unit">
                  {["C", "F"].map((u) => (
                    <button key={u} className={unit === u ? "on" : ""} onClick={() => changeUnit(u)}>
                      °{u}
                    </button>
                  ))}
                </div>
              </div>

              <div className="now">
                <div className="temp">
                  {show(weather.temp)}
                  <sup>°{unit}</sup>
                </div>
                <div className="cond">
                  <img
                    src={`https://openweathermap.org/img/wn/${weather.icon}@2x.png`}
                    alt=""
                    width="96"
                    height="96"
                  />
                  <p>{weather.description}</p>
                </div>
              </div>

              <div className="grid">
                <Stat label="Feels like" value={`${show(weather.feelsLike)}°`} />
                <Stat label="Humidity" value={`${weather.humidity}%`} />
                <Stat label="Wind" value={`${Math.round(weather.wind)} km/h`} />
                <Stat label="Pressure" value={`${weather.pressure} hPa`} />
              </div>
              <div className="source">
                <span className="muted">Data source</span>
                <div className="units" role="group" aria-label="Data source">
                  {data.readings.map((r) => (
                    <button
                      key={r.source}
                      className={weather.source === r.source ? "on" : ""}
                      onClick={() => changeSource(r.source)}
                    >
                      {r.source} · {show(r.temp)}°
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <p className="muted center">{loading ? "Loading weather…" : "Search a city to begin."}</p>
          )}
        </section>
      </div>
    </main>
  );
}

function Stat({ label, value }) {
  return (
    <div className="stat">
      <span className="muted">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

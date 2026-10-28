// Finds places by name. Open-Meteo covers cities well; OpenStreetMap (Nominatim)
// fills the gaps with towns, villages and tehsils.

async function openMeteoSearch(q) {
  const res = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&format=json`,
    { cache: "no-store" }
  );
  const data = await res.json();
  return (data.results || []).map((r) => ({
    id: `om-${r.id}`,
    name: r.name,
    region: r.admin1 || "",
    country: r.country || "",
    countryCode: r.country_code || "",
    lat: r.latitude,
    lon: r.longitude,
  }));
}

async function osmSearch(q) {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&addressdetails=1&accept-language=en&limit=8`,
    { cache: "no-store", headers: { "User-Agent": "weather-app/0.1 (personal project)" } }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data
    .filter((r) => ["place", "boundary"].includes(r.category))
    .map((r) => {
      const a = r.address || {};
      return {
        id: `osm-${r.place_id}`,
        name: r.name || r.display_name.split(",")[0],
        region: a.county || a.state_district || a.state || "",
        country: a.country || "",
        countryCode: (a.country_code || "").toUpperCase(),
        lat: Number(r.lat),
        lon: Number(r.lon),
      };
    });
}

// People split names differently ("noor pur thal" vs "noorpur thal"), so also try
// versions with neighbouring words joined.
function spellings(q) {
  const words = q.split(/\s+/).filter(Boolean);
  const out = new Set([words.join(" ")]);
  for (let i = 0; i < words.length - 1 && out.size < 4; i++) {
    out.add([...words.slice(0, i), words[i] + words[i + 1], ...words.slice(i + 2)].join(" "));
  }
  if (words.length > 2 && out.size < 5) out.add(words.join(""));
  return [...out];
}

export async function searchPlaces(q) {
  const variants = spellings(q);
  const [om, osm] = await Promise.all([
    Promise.all(variants.map((v) => openMeteoSearch(v).catch(() => []))).then((l) => l.flat()),
    // Nominatim allows about one request per second, so only the best variants go there.
    (async () => {
      const found = [];
      for (const v of variants.slice(0, 2)) {
        found.push(...(await osmSearch(v).catch(() => [])));
        if (found.length) break;
      }
      return found;
    })(),
  ]);
  // Open-Meteo first, then anything OpenStreetMap adds that is not a near-duplicate.
  const out = om.filter((p, i) => om.findIndex((x) => x.id === p.id) === i);
  for (const p of osm) {
    const dup = out.some(
      (o) => Math.abs(o.lat - p.lat) < 0.05 && Math.abs(o.lon - p.lon) < 0.05 && o.name.toLowerCase() === p.name.toLowerCase()
    );
    if (!dup) out.push(p);
  }
  return out.slice(0, 8);
}

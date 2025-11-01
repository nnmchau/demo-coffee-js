import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();
const { SERPAPI_KEY } = process.env;
if (!SERPAPI_KEY) {
  console.warn("⚠️  SERPAPI_KEY is missing. Add it to .env");
}

const app = express();
app.use(express.static("public")); // serve index.html

// Tiny proxy: /api/coffee → SerpAPI
app.get("/api/coffee", async (req, res) => {
  try {
    const {
      q = "coffee shop",
      lat = "10.776",
      lng = "106.700",
      zoom = "14",
      min_rating = "0",
      max_km = "2",
      open_now = "false",
      hl = "vi",
      gl = "vn"
    } = req.query;

    const serpUrl = new URL("https://serpapi.com/search.json");
    serpUrl.search = new URLSearchParams({
      engine: "google_maps",
      type: "search",
      q: String(q),
      ll: `@${lat},${lng},${zoom}z`,
      hl: String(hl),
      gl: String(gl),
      api_key: SERPAPI_KEY
    }).toString();

    const r = await fetch(serpUrl);
    const data = await r.json();
    if (data.error) return res.status(502).json({ error: data.error });

    const raw = [
      ...(Array.isArray(data.local_results) ? data.local_results : []),
      ...(Array.isArray(data.place_results) ? data.place_results : [])
    ];

    const seen = new Set();
    const toLL = p => p?.gps_coordinates && {
      lat: p.gps_coordinates.latitude,
      lng: p.gps_coordinates.longitude
    };
    const rating = p => Number(p.rating || p.stars || 0);
    const addr = p => p.address || p.full_address || p.sub_title || "";
    const openText = p => p.open_state || p.hours || "";
    const isOpen = p => {
      const s = openText(p).toLowerCase();
      return s.includes("open") && !s.includes("close");
    };
    const hav = (a, b) => {
      const R = 6371, dLat = (b.lat - a.lat) * Math.PI/180, dLng = (b.lng - a.lng) * Math.PI/180;
      const la1 = a.lat * Math.PI/180, la2 = b.lat * Math.PI/180;
      const x = Math.sin(dLat/2)**2 + Math.sin(dLng/2)**2 * Math.cos(la1)*Math.cos(la2);
      return 2 * R * Math.asin(Math.sqrt(x));
    };

    const center = { lat: Number(lat), lng: Number(lng) };
    let entries = raw
      .filter(p => {
        const k = (p.title || "") + "|" + addr(p);
        if (seen.has(k)) return false;
        seen.add(k);
        return !!toLL(p);
      })
      .map(p => {
        const ll = toLL(p);
        return {
          title: p.title || "Unnamed",
          rating: rating(p),
          address: addr(p),
          phone: p.phone || p.phone_number || "",
          website: p.website || p.link || p.google_maps_url || "",
          open_state: openText(p),
          location: ll,
          distance_km: hav(center, ll)
        };
      });

    // simple filters
    const minR = Number(min_rating);
    const maxKm = Number(max_km);
    const wantOpen = String(open_now) === "true";

    entries = entries.filter(e =>
      e.rating >= minR &&
      e.distance_km <= maxKm &&
      (!wantOpen || /open/i.test(e.open_state) && !/close/i.test(e.open_state))
    ).sort((a, b) => a.distance_km - b.distance_km);

    res.json({ count: entries.length, results: entries });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`➡️  http://localhost:${PORT}`);
});

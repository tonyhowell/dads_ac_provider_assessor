import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Place } from '../geo';

// The Find map (improvement plan 2.1): the home and each provider's outlets at suburb level, on OpenStreetMap.
// Selecting a marker opens that provider; the list beside it stays the main way to choose.

export interface MapProvider {
  id: string;
  name: string;
  places: Place[];
  selected: boolean;
}

export function MapView({ home, providers, onSelect, label }: { home: [number, number] | null; providers: MapProvider[]; onSelect: (id: string) => void; label: string }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!el.current || map.current) return;
    map.current = L.map(el.current, { scrollWheelZoom: false, attributionControl: true }).setView(home ?? [-27.47, 153.03], 11);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    return () => {
      map.current?.remove();
      map.current = null;
    };
    // The map is created once; markers update below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    const bounds: L.LatLngExpression[] = [];
    if (home) {
      L.circleMarker(home, { radius: 10, color: '#2e3236', weight: 3, fillColor: '#ffffff', fillOpacity: 1 }).bindTooltip('Home', { permanent: false }).addTo(g);
      bounds.push(home);
    }
    for (const p of providers) {
      for (const place of p.places) {
        const marker = L.circleMarker([place.lat, place.lng], {
          radius: p.selected ? 10 : 7,
          color: '#2e3236',
          weight: p.selected ? 3 : 1.5,
          fillColor: place.kind === 'outlet' ? '#e8a33d' : '#d9cdb6',
          fillOpacity: 0.95,
        })
          .bindTooltip(`${p.name} · ${place.label}`)
          .on('click', () => onSelect(p.id));
        marker.addTo(g);
        // Fit the view to home and nearby places (within about 60 km), so one far outlet doesn't zoom it out.
        if (!home || L.latLng(home).distanceTo([place.lat, place.lng]) < 60_000) bounds.push([place.lat, place.lng]);
      }
    }
    if (bounds.length > 1) m.fitBounds(L.latLngBounds(bounds), { padding: [24, 24], maxZoom: 13 });
    else if (home) m.setView(home, 12);
  }, [home, providers, onSelect]);

  return <div ref={el} role="region" aria-label={label} className="h-[22rem] w-full rounded-[var(--radius-card)] border border-[var(--rule)] lg:h-[30rem]" />;
}

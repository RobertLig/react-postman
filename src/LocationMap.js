import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const INITIAL_VIEW = [25, 0];

function hasCoordinate(value) {
  return value !== null && value !== undefined && value !== ""
    && Number.isFinite(Number(value));
}

function fitLocationView(map, locations, readOnly) {
  if (!locations.length || map.getSize().x <= 0 || map.getSize().y <= 0) return;
  if (locations.length > 1) {
    const coordinates = locations.map(({ location }) => [
      location.latitude,
      location.longitude,
    ]);
    const padding = readOnly ? [16, 16] : [32, 32];
    map.fitBounds(coordinates, { padding, maxZoom: 13 });
    return;
  }

  const { latitude, longitude, bounds } = locations[0].location;
  if (bounds?.length === 4 && bounds.every(Number.isFinite)) {
    const [west, south, east, north] = bounds;
    map.fitBounds([[south, west], [north, east]], { padding: [24, 24], maxZoom: 12 });
  } else {
    map.setView([latitude, longitude], Math.max(map.getZoom(), 12));
  }
}

function markerStyle(active, key) {
  const size = active ? 22 : 18;
  return L.divIcon({
    className: `location-map-marker${active ? " active" : ""}${key ? ` ${key}` : ""}`,
    html: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export default function LocationMap({ locations, activeKey, onMapPick, readOnly = false }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerLayerRef = useRef(null);
  const locationsRef = useRef([]);
  const onMapPickRef = useRef(onMapPick);
  const lastViewRef = useRef("");

  useEffect(() => {
    onMapPickRef.current = onMapPick;
  }, [onMapPick]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined;

    const map = L.map(containerRef.current, {
      scrollWheelZoom: false,
      dragging: !readOnly,
      touchZoom: !readOnly,
      doubleClickZoom: !readOnly,
      boxZoom: !readOnly,
      keyboard: !readOnly,
      zoomControl: !readOnly,
    }).setView(INITIAL_VIEW, 2);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    const markerLayer = L.layerGroup().addTo(map);

    if (!readOnly) {
      map.on("click", (event) => {
        onMapPickRef.current({
          latitude: event.latlng.lat,
          longitude: event.latlng.lng,
        });
      });
    }

    mapRef.current = map;
    markerLayerRef.current = markerLayer;
    const invalidateTimeout = window.setTimeout(() => {
      map.invalidateSize();
      fitLocationView(map, locationsRef.current, readOnly);
    }, 0);

    return () => {
      window.clearTimeout(invalidateTimeout);
      map.remove();
      mapRef.current = null;
      markerLayerRef.current = null;
    };
  }, [readOnly]);

  useEffect(() => {
    const map = mapRef.current;
    const markerLayer = markerLayerRef.current;
    if (!map || !markerLayer) return;

    markerLayer.clearLayers();
    const mappedLocations = locations.filter(({ location }) => location
      && hasCoordinate(location.latitude)
      && hasCoordinate(location.longitude))
      .map((item) => ({
        ...item,
        location: {
          ...item.location,
          latitude: Number(item.location.latitude),
          longitude: Number(item.location.longitude),
        },
      }));
    locationsRef.current = mappedLocations;
    const routeCoordinates = mappedLocations.map(({ location }) => [
      location.latitude,
      location.longitude,
    ]);

    if (routeCoordinates.length > 1) {
      L.polyline(routeCoordinates, {
        color: "#fff",
        weight: 8,
        opacity: 0.95,
        ...(readOnly ? { interactive: false } : {}),
      }).addTo(markerLayer);
      L.polyline(routeCoordinates, {
        color: "#438b91",
        weight: 5,
        opacity: 1,
        ...(readOnly ? { interactive: false } : {}),
      }).addTo(markerLayer);
    }

    mappedLocations.forEach(({ key, label, location }) => {
      const popupContent = document.createElement("span");
      popupContent.textContent = label;
      const marker = L.marker(
        [location.latitude, location.longitude],
        {
          icon: markerStyle(key === activeKey, readOnly ? key : ""),
          interactive: !readOnly,
        },
      );
      if (!readOnly) marker.bindPopup(popupContent);
      marker.addTo(markerLayer);
    });

    const locationsView = JSON.stringify(mappedLocations.map(({ key, location }) => [
      key,
      location.latitude,
      location.longitude,
      location.bounds,
    ]));
    if (lastViewRef.current === locationsView) return;
    if (!mappedLocations.length) {
      lastViewRef.current = locationsView;
      return;
    }

    if (map.getSize().x <= 0 || map.getSize().y <= 0) return;
    lastViewRef.current = locationsView;
    fitLocationView(map, mappedLocations, readOnly);
  }, [locations, activeKey, readOnly]);

  return (
    <div className="location-map-wrap">
      <div className={`location-map${readOnly ? " read-only" : ""}`} ref={containerRef} role={readOnly ? "img" : "application"} aria-label={readOnly ? "Route map" : "OpenStreetMap place picker"} />
      {!readOnly && <p className="location-map-help">The line connects your route locations. Click the map to set the active location; its highlighted marker shows which field will be updated.</p>}
    </div>
  );
}

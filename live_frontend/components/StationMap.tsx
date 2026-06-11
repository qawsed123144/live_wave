"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";

import stationsJSON from "@/data/seedlink_BATS.json";

const mapStyle = "https://tiles.openfreemap.org/styles/liberty";
const mapCenter: [number, number] = [121, 23.7];
const mapZoom: number = 6.8;
const mapBounds: [number, number, number, number] = [116, 20, 125, 27];

type Station = {
    source: string;
    network: string;
    station: string;
    selector: string;
    constant: number;
    lon: number;
    lat: number;
};
type StationMapProps = {
    setStations: (stations: Station[]) => void
}

export default function StationMap({ setStations }: StationMapProps) {
    const [selectedStations, setSelectedStations] = useState<Map<string, Station>>(new Map());
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<MapLibreMap | null>(null);

    const allStations = useMemo(() => {
        return stationsJSON.flatMap((source) =>
            source.streams.map((stream) => ({
                ...stream,
                source: source.name
            })))
    }, [])

    const stationGeoJson = useMemo(() => {
        return {
            type: "FeatureCollection" as const,
            features: allStations.map((station) => {
                const id = `${station.network}.${station.station}.${station.selector}`;
                return {
                    type: "Feature" as const,
                    id: `${station.network}.${station.station}.${station.selector}`,
                    properties: {
                        id,
                        source: station.source,
                        network: station.network,
                        station: station.station,
                        selector: station.selector,
                    },
                    geometry: {
                        type: "Point" as const,
                        coordinates: [station.lon, station.lat],
                    },
                }
            }),
        };
    }, [allStations]);

    useEffect(() => {
        if (!containerRef.current || mapRef.current) return;

        const map = new maplibregl.Map({
            container: containerRef.current,
            style: mapStyle,
            center: mapCenter,
            zoom: mapZoom,
            maxBounds: mapBounds
        })
        mapRef.current = map;

        map.on("load", () => {
            map.addSource("stations", {
                type: "geojson",
                data: stationGeoJson,
                promoteId: "id",
            });

            map.addLayer({
                id: "station-circles",
                type: "circle",
                source: "stations",
                paint: {
                    "circle-radius": [
                        "case",
                        ["boolean", ["feature-state", "hover"], false],
                        9,
                        5,
                    ],
                    "circle-color": [
                        "case",
                        ["boolean", ["feature-state", "hover"], false],
                        "#ffffff",
                        "#2BEE75",
                    ],
                    "circle-stroke-color": [
                        "case",
                        ["boolean", ["feature-state", "hover"], false],
                        "#2BEE75",
                        "#1a3d24",
                    ],
                    "circle-stroke-width": [
                        "case",
                        ["boolean", ["feature-state", "hover"], false],
                        3,
                        1.5,
                    ],
                    "circle-opacity": 0.95,
                },
            })

            map.addLayer({
                id: "station-labels",
                type: "symbol",
                source: "stations",
                layout: {
                    "text-field": ["get", "station"],
                    "text-size": 12,
                    "text-offset": [0.9, 0],
                    "text-anchor": "left",
                    "text-allow-overlap": true,
                    "text-ignore-placement": true,
                },
                paint: {
                    "text-color": "#ffffff",
                    "text-halo-color": "#1a3d24",
                    "text-halo-width": 1.5,
                    "text-opacity": [
                        "case",
                        ["boolean", ["feature-state", "hover"], false],
                        1,
                        0,
                    ],
                },
            })

            let hoveredStationId: string | null = null;

            map.on("mousemove", "station-circles", (e) => {
                map.getCanvas().style.cursor = "pointer";

                const feature = e.features?.[0];
                const id = String(feature?.properties?.id ?? "");
                if (!id) return;

                if (hoveredStationId !== null && hoveredStationId !== id) {
                    map.setFeatureState(
                        { source: "stations", id: hoveredStationId },
                        { hover: false }
                    );
                }

                hoveredStationId = id;

                map.setFeatureState(
                    { source: "stations", id: hoveredStationId },
                    { hover: true }
                );
            });

            map.on("mouseleave", "station-circles", () => {
                map.getCanvas().style.cursor = "";

                if (hoveredStationId !== null) {
                    map.setFeatureState(
                        { source: "stations", id: hoveredStationId },
                        { hover: false }
                    );
                }

                hoveredStationId = null;
            });

            map.on("click", "station-circles", (e) => {
                const feature = e.features?.[0]
                if (!feature) return;

                const id = String(feature.properties?.id ?? "");
                const station = allStations.find((s) => `${s.network}.${s.station}.${s.selector}` === id)
                if (!station) return

                setSelectedStations((prevSelected) => {
                    const newSelected = new Map(prevSelected)
                    if (newSelected.has(id)) {
                        newSelected.delete(id)
                    } else {
                        newSelected.set(id, station)
                    }
                    return newSelected;
                })
            })
        })


        return () => {
            map.remove();
            mapRef.current = null;
        };
    }, [stationGeoJson])

    return (
        <div>
            <div>Selected: {selectedStations.size}</div>
            <div className="w-full h-[600px] overflow-hidden border border-neutral-700" ref={containerRef} />
            <button
                type="button"
                // disabled={ }
                className="rounded border border-zinc-300 bg-white p-3 text-left text-zinc-800 shadow-sm transition disabled:cursor-not-allowed disabled:border-zinc-700 disabled:bg-zinc-600 disabled:text-zinc-300"
                onClick={() => {
                    setStations(Array.from(selectedStations.values()));
                    setSelectedStations(new Map());
                }}
            >
                <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 font-mono font-semibold">
                        Submit
                    </div>
                </div>
            </button>
        </div >
    )

        ;
}

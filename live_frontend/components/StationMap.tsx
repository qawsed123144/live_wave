"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type Map as MapLibreMap, type MapMouseEvent, type PointLike } from "maplibre-gl";

import stationsJSON from "@/data/seedlink_BATS.json";

const mapStyle = "https://tiles.openfreemap.org/styles/liberty";
const mapCenter: [number, number] = [121, 23.7];
const mapZoom: number = 6.8;
const mapBounds: [number, number, number, number] = [116, 20, 125, 27];
const lineSelectPx = 14
const startClickDragPx = 4

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
type ScreenPoint = {
    x: number;
    y: number;
};
type DragSelection = {
    start: ScreenPoint;
    current: ScreenPoint;
    mode: "line" | "box";
};

function stationId(station: Station) {
    return `${station.network}.${station.station}.${station.selector}`;
}
function pointDistance(p1: ScreenPoint, p2: ScreenPoint) {
    return Math.hypot(p1.x - p2.x, p1.y - p2.y)
}
function pointToSegment(point: ScreenPoint, start: ScreenPoint, end: ScreenPoint) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;

    if (lengthSquared === 0) {
        return pointDistance(point, start);
    }

    // 投影點在線段上的比例
    const t = Math.max(
        0,
        Math.min(
            1,
            ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared
        )
    );

    const projection = {
        x: start.x + t * dx,
        y: start.y + t * dy,
    };

    return pointDistance(point, projection);
}
function normalizeBox(start: ScreenPoint, current: ScreenPoint): [PointLike, PointLike] {
    return [
        [Math.min(start.x, current.x), Math.min(start.y, current.y)],
        [Math.max(start.x, current.x), Math.max(start.y, current.y)],
    ];
}

export default function StationMap({ setStations }: StationMapProps) {
    const [selectedStations, setSelectedStations] = useState<Map<string, Station>>(new Map());
    const [dragSelection, setDragSelection] = useState<DragSelection | null>(null);

    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<MapLibreMap | null>(null);
    const selectedStationsRef = useRef<Map<string, Station>>(new Map());
    const isDraggingSelectionRef = useRef(false);

    const allStations = useMemo(() => {
        return stationsJSON.flatMap((source) =>
            source.streams.map((stream) => ({
                ...stream,
                source: source.name
            })))
    }, [])
    const stationById = useMemo(() => {
        return new Map(allStations.map((station) => [stationId(station), station]));
    }, [allStations]);
    const stationGeoJson = useMemo(() => {
        return {
            type: "FeatureCollection" as const,
            features: allStations.map((station) => {
                const id = `${station.network}.${station.station}.${station.selector}`;
                return {
                    type: "Feature" as const,
                    id,
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

    function setSelection(next: Map<string, Station>) {
        selectedStationsRef.current = next;
        setSelectedStations(next);
    }
    function setFeatureSelected(id: string, selected: boolean) {
        mapRef.current?.setFeatureState(
            { source: "stations", id },
            { selected }
        );
    }
    function toggleStation(id: string) {
        const station = stationById.get(id);
        if (!station) return;

        const next = new Map(selectedStationsRef.current);
        const willSelect = !next.has(id);

        if (willSelect) {
            next.set(id, station);
        } else {
            next.delete(id);
        }

        setFeatureSelected(id, willSelect);
        setSelection(next);
    }
    function addStations(ids: string[]) {
        if (ids.length === 0) return;

        const next = new Map(selectedStationsRef.current);

        for (const id of ids) {
            const station = stationById.get(id)
            if (!station) continue;

            next.set(id, station)
            setFeatureSelected(id, true);
        }
        setSelection(next);
    }
    function selectStationsByBox(map: MapLibreMap, drag: DragSelection) {
        const features = map.queryRenderedFeatures(
            normalizeBox(drag.start, drag.current),
            { layers: ["station-circles"] }
        );

        const ids = features
            .map((feature) => String(feature.properties?.id ?? ""))
            .filter(Boolean);

        addStations([...new Set(ids)]);
    }
    function selectStationsByLine(map: MapLibreMap, drag: DragSelection) {
        const ids = allStations
            .filter((station) => {
                const projected = map.project([station.lon, station.lat]);

                return pointToSegment(
                    { x: projected.x, y: projected.y },
                    drag.start,
                    drag.current
                ) <= lineSelectPx;
            })
            .map(stationId);

        addStations(ids);
    }

    function submit() {
        setStations(Array.from(selectedStationsRef.current.values()));
    }
    function clear() {
        for (const id of selectedStationsRef.current.keys()) {
            setFeatureSelected(id, false);
        }

        setSelection(new Map());
    }

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
                        [
                            "any",
                            ["boolean", ["feature-state", "hover"], false],
                            ["boolean", ["feature-state", "selected"], false],
                        ],
                        9,
                        5,
                    ],
                    "circle-color": [
                        "case",
                        [
                            "any",
                            ["boolean", ["feature-state", "hover"], false],
                            ["boolean", ["feature-state", "selected"], false],
                        ],
                        "#ffffff",
                        "#dc143c",
                    ],
                    "circle-stroke-color": [
                        "case",
                        [
                            "any",
                            ["boolean", ["feature-state", "hover"], false],
                            ["boolean", ["feature-state", "selected"], false],
                        ],
                        "#dc143c",
                        "#ffffff",
                    ],
                    "circle-stroke-width": [
                        "case",
                        [
                            "any",
                            ["boolean", ["feature-state", "hover"], false],
                            ["boolean", ["feature-state", "selected"], false],
                        ],
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
                    "text-font": ["Noto Sans Regular"],
                    "text-size": 16,
                    "text-offset": [1.3, 0],
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
                if (isDraggingSelectionRef.current) return;

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
                if (isDraggingSelectionRef.current) return;

                const feature = e.features?.[0]
                const id = String(feature?.properties?.id ?? "")
                if (!id) return

                toggleStation(id)
            })
            map.on("mousedown", (e: MapMouseEvent) => {
                if (e.originalEvent.button !== 0) return;
                if (!e.originalEvent.altKey && !e.originalEvent.shiftKey) return;

                const start = { x: e.point.x, y: e.point.y };
                const mode = e.originalEvent.shiftKey ? "box" : "line";

                isDraggingSelectionRef.current = true;
                map.dragPan.disable();

                setDragSelection({
                    start,
                    current: start,
                    mode,
                });
            })
            map.on("mousemove", (e: MapMouseEvent) => {
                if (!isDraggingSelectionRef.current) return;

                setDragSelection((prev) => {
                    if (!prev) return null;

                    return {
                        ...prev,
                        current: { x: e.point.x, y: e.point.y },
                        mode: e.originalEvent.shiftKey ? "box" : prev.mode,
                    }
                })

            })
            map.on("mouseup", (e: MapMouseEvent) => {
                if (!isDraggingSelectionRef.current) return;

                isDraggingSelectionRef.current = false;
                map.dragPan.enable();

                setDragSelection((prev) => {
                    if (!prev) return null;

                    const finished = {
                        ...prev,
                        current: { x: e.point.x, y: e.point.y },
                    };
                    const dragDistance = pointDistance(finished.start, finished.current);

                    if (dragDistance > startClickDragPx) {
                        if (finished.mode === "box") {
                            selectStationsByBox(map, finished);
                        }
                        else selectStationsByLine(map, finished);
                    }

                    return null;
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
            <div className="mb-2 flex items-center gap-3 text-sm">
                <div>Selected: {selectedStations.size}</div>
                <div className="text-zinc-500">
                    Alt + drag = line select, Shift + drag = box select
                </div>
            </div>
            <div className="relative w-full h-[600px] overflow-hidden border border-neutral-700">
                <div className="w-full h-full" ref={containerRef} />

                {dragSelection && (
                    <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full">
                        {dragSelection.mode === "box" ? (
                            <rect
                                x={Math.min(dragSelection.start.x, dragSelection.current.x)}
                                y={Math.min(dragSelection.start.y, dragSelection.current.y)}
                                width={Math.abs(dragSelection.current.x - dragSelection.start.x)}
                                height={Math.abs(dragSelection.current.y - dragSelection.start.y)}
                                fill="rgba(220, 20, 60, 0.12)"
                                stroke="#dc143c"
                                strokeWidth={2}
                            />
                        ) : (
                            <line
                                x1={dragSelection.start.x}
                                y1={dragSelection.start.y}
                                x2={dragSelection.current.x}
                                y2={dragSelection.current.y}
                                stroke="#dc143c"
                                strokeWidth={4}
                                strokeLinecap="round"
                            />
                        )}
                    </svg>
                )}
            </div>
            <button
                type="button"
                // disabled={ }
                className="rounded border border-zinc-300 bg-white p-3 text-left text-zinc-800 shadow-sm transition disabled:cursor-not-allowed disabled:border-zinc-700 disabled:bg-zinc-600 disabled:text-zinc-300"
                onClick={() => submit()}
            >
                <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 font-mono font-semibold">
                        Submit
                    </div>
                </div>
            </button>
            <button
                type="button"
                // disabled={ }
                className="rounded border border-zinc-300 bg-white p-3 text-left text-zinc-800 shadow-sm transition disabled:cursor-not-allowed disabled:border-zinc-700 disabled:bg-zinc-600 disabled:text-zinc-300"
                onClick={() => clear()}
            >
                <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 font-mono font-semibold">
                        Clear
                    </div>
                </div>
            </button>
        </div >
    )

        ;
}

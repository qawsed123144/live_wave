"use client";

import { useEffect, useRef, useState } from "react";

import Plotly from "plotly.js-dist-min";

type TraceMessage = {
    source: string;
    network: string;
    station: string;
    channel: string;
    starttime: string;
    sampling_rate: number;
    data: number[];
};

type StationInfo = {
    source: string;
    network: string;
    station: string;
    constant: number;
};

type StationControl = StationInfo & {
    visible: boolean;
    channel: string;
    timedOut: boolean;
};

type WaveSamples = {
    times: number[];
    values: number[];
};

const windowMs = 90000;
const channelTimeOutMs = 90000;
const dataTimeoutMs = channelTimeOutMs + 30000;
const backendUrl = "http://127.0.0.1:8000";
const websocketUrl = "ws://127.0.0.1:8000/live-wave";
const selectedSource = "iesanta";
const priorityChannel = "BHZ";
const secondaryChannel = "HHZ";
const traceSpacing = 2;
const traceScale = 200000;

const waveColors = [
    "#89b4fa",
    "#f38ba8",
    "#a6e3a1",
    "#fab387",
    "#cba6f7",
    "#89dceb",
    "#f9e2af",
    "#94e2d5",
];
const plotFontColor = "#cdd6f4";
const paperBackgroundColor = "#13131f";
const plotBackgroundColor = "#1e1e2e";
const gridColor = 'rgba(49, 50, 68, 0.3)';
const gridColorHover = 'rgba(49, 50, 68, 1)';

export default function WavePlot() {
    const plotRef = useRef<HTMLDivElement>(null);
    const renderPlotRef = useRef<() => void>(() => undefined);
    const stationControlsRef = useRef<StationControl[]>([]);

    const [status, setStatus] = useState("connecting");
    const [rightEdgeLabel, setRightEdgeLabel] = useState("--");
    const [stationControls, setStationControls] = useState<StationControl[]>([]);

    function toggleStationVisibility(network: string, station: string) {
        const nextControls = stationControlsRef.current.map((control) =>
            control.network === network && control.station === station
                ? { ...control, visible: control.timedOut ? control.visible : !control.visible }
                : control
        );

        stationControlsRef.current = nextControls;
        setStationControls(nextControls);
        renderPlotRef.current();
    }

    useEffect(() => {
        let ws: WebSocket | null = null;
        let stopped = false;

        if (!plotRef.current) return;
        const plotContainer = plotRef.current;

        let windowLeftMs = 0;
        let windowRightMs = 0;
        let userRangeMs: [number, number] | null = null;

        let waveKeys: string[] = [];
        const waves: Record<string, WaveSamples> = {};

        let hoveredIndex: number | null = null;
        let uiRevision: string | number = "live";
        let ignoreRelayoutEvent = false;

        function updateUserRange(event: Record<string, unknown>) {
            if (ignoreRelayoutEvent) return;
            if (event["xaxis.autorange"] === true) {
                userRangeMs = null;
                return;
            }

            const range = event["xaxis.range"];
            const leftValue = Array.isArray(range) ? range[0] : event["xaxis.range[0]"];
            const rightValue = Array.isArray(range) ? range[1] : event["xaxis.range[1]"];
            const leftMs = typeof leftValue === "number" ? leftValue : Date.parse(String(leftValue));
            const rightMs = typeof rightValue === "number" ? rightValue : Date.parse(String(rightValue));

            if (!Number.isFinite(leftMs) || !Number.isFinite(rightMs) || rightMs <= leftMs) return;
            userRangeMs = [leftMs, rightMs];
        }

        function renderPlot() {
            ignoreRelayoutEvent = true;
            void Plotly.react(plotContainer, displayData(), buildLayout()).finally(() => {
                setTimeout(() => { ignoreRelayoutEvent = false; }, 0);
            });
        }

        renderPlotRef.current = renderPlot;

        function displayWaveKeys() {
            const visibleStations = new Set(
                stationControlsRef.current
                    .filter((station) => station.visible)
                    .map((station) => `${station.network}.${station.station}`)
            );

            return waveKeys.filter((key) => visibleStations.has(key.split(".").slice(0, 2).join(".")));
        }

        function displayWave(key: string, index: number) {
            const x: number[] = [];
            const y: number[] = [];
            const samples = waves[key];
            if (!samples) return { x: [], y: [] };
            const originalIndex = waveKeys.indexOf(key);
            const offset = (waveKeys.length - originalIndex - 1) * traceSpacing;
            const [displayLeftMs, displayRightMs] = userRangeMs ?? [windowLeftMs, windowRightMs];

            for (let i = 0; i < samples.times.length; i += 1) {
                const constant = stationControlsRef.current[originalIndex]?.constant ?? 1;
                const time = samples.times[i];
                if (time < displayLeftMs || time > displayRightMs) continue;
                x.push(time);
                y.push(offset + (samples.values[i] * constant * traceScale));
            }

            return { x, y };
        }

        function displayData() {
            const waveKeys = displayWaveKeys();

            return waveKeys.map((key, index) => {
                const { x, y } = displayWave(key, index);
                const stationIndex = stationControlsRef.current.findIndex((station) =>
                    key.startsWith(`${station.network}.${station.station}.`)
                );

                return {
                    type: "scattergl",
                    mode: "lines",
                    name: key,
                    hoverinfo: 'name',
                    x,
                    y,
                    opacity: hoveredIndex !== null ? (index === hoveredIndex ? 1 : 0.8) : 1,
                    line: {
                        color: waveColors[Math.max(stationIndex, 0) % waveColors.length],
                        width: index === hoveredIndex ? 2 : 1,
                    },
                };
            });
        }

        function buildLayout() {
            const [displayLeftMs, displayRightMs] = userRangeMs ?? [windowLeftMs, windowRightMs];
            const visibleWaveKeys = displayWaveKeys();
            const allWaveCount = waveKeys.length;

            return {
                title: {
                    text: "Live Waveforms Demo",
                    font: { color: plotFontColor },
                },
                width: window.innerWidth - 40,
                height: 900,
                paper_bgcolor: paperBackgroundColor,
                plot_bgcolor: plotBackgroundColor,
                font: { color: plotFontColor },
                xaxis: {
                    type: "date" as const,
                    ...(displayLeftMs > 0
                        ? { autorange: false, range: [displayLeftMs, displayRightMs] }
                        : { autorange: true }),
                    gridcolor: gridColor,
                    tickfont: { color: plotFontColor },
                },
                yaxis: {
                    autorange: false,
                    range: [0, allWaveCount * traceSpacing],
                    tickvals: visibleWaveKeys.map((key) => (waveKeys.length - waveKeys.indexOf(key) - 1) * traceSpacing),
                    ticktext: visibleWaveKeys.map(k => k),
                    showgrid: false,
                    tickfont: { color: plotFontColor },
                },
                margin: { t: 50, b: 50, l: 100, r: 20 },
                showlegend: false,
                uirevision: uiRevision,
                shapes: visibleWaveKeys.map((key, i) => ({
                    type: 'line',
                    layer: 'below',
                    xref: 'paper',
                    x0: 0,
                    x1: 1,
                    yref: 'y',
                    y0: (waveKeys.length - waveKeys.indexOf(key) - 1) * traceSpacing,
                    y1: (waveKeys.length - waveKeys.indexOf(key) - 1) * traceSpacing,
                    line: {
                        color: i === hoveredIndex ? gridColorHover : gridColor,
                    }
                }))
            };
        }

        async function start() {
            setStatus("loading stations");

            const response = await fetch(`${backendUrl}/stations`);
            const stations: StationInfo[] = await response.json();
            if (stopped) return;

            const selectedStations = stations.filter(
                (station) => station.source === selectedSource
            );

            const initialControls = selectedStations.map((station) => ({
                ...station,
                visible: true,
                channel: priorityChannel,
                timedOut: false,
            }));
            stationControlsRef.current = initialControls;
            setStationControls(initialControls);

            waveKeys = selectedStations.map(
                (station) => `${station.network}.${station.station}.${priorityChannel}`
            );
            for (const station of selectedStations) {
                const key = `${station.network}.${station.station}.${priorityChannel}`;
                waves[key] = { times: [], values: [] };
            }

            Plotly.newPlot(plotContainer, displayData(), buildLayout(), {
                responsive: true,
                modeBarButtonsToRemove: [
                    "pan2d",
                ]
            })

            // bind hover events
            const plotEvents = plotContainer as HTMLDivElement & {
                on(eventName: string, handler: (event: Record<string, unknown>) => void): void;
            };
            plotEvents.on('plotly_hover', (event) => {
                const points = event.points;
                const point = Array.isArray(points) ? points[0] as Record<string, unknown> | undefined : undefined;
                if (typeof point?.curveNumber !== "number") return;
                hoveredIndex = point.curveNumber;
                renderPlot();
            });
            plotEvents.on('plotly_unhover', () => {
                hoveredIndex = null;
                renderPlot();
            });
            plotEvents.on('plotly_relayout', updateUserRange);
            plotEvents.on('plotly_doubleclick', () => {
                uiRevision = Date.now();
                userRangeMs = null;
                renderPlot();
            });


            ws = new WebSocket(websocketUrl);
            ws.onopen = () => {
                setStatus("connected");
                ws?.send(
                    JSON.stringify({
                        type: "subscribe",
                        stations: selectedStations.map((station) => ({
                            network: station.network,
                            station: station.station,
                        })),
                    })
                );
            };
            ws.onmessage = (event) => {
                const trace: TraceMessage = JSON.parse(event.data);
                if (trace.source !== selectedSource) return;
                if (trace.channel !== priorityChannel && trace.channel !== secondaryChannel) return;

                const key = `${trace.network}.${trace.station}.${trace.channel}`;
                if (!waveKeys.includes(key)) return;

                if (!waves[key]) {
                    waves[key] = { times: [], values: [] };
                }

                const sampleRate = trace.sampling_rate;

                const traceStartMs = new Date(trace.starttime).getTime();
                if (!Number.isFinite(traceStartMs) || sampleRate <= 0) return;

                const traceTimeGrids = trace.data.map((_, index) => traceStartMs + (index / sampleRate) * 1000);
                const traceEndMs = traceTimeGrids[traceTimeGrids.length - 1] ?? traceStartMs;
                windowRightMs = windowRightMs === 0
                    ? traceStartMs + windowMs
                    : Math.max(windowRightMs, traceEndMs);
                windowLeftMs = windowRightMs - windowMs;

                setRightEdgeLabel(new Date(windowRightMs).toLocaleTimeString());

                waves[key].times = [...waves[key].times, ...traceTimeGrids];
                waves[key].values = [...waves[key].values, ...trace.data];

                // Remove samples outside of the window (pervent memory leak)
                const samples = waves[key];
                let keepFrom = 0;

                while (
                    keepFrom < samples.times.length &&
                    samples.times[keepFrom] < windowLeftMs
                ) {
                    keepFrom += 1;
                }

                if (keepFrom > 0) {
                    samples.times = samples.times.slice(keepFrom);
                    samples.values = samples.values.slice(keepFrom);
                }

                renderPlot();
            };
            ws.onerror = () => {
                setStatus("websocket error");
            };
            ws.onclose = () => {
                setStatus(`closed`);
            };

            // check if need to switch to secondary channel 
            setTimeout(() => {
                if (stopped) return;
                let switchedChannel = false;

                for (let i = 0; i < waveKeys.length; i += 1) {
                    const primaryKey = waveKeys[i];
                    if (!primaryKey.endsWith(`.${priorityChannel}`) || waves[primaryKey]?.times.length) continue;

                    const secondaryKey = primaryKey.slice(0, -priorityChannel.length) + secondaryChannel;
                    waveKeys[i] = secondaryKey;
                    waves[secondaryKey] = { times: [], values: [] };
                    switchedChannel = true;
                }

                if (switchedChannel) {
                    const nextControls = stationControlsRef.current.map((station) => {
                        const primaryKey = `${station.network}.${station.station}.${priorityChannel}`;
                        return waves[primaryKey]?.times.length ? station : { ...station, channel: secondaryChannel };
                    });
                    stationControlsRef.current = nextControls;
                    setStationControls(nextControls);
                }
                renderPlot();
            }, channelTimeOutMs);

            // check if need to mark stations as no data
            setTimeout(() => {
                if (stopped) return;
                let changed = false;

                const nextControls = stationControlsRef.current.map((station) => {
                    const key = waveKeys.find((waveKey) =>
                        waveKey.startsWith(`${station.network}.${station.station}.`)
                    );
                    if (station.timedOut || waves[key ?? ""]?.times.length) return station;

                    changed = true;
                    return { ...station, visible: false, timedOut: true };
                });

                if (!changed) return;
                stationControlsRef.current = nextControls;
                setStationControls(nextControls);
                renderPlot();
            }, dataTimeoutMs);
        }

        start().catch(() => {
            setStatus("failed to load stations");
        });

        return () => {
            stopped = true;
            renderPlotRef.current = () => undefined;
            ws?.close();
            if (Plotly) {
                Plotly.purge(plotContainer);
            }
        };
    }, [])
    return (
        <div>
            <div className="mb-3 text-sm text-zinc-600">
                <div>WebSocket: {status}</div>
                <div>Source: {selectedSource}</div>
                <div>Stations: {stationControls.filter((station) => station.visible).length} / {stationControls.length}</div>
                <div>Right edge: {rightEdgeLabel}</div>
            </div>
            <div className="mb-4 grid gap-2 text-sm sm:grid-cols-10 lg:grid-cols-11 xl:grid-cols-12">
                {stationControls.map((station) => (
                    <button
                        key={`${station.network}.${station.station}`}
                        type="button"
                        disabled={station.timedOut}
                        onClick={() => toggleStationVisibility(station.network, station.station)}
                        className={`rounded border p-3 text-left shadow-sm transition ${station.timedOut
                            ? "cursor-not-allowed border-zinc-700 bg-zinc-600 text-zinc-300"
                            : station.visible
                                ? "border-zinc-300 bg-white text-zinc-800"
                                : "border-zinc-200 bg-zinc-100 text-zinc-500"
                            }`}
                    >
                        <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 font-mono font-semibold">
                                {station.network}.{station.station}.{station.channel}
                            </div>
                        </div>
                    </button>
                ))}
            </div>
            <div ref={plotRef} />
        </div>
    )
}

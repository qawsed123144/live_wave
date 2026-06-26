"use client";

import { useEffect, useRef, useState } from "react";
import Plotly from "plotly.js-dist-min";

type WavePlotProps = {
    stations: Station[];
}

type TraceMessage = {
    source: string;
    network: string;
    station: string;
    channel: string;
    starttime: string;
    sampling_rate: number;
    data: number[];
};

type Station = {
    source: string;
    network: string;
    station: string;
    selector: string;
    constant: number;
};

type StationControl = Station & {
    visible: boolean;
    timedOut: boolean;
};

type WaveSamples = {
    times: number[];
    values: number[];
};

const windowMs = 90000;
const dataTimeoutMs = 180000;
const retentionMs = 10 * 60 * 1000;
const websocketUrl = "ws://127.0.0.1:8000/live-wave";
const traceScale = 200000;
const traceSpacing = 2;
const traceHeight = 30;

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

export default function WavePlot({ stations }: WavePlotProps) {
    const [status, setStatus] = useState("idle");
    const [rightEdgeLabel, setRightEdgeLabel] = useState("--");
    const [stationControls, setStationControls] = useState<StationControl[]>([]);

    const plotScrollerRef = useRef<HTMLDivElement>(null);
    const plotRef = useRef<HTMLDivElement>(null);
    const renderPlotRef = useRef<() => void>(() => undefined);
    const stationControlsRef = useRef<StationControl[]>([]);
    const wsRef = useRef<WebSocket | null>(null);

    function sendSubscription(controls: StationControl[]) {
        if (wsRef.current?.readyState !== WebSocket.OPEN) return;

        wsRef.current.send(
            JSON.stringify({
                type: "subscribe",
                stations: controls
                    .filter((station) => station.visible && !station.timedOut)
                    .map((station) => ({
                        source: station.source,
                        network: station.network,
                        station: station.station,
                    })),
            })
        );
    }

    function toggleStationVisibility(network: string, station: string, selector: string) {
        const nextControls = stationControlsRef.current.map((control) =>
            control.network === network && control.station === station && control.selector === selector
                ? { ...control, visible: control.timedOut ? control.visible : !control.visible }
                : control
        );

        stationControlsRef.current = nextControls;
        setStationControls(nextControls);
        renderPlotRef.current();
    }


    useEffect(() => {
        if (stations.length === 0) return;

        let ws: WebSocket | null = null;
        let stopped = false;

        if (!plotRef.current || !plotScrollerRef.current) return;
        const plotContainer = plotRef.current;
        const plotScroller = plotScrollerRef.current;

        let windowLeftMs = 0;
        let windowRightMs = 0;
        let userRangeMs: [number, number] | null = null;

        let waveKeys: string[] = [];
        const waves: Record<string, WaveSamples> = {};

        let hoveredIndex: number | null = null;
        let uiRevision: string | number = "live";

        function updateUserRange(event: Record<string, unknown>) {
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
            void Plotly.react(plotContainer, displayData(), buildLayout());
        }

        renderPlotRef.current = renderPlot;

        const resizeObserver = new ResizeObserver(() => {
            renderPlotRef.current();
        });
        resizeObserver.observe(plotScroller);

        function displayWaveKeys() {
            const visibleStations = new Set(
                stationControlsRef.current
                    .filter((station) => station.visible)
                    .map((station) => `${station.network}.${station.station}.${station.selector}`)
            );

            return waveKeys.filter((key) => visibleStations.has(key));
        }

        function displayWave(key: string) {
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
                const { x, y } = displayWave(key);
                const stationIndex = stationControlsRef.current.findIndex((station) =>
                    key === `${station.network}.${station.station}.${station.selector}`
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
            const visibleWaveKeys = displayWaveKeys();
            const allWaveCount = waveKeys.length;
            const plotWidth = plotScroller.clientWidth || window.innerWidth - 40;

            return {
                title: {
                    text: "Live Waveforms Demo",
                    font: { color: plotFontColor },
                },
                width: plotWidth,
                height: Math.max(plotScroller.clientHeight, traceHeight * allWaveCount + 100, 360),
                paper_bgcolor: paperBackgroundColor,
                plot_bgcolor: plotBackgroundColor,
                font: { color: plotFontColor },
                xaxis: {
                    type: "date" as const,
                    ...(userRangeMs !== null
                        ? { autorange: false, range: [userRangeMs[0], userRangeMs[1]] }
                        : { autorange: true }),
                    gridcolor: gridColor,
                    tickfont: { color: plotFontColor },
                },
                yaxis: {
                    autorange: false,
                    range: [-traceSpacing, allWaveCount * traceSpacing],
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
                })),
                draftMode: "pan"
            };
        }

        async function start() {
            setStatus("loading stations");

            const initialControls = stations.map((station) => ({
                ...station,
                visible: true,
                timedOut: false,
            }));
            stationControlsRef.current = initialControls;
            setStationControls(initialControls);

            waveKeys = stations.map(
                (station) => `${station.network}.${station.station}.${station.selector}`
            );
            for (const station of stations) {
                const key = `${station.network}.${station.station}.${station.selector}`;
                waves[key] = { times: [], values: [] };
            }

            Plotly.newPlot(plotContainer, displayData(), buildLayout(), {
                responsive: true,
                modeBarButtonsToRemove: [
                    "zoomin2d",
                    "zoomout2d"
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
            wsRef.current = ws;
            ws.onopen = () => {
                setStatus("connected");
                sendSubscription(initialControls);
            };
            ws.onmessage = (event) => {
                const trace: TraceMessage = JSON.parse(event.data);

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
                const retentionLeftMs = windowRightMs - retentionMs;

                while (
                    keepFrom < samples.times.length &&
                    samples.times[keepFrom] < retentionLeftMs
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

            // check if need to mark stations as no data
            setTimeout(() => {
                if (stopped) return;
                let changed = false;

                const nextControls = stationControlsRef.current.map((station) => {
                    const key = `${station.network}.${station.station}.${station.selector}`;
                    if (station.timedOut || waves[key]?.times.length) return station;

                    changed = true;
                    return { ...station, visible: true, timedOut: true };
                });

                if (!changed) return;
                stationControlsRef.current = nextControls;
                setStationControls(nextControls);
                sendSubscription(nextControls);
                renderPlot();
            }, dataTimeoutMs);
        }

        start().catch(() => {
            setStatus("failed to load stations");
        });

        return () => {
            stopped = true;
            resizeObserver.disconnect();
            renderPlotRef.current = () => undefined;
            wsRef.current = null;
            ws?.close();
            if (Plotly) {
                Plotly.purge(plotContainer);
            }
        };
    }, [stations])

    return (
        <section className="flex h-full w-full flex-col overflow-auto rounded-b-lg border border-slate-600/90 bg-[#151b24] p-3 shadow-xl shadow-black/35">
            <div className="mb-3 grid gap-2 text-xs text-slate-300 sm:grid-cols-3">
                <div className="rounded border border-slate-700 bg-slate-950/60 px-3 py-2">WebSocket: {status}</div>
                <div className="rounded border border-slate-700 bg-slate-950/60 px-3 py-2">Stations: {stationControls.filter((station) => station.visible).length} / {stationControls.length}</div>
                <div className="rounded border border-slate-700 bg-slate-950/60 px-3 py-2">Right edge: {rightEdgeLabel}</div>
            </div>
            <div className="mb-4 grid gap-2 text-xs sm:grid-cols-5 lg:grid-cols-7 xl:grid-cols-9">
                {stationControls.map((station) => (
                    <button
                        key={`${station.network}.${station.station}.${station.selector}`}
                        type="button"
                        disabled={station.timedOut}
                        onClick={() => toggleStationVisibility(station.network, station.station, station.selector)}
                        className={`rounded-md border px-2 py-2 text-left shadow-sm transition ${station.timedOut
                            ? "cursor-not-allowed border-slate-700 bg-slate-800 text-slate-500"
                            : station.visible
                                ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-100"
                                : "border-slate-700 bg-slate-950/70 text-slate-500"
                            }`}
                    >
                        <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 truncate font-mono font-semibold">
                                {station.network}.{station.station}.{station.selector}
                            </div>
                        </div>
                    </button>
                ))}
            </div>
            <div className="min-h-[360px] flex-1 overflow-auto rounded-md border border-slate-500/80 bg-[#13131f]" ref={plotScrollerRef}>
                <div className="min-h-[360px] w-full" ref={plotRef} />
            </div>
        </section>
    )
}

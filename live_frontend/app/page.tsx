"use client";
import dynamic from "next/dynamic";
import { useRef, useState } from "react";

import type { DraggablePanelProps, PanelId, Position, Station } from "@/lib/type";
const WavePlot = dynamic(() => import("../components/WavePlot"), { ssr: false });
const StationMap = dynamic(() => import("../components/StationMap"), { ssr: false });

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function DraggablePanel({
  active,
  children,
  className = "",
  containerRef,
  headerAction,
  label,
  maximized = false,
  onActivate,
  onMove,
  position,
}: DraggablePanelProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  function startDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (maximized) return;
    if (event.button !== 0) return;

    const container = containerRef.current;
    const panel = panelRef.current;
    if (!container || !panel) return;
    const dragContainer = container;
    const dragPanel = panel;

    onActivate();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    const panelRect = dragPanel.getBoundingClientRect();
    const dragOffset = {
      x: event.clientX - panelRect.left,
      y: event.clientY - panelRect.top,
    };

    function movePanel(pointerEvent: PointerEvent) {
      const containerRect = dragContainer.getBoundingClientRect();
      const maxX = Math.max(dragContainer.clientWidth - dragPanel.offsetWidth, 0);
      const maxY = Math.max(dragContainer.clientHeight - dragPanel.offsetHeight, 0);

      onMove({
        x: clamp(pointerEvent.clientX - containerRect.left - dragOffset.x, 0, maxX),
        y: clamp(pointerEvent.clientY - containerRect.top - dragOffset.y, 0, maxY),
      });
    }

    function stopDrag() {
      window.removeEventListener("pointermove", movePanel);
      window.removeEventListener("pointerup", stopDrag);
      window.removeEventListener("pointercancel", stopDrag);
    }

    window.addEventListener("pointermove", movePanel);
    window.addEventListener("pointerup", stopDrag);
    window.addEventListener("pointercancel", stopDrag);
  }

  return (
    <div
      ref={panelRef}
      className={`absolute flex flex-col overflow-auto rounded-lg ${maximized ? "" : "resize"} ${active ? "z-20" : "z-10"} ${className}`}
      style={maximized ? { bottom: 0, height: "auto", left: 0, right: 0, top: 0, width: "auto" } : { left: position.x, top: position.y }}
      onPointerDown={onActivate}
    >
      <div
        className={`flex select-none items-center justify-between gap-3 rounded-t-lg border border-b-0 border-slate-600/90 bg-slate-900/95 px-3 py-1.5 text-xs font-semibold text-slate-200 ${maximized ? "" : "cursor-move"}`}
        onPointerDown={startDrag}
      >
        <span>{label}</span>
        {headerAction}
      </div>
      {children}
    </div>
  );
}

export default function Home() {
  const [stations, setStations] = useState<Station[]>([]);
  const [activePanel, setActivePanel] = useState<PanelId>("map");
  const [showMap, setShowMap] = useState(true);
  const [showWave, setShowWave] = useState(true);
  const [waveOnly, setWaveOnly] = useState(false);
  const [mapPosition, setMapPosition] = useState<Position>({ x: 0, y: 0 });
  const [wavePosition, setWavePosition] = useState<Position>({ x: 420, y: 0 });
  const [hoveredStationId, setHoveredStationId] = useState<string | null>(null);

  const workspaceRef = useRef<HTMLDivElement | null>(null);

  return (
    <main className="min-h-screen bg-[#080b10] p-4 text-slate-100 sm:p-6">
      <div ref={workspaceRef} className="relative min-h-[calc(100vh-2rem)] overflow-auto sm:min-h-[calc(100vh-3rem)]">
        <DraggablePanel
            active={activePanel === "map"}
            className={`${waveOnly ? "hidden" : ""} ${showMap ? "h-[490px] min-h-[330px]" : ""} w-[390px] min-w-[300px] max-w-[calc(100%-1rem)]`}
            containerRef={workspaceRef}
            headerAction={
              <button
                aria-label={showMap ? "Hide map" : "Show map"}
                className="flex h-5 w-5 items-center justify-center text-lg leading-none text-slate-100 hover:text-cyan-200"
                onClick={(event) => {
                  event.stopPropagation();
                  setShowMap((current) => !current);
                }}
                onPointerDown={(event) => event.stopPropagation()}
                type="button"
              >
                {showMap ? "x" : "o"}
              </button>
            }
            label="Station Map"
            onActivate={() => setActivePanel("map")}
            onMove={setMapPosition}
            position={mapPosition}
          >
            <div className={showMap ? "contents" : "hidden"}>
              <StationMap setStations={setStations} hoveredStationId={hoveredStationId} onHoverStation={setHoveredStationId} />
            </div>
          </DraggablePanel>
        <DraggablePanel
          active={activePanel === "wave"}
          className={waveOnly ? "h-full w-full" : `${showWave ? "h-[660px] min-h-[430px]" : ""} w-[980px] min-w-[360px] max-w-[calc(100%-1rem)]`}
          containerRef={workspaceRef}
          headerAction={
            <div className="flex items-center gap-2">
              <button
                aria-label={waveOnly ? "Restore layout" : "Show only waveforms"}
                className="flex h-5 w-5 items-center justify-center text-lg leading-none text-slate-100 hover:text-cyan-200"
                onClick={(event) => {
                  event.stopPropagation();
                  setShowWave(true);
                  setWaveOnly((current) => !current);
                }}
                onPointerDown={(event) => event.stopPropagation()}
                type="button"
              >
                {waveOnly ? "-" : "+"}
              </button>
              <button
                aria-label={showWave ? "Hide waveforms" : "Show waveforms"}
                className="flex h-5 w-5 items-center justify-center text-lg leading-none text-slate-100 hover:text-cyan-200"
                onClick={(event) => {
                  event.stopPropagation();
                  setShowWave((current) => !current);
                }}
                onPointerDown={(event) => event.stopPropagation()}
                type="button"
              >
                {showWave ? "x" : "o"}
              </button>
            </div>
          }
          label="Waveforms"
          maximized={waveOnly}
          onActivate={() => setActivePanel("wave")}
          onMove={setWavePosition}
          position={wavePosition}
        >
          <div className={showWave ? "contents" : "hidden"}>
            <WavePlot
              stations={stations}
              hoveredStationId={hoveredStationId}
              onHoverStation={setHoveredStationId}
              waveOnly={waveOnly}
            />
          </div>
        </DraggablePanel>
      </div>
    </main>
  );
}

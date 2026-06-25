"use client";
import dynamic from "next/dynamic";
import { type ReactNode, type RefObject, useRef, useState } from "react";

const WavePlot = dynamic(() => import("../components/WavePlot"), { ssr: false });
const StationMap = dynamic(() => import("../components/StationMap"), { ssr: false });

type Station = {
  source: string;
  network: string;
  station: string;
  selector: string;
  constant: number;
  lon: number;
  lat: number;
};

type Position = {
  x: number;
  y: number;
};

type PanelId = "map" | "wave";

type DraggablePanelProps = {
  active: boolean;
  children: ReactNode;
  className?: string;
  containerRef: RefObject<HTMLDivElement | null>;
  label: string;
  onActivate: () => void;
  onMove: (position: Position) => void;
  position: Position;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function DraggablePanel({
  active,
  children,
  className = "",
  containerRef,
  label,
  onActivate,
  onMove,
  position,
}: DraggablePanelProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  function startDrag(event: React.PointerEvent<HTMLDivElement>) {
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
      className={`absolute flex resize flex-col overflow-auto rounded-lg ${active ? "z-20" : "z-10"} ${className}`}
      style={{ left: position.x, top: position.y }}
      onPointerDown={onActivate}
    >
      <div
        className="cursor-move select-none rounded-t-lg border border-b-0 border-slate-600/90 bg-slate-900/95 px-3 py-1.5 text-xs font-semibold text-slate-200"
        onPointerDown={startDrag}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

export default function Home() {
  const [stations, setStations] = useState<Station[]>([]);
  const [activePanel, setActivePanel] = useState<PanelId>("map");
  const [mapPosition, setMapPosition] = useState<Position>({ x: 0, y: 0 });
  const [wavePosition, setWavePosition] = useState<Position>({ x: 420, y: 220 });
  const workspaceRef = useRef<HTMLDivElement | null>(null);

  return (
    <main className="min-h-screen bg-[#080b10] p-4 text-slate-100 sm:p-6">
      <div ref={workspaceRef} className="relative min-h-[calc(100vh-2rem)] overflow-hidden sm:min-h-[calc(100vh-3rem)]">
        <DraggablePanel
          active={activePanel === "map"}
          className="h-[490px] min-h-[330px] w-[390px] min-w-[300px] max-w-[calc(100%-1rem)]"
          containerRef={workspaceRef}
          label="Station Map"
          onActivate={() => setActivePanel("map")}
          onMove={setMapPosition}
          position={mapPosition}
        >
          <StationMap setStations={setStations} />
        </DraggablePanel>
        <DraggablePanel
          active={activePanel === "wave"}
          className="h-[660px] min-h-[430px] w-[980px] min-w-[360px] max-w-[calc(100%-1rem)]"
          containerRef={workspaceRef}
          label="Waveforms"
          onActivate={() => setActivePanel("wave")}
          onMove={setWavePosition}
          position={wavePosition}
        >
          <WavePlot stations={stations} />
        </DraggablePanel>
      </div>
    </main>
  );
}

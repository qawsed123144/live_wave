import type { ReactNode, RefObject } from "react";

export type Station = {
  source: string;
  network: string;
  station: string;
  selector: string;
  constant: number;
  lon: number;
  lat: number;
};

export type Position = {
  x: number;
  y: number;
};

export type PanelId = "map" | "wave";

export type DraggablePanelProps = {
  active: boolean;
  children: ReactNode;
  className?: string;
  containerRef: RefObject<HTMLDivElement | null>;
  headerAction?: ReactNode;
  label: string;
  maximized?: boolean;
  onActivate: () => void;
  onMove: (position: Position) => void;
  position: Position;
};

export type StationMapProps = {
  setStations: (stations: Station[]) => void;
  hoveredStationId: string | null;
  onHoverStation: (stationId: string | null) => void
};

export type WavePlotProps = {
  stations: Station[];
  hoveredStationId: string | null;
  onHoverStation: (stationId: string | null) => void;
  waveOnly: boolean;
};

export type ScreenPoint = {
  x: number;
  y: number;
};

export type DragSelection = {
  start: ScreenPoint;
  current: ScreenPoint;
  mode: "line" | "box";
};

export type TraceMessage = {
  source: string;
  network: string;
  station: string;
  channel: string;
  starttime: string;
  sampling_rate: number;
  data: number[];
};

export type StationControl = Station & {
  visible: boolean;
  timedOut: boolean;
};

export type WaveSamples = {
  times: number[];
  values: number[];
};

export type PlotlyEvent = Record<string, unknown>;

export type PlotlyEventTarget = HTMLDivElement & {
  on(eventName: string, handler: (event: PlotlyEvent) => void): void;
};

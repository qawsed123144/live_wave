"use client";
import dynamic from "next/dynamic";
import { useState } from "react";

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

export default function Home() {
  const [stations, setStations] = useState<Station[]>([]);

  return (
    <main className="min-h-screen p-6 flex-col; justify-content: center; align-items: center;">
      <StationMap setStations={setStations} />
      <WavePlot stations={stations} />
    </main>
  );
}
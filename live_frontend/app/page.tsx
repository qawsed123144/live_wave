"use client";
import dynamic from "next/dynamic";
const WavePlot = dynamic(() => import("../components/WavePlot"), { ssr: false });

export default function Home() {
  return (
    <main className="min-h-screen p-6 flex justify-center items-center">
      <WavePlot />
    </main>
  );
}
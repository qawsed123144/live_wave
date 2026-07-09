import asyncio
import json
import logging
from dataclasses import dataclass, field

from fastapi import WebSocket


logger = logging.getLogger(__name__)


@dataclass
class Subscription:
    stations: set[tuple[str, str, str]] = field(default_factory=set)

    def matches(self, trace) -> bool:
        key = (trace.stats.source, trace.stats.network, trace.stats.station)
        return key in self.stations


class SubscriptionManager:
    def __init__(self):
        self._clients: dict[WebSocket, Subscription] = {}

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self._clients[websocket] = Subscription()
        logger.info(f"Client connected, total={len(self._clients)}")

    def disconnect(self, websocket: WebSocket):
        self._clients.pop(websocket, None)
        logger.info(f"Client disconnected, total={len(self._clients)}")

    def update_subscription(self, websocket: WebSocket, subscription: Subscription):
        self._clients[websocket] = subscription
        logger.info(
            "subscription updated",
            extra={
                "stations": [
                    {"source": source, "network": network, "station": station}
                    for source, network, station in sorted(subscription.stations)
                ]
            },
        )

    def active_stations(self) -> set[tuple[str, str, str]]:
        stations: set[tuple[str, str, str]] = set()
        for subscription in self._clients.values():
            stations.update(subscription.stations)
        return stations

    async def broadcast_trace(self, trace):
        targets = [
            websocket
            for websocket, subscription in list(self._clients.items())
            if subscription.matches(trace)
        ]

        if not targets:
            return
        
        trace = trace.copy()
        trace.detrend("demean")

        payload = json.dumps(
            {
                "source": trace.stats.source,
                "network": trace.stats.network,
                "station": trace.stats.station,
                "location": trace.stats.location,
                "channel": trace.stats.channel,
                "starttime": str(trace.stats.starttime),
                "sampling_rate": trace.stats.sampling_rate,
                "npts": trace.stats.npts,
                "data": trace.data.tolist(),
            }
        )

        async def send_one(websocket: WebSocket):
            try:
                await websocket.send_text(payload)
                return None
            except Exception:
                return websocket

        dead = [
            websocket
            for websocket in await asyncio.gather(
                *(send_one(websocket) for websocket in targets)
            )
            if websocket is not None
        ]

        for websocket in dead:
            self.disconnect(websocket)

        return bool(dead)


def parse_subscription(message: str) -> Subscription:
    data = json.loads(message)

    if data.get("type") != "subscribe":
        raise ValueError("unsupported message type")

    stations = set()

    for item in data.get("stations", []):
        source = item.get("source")
        network = item.get("network")
        station = item.get("station")

        if not source or not network or not station:
            continue

        stations.add((source, network, station))

    return Subscription(stations=stations)

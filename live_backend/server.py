import asyncio
import json
import threading
import time
import logging
from dataclasses import dataclass, field
from pathlib import Path

from pythonjsonlogger import jsonlogger
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from obspy.clients.seedlink.easyseedlink import EasySeedLinkClient


RETRY_TIME = 2
ATTEMPT_MAX = 10

SOURCES_PATH = Path(__file__).resolve().parents[1] / "seedlink_BATS.json"
def load_sources():
    with SOURCES_PATH.open(encoding="utf-8") as file:
        return json.load(file)
SOURCES = load_sources()
# ────────────────────────────────────
# Log
handler = logging.StreamHandler()
handler.setFormatter(jsonlogger.JsonFormatter(
    "%(asctime)s %(level)s %(name)s %(message)s"))
logging.root.addHandler(handler)
logging.root.setLevel(logging.INFO)
logger = logging.getLogger(__name__)
for noisy_logger in ("obspy.clients.seedlink", " obspy.clients.seedlink"):
    logging.getLogger(noisy_logger).setLevel(logging.CRITICAL)

# ────────────────────────────────────
# Run SeedLink Client


class MyClient(EasySeedLinkClient):
    def __init__(self, server, source_name, loop, queue):
        super().__init__(server)
        self._server = server
        self._source_name = source_name
        self._loop = loop
        self._queue = queue
        self._first_trace_logged = False

    def on_data(self, trace):
        trace.stats.source = self._source_name
        trace.stats.source_server = self._server

        if not self._first_trace_logged:
            self._first_trace_logged = True
            logger.info(
                "first trace received",
                extra={
                    "source": self._source_name,
                    "server": self._server,
                    "network": trace.stats.network,
                    "station": trace.stats.station,
                    "channel": trace.stats.channel,
                    "sampling_rate": trace.stats.sampling_rate,
                    "npts": trace.stats.npts,
                },
            )

        self._loop.call_soon_threadsafe(self._queue.put_nowait, trace)


def run_seedlink(source_name, server, streams, loop, queue):
    attempt = 0
    while attempt < ATTEMPT_MAX:
        attempt += 1
        logger.info("connecting", extra={
                    "attempt": attempt, "source": source_name, "server": server})
        try:
            client = MyClient(server, source_name, loop, queue)
            for stream in streams:
                logger.info(
                    "selecting stream",
                    extra={
                        "source": source_name,
                        "server": server,
                        "network": stream["network"],
                        "station": stream["station"],
                        "selector": stream["selector"],
                    },
                )
                client.select_stream(
                    stream["network"], stream["station"], stream["selector"])
            logger.info(
                "seedlink client running",
                extra={
                    "source": source_name,
                    "server": server,
                    "requested_streams": len(streams),
                },
            )
            client.run()
        except Exception as e:
            logger.warning("connection lost", extra={
                           "attempt": attempt, "source": source_name, "server": server, "error": str(e)})
        time.sleep(RETRY_TIME)


# ────────────────────────────────────
# Run Websocket Broadcast
@dataclass
class Subscription:
    stations: set[tuple[str, str]] = field(default_factory=set)

    def matches(self, trace) -> bool:
        key = (trace.stats.network, trace.stats.station)
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
                    {"network": network, "station": station}
                    for network, station in sorted(subscription.stations)
                ]
            },
        )

    async def broadcast_trace(self, trace):
        targets = [
            websocket
            for websocket, subscription in list(self._clients.items())
            if subscription.matches(trace)
        ]
        dead = []

        if not targets:
            return

        payload = json.dumps({
            "source":        trace.stats.source,
            "network":       trace.stats.network,
            "station":       trace.stats.station,
            "location":      trace.stats.location,
            "channel":       trace.stats.channel,
            "starttime":     str(trace.stats.starttime),
            "sampling_rate": trace.stats.sampling_rate,
            "npts":          trace.stats.npts,
            "data":          trace.data.tolist(),
        })
        
        for websocket in targets:
            try:
                await websocket.send_text(payload)
            except Exception:
                dead.append(websocket)

        for websocket in dead:
            self.disconnect(websocket)


async def run_broadcast(queue, manager: SubscriptionManager):
    while True:
        trace = await queue.get()
        await manager.broadcast_trace(trace)
# ────────────────────────────────────
# Lifespan


@asynccontextmanager
async def lifespan(app: FastAPI):
    queue = asyncio.Queue()
    manager = SubscriptionManager()
    app.state.queue = queue
    app.state.manager = manager
    loop = asyncio.get_running_loop()
    for source in SOURCES:
        thread = threading.Thread(
            target=run_seedlink, args=(source["name"], source["server"], source["streams"], loop, queue), daemon=True)
        thread.start()
    task = asyncio.create_task(run_broadcast(queue, manager))
    yield  # before:run; after:shutdown
    task.cancel()
# ────────────────────────────────────
# FastAPI endpoint


def parse_subscription(message: str) -> Subscription:
    data = json.loads(message)

    if data.get("type") != "subscribe":
        raise ValueError("unsupported message type")

    stations = set()

    for item in data.get("stations", []):
        network = item.get("network")
        station = item.get("station")

        if not network or not station:
            continue

        stations.add((network, station))

    return Subscription(stations=stations)


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/stations")
async def stations():
    return [
        {
            "source": source["name"],
            "network": stream["network"],
            "station": stream["station"],
            "selector": stream["selector"],
            "constant": stream["constant"],
        }
        for source in SOURCES
        for stream in source["streams"]
    ]


@app.websocket("/live-wave")
async def endpoint(websocket: WebSocket):
    manager: SubscriptionManager = websocket.app.state.manager
    await manager.connect(websocket)
    try:
        while True:
            message = await websocket.receive_text()

            try:
                subscription = parse_subscription(message)
            except Exception as e:
                logger.warning("invalid subscription message",
                               extra={"error": str(e)})
                continue

            manager.update_subscription(websocket, subscription)

    except WebSocketDisconnect:
        manager.disconnect(websocket)

import asyncio
import json
import threading
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
    def __init__(self, server, source_name, loop, queue, stop_event=None):
        super().__init__(server)
        self._server = server
        self._source_name = source_name
        self._loop = loop
        self._queue = queue
        self._stop_event = stop_event
        self._first_trace_logged = False

    def on_data(self, trace):
        if self._stop_event is not None and self._stop_event.is_set():
            return

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


def stop_seedlink_client(client):
    if client is None:
        return

    try:
        client.close()
        return
    except Exception:
        pass

    try:
        client.conn.terminate()
    except Exception:
        pass


def run_seedlink(source_name, server, streams, loop, queue, state):
    stop_event = state["stop_event"]
    attempt = 0
    while attempt < ATTEMPT_MAX and not stop_event.is_set():
        attempt += 1
        logger.info("connecting", extra={
                    "attempt": attempt, "source": source_name, "server": server})
        try:
            client = MyClient(server, source_name, loop, queue, stop_event)
            state["client"] = client

            if stop_event.is_set():
                stop_seedlink_client(client)
                break

            for stream in streams:
                if stop_event.is_set():
                    break

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

            if stop_event.is_set():
                stop_seedlink_client(client)
                break

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
            if stop_event.is_set():
                break
            logger.warning("connection lost", extra={
                           "attempt": attempt, "source": source_name, "server": server, "error": str(e)})
        if stop_event.wait(RETRY_TIME):
            break

    state["client"] = None
    logger.info("seedlink client stopped", extra={
                "source": source_name, "server": server})


# ────────────────────────────────────
# Run Websocket Broadcast
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
        
        async def send_one(websocket: WebSocket):
            try:
                await websocket.send_text(payload)
                return None
            except Exception:
                return websocket

        dead = [
            websocket
            for websocket in await asyncio.gather(*(send_one(websocket) for websocket in targets))
            if websocket is not None
        ]

        for websocket in dead:
            self.disconnect(websocket)

        return bool(dead)


class SeedLinkManager:
    def __init__(self, sources, loop, queue):
        self._sources = sources
        self._loop = loop
        self._queue = queue
        self._workers = {}

    def update_active_stations(self, active_stations):
        active_stations = set(active_stations)
        logger.info(
            "seedlink active stations updated",
            extra={
                "stations": [
                    {
                        "source": source,
                        "network": network,
                        "station": station,
                    }
                    for source, network, station in sorted(active_stations)
                ]
            },
        )

        for source in self._sources:
            source_name = source["name"]
            streams = [
                stream
                for stream in source["streams"]
                if (source_name, stream["network"], stream["station"]) in active_stations
            ]
            stream_keys = frozenset(
                (stream["network"], stream["station"], stream["selector"])
                for stream in streams
            )
            state = self._workers.get(source_name)

            if state and state["stream_keys"] == stream_keys:
                continue

            if state:
                self._stop_worker(state)
                self._workers.pop(source_name, None)

            if not streams:
                continue

            stop_event = threading.Event()
            state = {
                "stream_keys": stream_keys,
                "stop_event": stop_event,
                "client": None,
            }
            thread = threading.Thread(
                target=run_seedlink,
                args=(
                    source_name,
                    source["server"],
                        streams,
                        self._loop,
                        self._queue,
                        state,
                    ),
                daemon=True,
            )
            state["thread"] = thread
            self._workers[source_name] = state
            thread.start()

    def _stop_worker(self, state):
        state["stop_event"].set()
        stop_seedlink_client(state["client"])

    def stop_all(self):
        states = list(self._workers.values())
        self._workers.clear()
        for state in states:
            self._stop_worker(state)


async def run_broadcast(queue, manager, seedlink_manager):
    while True:
        trace = await queue.get()
        changed = await manager.broadcast_trace(trace)
        if changed:
            seedlink_manager.update_active_stations(manager.active_stations())

# ────────────────────────────────────
# Lifespan

@asynccontextmanager
async def lifespan(app: FastAPI):
    queue = asyncio.Queue()
    manager = SubscriptionManager()
    loop = asyncio.get_running_loop()
    seedlink_manager = SeedLinkManager(
        sources=SOURCES,
        loop=loop,
        queue=queue,
    )

    app.state.manager = manager
    app.state.seedlink_manager = seedlink_manager

    task = asyncio.create_task(run_broadcast(queue, manager, seedlink_manager))
    yield  # before:run; after:shutdown
    seedlink_manager.stop_all()
    task.cancel()
# ────────────────────────────────────
# FastAPI endpoint


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
    seedlink_manager: SeedLinkManager = websocket.app.state.seedlink_manager
    
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
            seedlink_manager.update_active_stations(
                manager.active_stations()
            )

    except WebSocketDisconnect:
        manager.disconnect(websocket)
        seedlink_manager.update_active_stations(
            manager.active_stations()
        )

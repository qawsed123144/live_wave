import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from data import SOURCES
from log_custom import setup_logging
from seedlink import SeedLinkManager
from subscriptions import SubscriptionManager, parse_subscription


setup_logging()
logger = logging.getLogger(__name__)


async def run_broadcast(queue, subscription_manager, seedlink_manager):
    while True:
        trace = await queue.get()
        changed = await subscription_manager.broadcast_trace(trace)
        if changed:
            seedlink_manager.update_active_stations(
                subscription_manager.active_stations()
            )


@asynccontextmanager
async def lifespan(app: FastAPI):
    queue = asyncio.Queue()
    loop = asyncio.get_running_loop()
    subscription_manager = SubscriptionManager()
    seedlink_manager = SeedLinkManager(
        sources=SOURCES,
        loop=loop,
        queue=queue,
    )

    app.state.subscription_manager = subscription_manager
    app.state.seedlink_manager = seedlink_manager

    task = asyncio.create_task(
        run_broadcast(queue, subscription_manager, seedlink_manager)
    )
    yield
    seedlink_manager.stop_all()
    task.cancel()


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
    subscription_manager: SubscriptionManager = websocket.app.state.subscription_manager
    seedlink_manager: SeedLinkManager = websocket.app.state.seedlink_manager

    await subscription_manager.connect(websocket)
    try:
        while True:
            message = await websocket.receive_text()

            try:
                subscription = parse_subscription(message)
            except Exception as e:
                logger.warning("invalid subscription message", extra={"error": str(e)})
                continue

            subscription_manager.update_subscription(websocket, subscription)
            seedlink_manager.update_active_stations(
                subscription_manager.active_stations()
            )

    except WebSocketDisconnect:
        subscription_manager.disconnect(websocket)
        seedlink_manager.update_active_stations(
            subscription_manager.active_stations()
        )

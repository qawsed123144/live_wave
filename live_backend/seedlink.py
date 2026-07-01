import logging
import threading

from obspy.clients.seedlink.easyseedlink import EasySeedLinkClient


RETRY_TIME = 2

logger = logging.getLogger(__name__)


class Client(EasySeedLinkClient):
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
    while not stop_event.is_set():
        attempt += 1
        logger.info(
            "connecting",
            extra={"attempt": attempt, "source": source_name, "server": server},
        )
        try:
            client = Client(server, source_name, loop, queue, stop_event)
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
                    stream["network"], stream["station"], stream["selector"]
                )

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
            logger.warning(
                "connection lost",
                extra={
                    "attempt": attempt,
                    "source": source_name,
                    "server": server,
                    "error": str(e),
                },
            )
        if stop_event.wait(RETRY_TIME):
            break

    state["client"] = None
    logger.info(
        "seedlink client stopped",
        extra={"source": source_name, "server": server},
    )


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
                if (source_name, stream["network"], stream["station"])
                in active_stations
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

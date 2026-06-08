import threading
import time
import json
from collections import defaultdict
from pathlib import Path
from obspy.clients.seedlink.easyseedlink import EasySeedLinkClient

SOURCES_PATH = Path(__file__).resolve().parent.parent / "seedlink_BATS.json"
COLLECT_SECONDS = 30


class ChannelQueryClient(EasySeedLinkClient):
    def __init__(self, server_url):
        super().__init__(server_url)
        self.channels: dict[str, set[str]] = defaultdict(set)

    def on_data(self, trace):
        key = f"{trace.stats.network}.{trace.stats.station}"
        self.channels[key].add(trace.stats.channel)


def query_server(name: str, server: str, stations: list[dict]) -> None:
    print(f"\n=== {name} ({server}) — collecting {COLLECT_SECONDS}s ===")
    client = ChannelQueryClient(server)

    for sta in stations:
        client.select_stream(sta["network"], sta["station"], "???")

    thread = threading.Thread(target=client.run, daemon=True)
    thread.start()
    time.sleep(COLLECT_SECONDS)
    client.conn.close()
    thread.join(timeout=3)

    if not client.channels:
        print("  No data received")
    else:
        for station, channels in sorted(client.channels.items()):
            print(f"  {station}: {', '.join(sorted(channels))}")


def main() -> None:
    sources = json.loads(SOURCES_PATH.read_text(encoding="utf-8"))
    for source in sources:
        query_server(source["name"], source["server"], source["streams"])


if __name__ == "__main__":
    main()

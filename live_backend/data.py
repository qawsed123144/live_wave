import json
from pathlib import Path


SOURCES_PATH = Path(__file__).resolve().parents[1] / "seedlink_BATS.json"


def load_sources():
    with SOURCES_PATH.open(encoding="utf-8") as file:
        return json.load(file)


SOURCES = load_sources()

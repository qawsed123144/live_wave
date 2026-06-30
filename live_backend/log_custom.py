import logging

from pythonjsonlogger import jsonlogger


def setup_logging():
    handler = logging.StreamHandler()
    handler.setFormatter(
        jsonlogger.JsonFormatter("%(asctime)s %(levelname)s %(name)s %(message)s")
    )
    logging.root.addHandler(handler)
    logging.root.setLevel(logging.INFO)

    for noisy_logger in ("obspy.clients.seedlink", " obspy.clients.seedlink"):
        logging.getLogger(noisy_logger).setLevel(logging.CRITICAL)

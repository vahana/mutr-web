import threading
from concurrent.futures import Future


class DaemonExecutor:
    def __init__(self):
        self._threads: set[threading.Thread] = set()
        self._lock = threading.Lock()

    def submit(self, fn, *args, **kwargs):
        future: Future = Future()

        def run():
            if not future.set_running_or_notify_cancel():
                return
            try:
                future.set_result(fn(*args, **kwargs))
            except BaseException as e:
                future.set_exception(e)

        thread = threading.Thread(target=run, daemon=True)
        with self._lock:
            self._threads.add(thread)
        thread.start()
        return future

    def shutdown(self, wait=True, cancel_futures=False):
        if not wait:
            return
        with self._lock:
            threads = list(self._threads)
        for thread in threads:
            thread.join(timeout=5)

"""Push a new CPX code.py wirelessly, via the Pico's WiFi + UART relay.

Usage:
    python push_ota.py <pico-ip> [source_file]

source_file defaults to cpx_code.py; a .py is compiled to app.mpy with
mpy-cross.exe (CircuitPython 10.3.1 build) before sending. The Pico must already be running
main.py and connected to WiFi -- check its console for a line like
"OTA relay listening on 192.168.1.42:8080" to get the IP.
"""

import os
import socket
import subprocess
import sys
import time


def main():
    if len(sys.argv) < 2:
        print("Usage: python push_ota.py <pico-ip> [source_file]")
        raise SystemExit(1)
    pico_ip = sys.argv[1]
    source_file = sys.argv[2] if len(sys.argv) > 2 else "cpx_code.py"

    # The CPX runs out of RAM compiling the .py itself, so ship bytecode.
    # Its code.py is just "import app"; ota_receiver saves this as /app.mpy.
    if source_file.endswith(".py"):
        here = os.path.dirname(os.path.abspath(__file__))
        compiled = os.path.join(here, "app.mpy")
        subprocess.run(
            [os.path.join(here, "mpy-cross.exe"), "-o", compiled, source_file], check=True
        )
        source_file = compiled

    with open(source_file, "rb") as f:
        payload = f.read()
    checksum = sum(payload) & 0xFFFF
    header = "OTA {} {}\n".format(len(payload), checksum).encode("ascii")

    print(
        "Sending {} ({} bytes, checksum {}) to {}:8080...".format(
            source_file, len(payload), checksum, pico_ip
        )
    )

    # Paced well below the 9600-baud line rate: the CPX writes each chunk to
    # flash as it arrives, and flash writes can stall for a few hundred ms.
    # Sending at full speed overflowed its small UART buffer during stalls.
    chunk_size = 64
    chunk_delay = 0.15
    est_seconds = len(payload) / chunk_size * chunk_delay

    sock = socket.create_connection((pico_ip, 8080), timeout=10)
    try:
        sock.sendall(header)
        # The CPX frees its mic and compiles ota_receiver.py after seeing the
        # header; payload arriving during that would overflow its UART buffer.
        time.sleep(1.5)
        print("Sending payload, ~{:.0f}s...".format(est_seconds))
        for i in range(0, len(payload), chunk_size):
            sock.sendall(payload[i : i + chunk_size])
            time.sleep(chunk_delay)
        # Let the Pico drain its socket before closing it.
        time.sleep(3)
    finally:
        sock.close()

    print("Sent. Watch the CPX for a blue-then-green pixel flash and a reload.")


if __name__ == "__main__":
    main()

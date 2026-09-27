# StillHere firmware

A Circuit Playground Express (CircuitPython) senses sound, movement and button presses and sends
JSON lines over UART (9600 baud) to a Pico W (MicroPython), which posts them to the server's
`POST /api/events` (see `contract/api.md`). Settings from each response go back to the CPX as a
`SET <motion> <fall> <sound>` line.

## Circuit Playground Express (`cpx/`)

| File              | Copy to CPX as        | What it does                                                    |
| ----------------- | --------------------- | --------------------------------------------------------------- |
| `cpx_code.py`     | compiled to `app.mpy` | Sensing loop: motion, fall, loud, OK (A) and help (hold B)      |
| `cpx_loader.py`   | `code.py`             | Just `import app`, so OTA can replace `app.mpy`                 |
| `ota_receiver.py` | `ota_receiver.py`     | Writes an OTA payload from UART to `/app.mpy`, then reloads     |
| `boot.py`         | `boot.py`             | Makes the drive writable by code (hold A at boot to skip)       |
| `safemode.py`     | `safemode.py`         | Restarts after a brownout instead of staying in safe mode       |
| `push_ota.py`     | (runs on a PC)        | `python push_ota.py <pico-ip>` compiles and sends `cpx_code.py` |

`push_ota.py` needs `mpy-cross.exe` for CircuitPython 10.3.1 next to it (download it from
Adafruit; it is gitignored along with the compiled `app.mpy`).

## Pico W (`pico/`)

| File                | What it does                                                          |
| ------------------- | --------------------------------------------------------------------- |
| `main.py`           | UART to HTTPS bridge, event queue, heartbeats, OTA relay on port 8080 |
| `protocol.py`       | Validates CPX frames into API bodies                                  |
| `config.example.py` | Copy to `config.py` on the Pico and fill in Wi-Fi and device token    |
| `wifi_test.py`      | Scans for the hotspot and tries to connect                            |
| `post_test.py`      | Posts one motion event to check Wi-Fi and the backend                 |

Install requests once: `python -m mpremote connect COM3 mip install requests`.

`config.py` holds the real Wi-Fi password and device token, so it is gitignored and lives only on
the board. The live token is in the `DEVICES_JSON` Railway variable.

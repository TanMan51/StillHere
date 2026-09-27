"""Runs on the CPX before code.py. CircuitPython denies the running program
write access to its own drive by default (it's normally owned by the host
PC over USB). OTA needs code.py to overwrite itself, so grant that here --
this makes the drive appear read-only to a host PC instead.

Hold Button A while the CPX resets/powers on to skip this and keep the
drive writable from a PC (needed for manual USB copies, like we've been
doing so far)."""

import storage
from adafruit_circuitplayground import cp

if not cp.button_a:
    storage.remount("/", readonly=False)

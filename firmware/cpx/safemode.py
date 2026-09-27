# Copied to the CPX as /safemode.py; CircuitPython runs it on entering safe mode.
# A power dip (brownout) shouldn't leave an unattended device dead, so restart
# normally. Other reasons (e.g. both buttons held) stay in safe mode for recovery.
import time

import microcontroller
import supervisor

if supervisor.runtime.safe_mode_reason == supervisor.SafeModeReason.BROWNOUT:
    time.sleep(2)  # let the supply settle before trying again
    microcontroller.reset()

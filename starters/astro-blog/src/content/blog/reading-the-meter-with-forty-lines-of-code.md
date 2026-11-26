---
title: Reading the meter with forty lines of code
description: A clamp on the meter tail, a small board and a short script give me the house's electricity use every ten seconds. Here is all of it, and what the first week showed.
date: 2024-11-09
author: ines-calloway
tags: [Tools, Data]
image: /images/blog/bench.webp
imageAlt: A workbench with a small circuit board, a clamp-on current sensor, an open notebook with pencil graphs and a mug of tea.
takeaways:
  - A clamp-on current sensor and a small board cost about £35. No electrician needed — the clamp goes round the outside of the cable.
  - The script writes a line to a CSV file every ten seconds. That's all the logging you need.
  - The first week found the heat pump's defrost cycles and a dehumidifier I'd forgotten.
sources:
  - title: The sensor's data sheet
    href: https://www.example.com/sensor-datasheet
ai: drafting
revisions:
  - date: 2025-01-04
    note: The script now writes the date into each file's name, so a new file starts each day.
---

The smart meter's display gives you a number. I wanted the shape of a day — when the heat pump runs, how long the defrost cycles last, what the house uses at 3 a.m. — and I wanted it in a file I could open.

## The parts

A current transformer clamps round the live tail between the meter and the consumer unit, without touching anything live. It gives a small voltage in proportion to the current, which a cheap analogue-to-digital board turns into numbers a small computer can read.

> [!CAUTION]
> The clamp goes round the outside of the insulated cable. Never open the meter, the cut-out or the consumer unit. If the tails aren't easy to reach, ask an electrician to fit the clamp.

## The script

This is the whole thing. It reads the sensor, works out the power, and appends a line to today's file.

```python title="meter.py"
import csv, math, time
from datetime import datetime
from sensor import read_samples  # the board's own library

VOLTS = 240          # close enough for a house
RATIO = 100 / 0.05   # 100 A clamp, 50 mA out
BURDEN = 33          # ohms, on the board

def power_watts():
    samples = read_samples(count=2000)            # one mains cycle, many times over
    rms = math.sqrt(sum(s * s for s in samples) / len(samples))
    amps = rms / BURDEN * RATIO
    return round(amps * VOLTS)

while True:
    now = datetime.now()
    with open(f"power-{now:%Y-%m-%d}.csv", "a", newline="") as file:
        csv.writer(file).writerow([now.isoformat(timespec="seconds"), power_watts()])
    time.sleep(10)
```

It runs as a service so it starts again after a power cut:

```ini title="/etc/systemd/system/meter.service"
[Unit]
Description=Log household power every ten seconds

[Service]
ExecStart=/usr/bin/python3 /home/pi/meter.py
WorkingDirectory=/home/pi/readings
Restart=always

[Install]
WantedBy=multi-user.target
```

Real power needs the voltage measured too, and the angle between voltage and current; this measures apparent power, which reads a little high for the heat pump's motor. For seeing the shape of a day it is plenty.

## What a day looks like

```chart
chart: area
title: One cold Tuesday, hour by hour
text: Average power in each hour. The heat pump does most of its work overnight on the cheap rate.
labels: ["00", "02", "04", "06", "08", "10", "12", "14", "16", "18", "20", "22"]
series:
  - name: Whole house
    values: [1.4, 1.6, 1.5, 1.2, 0.9, 0.6, 0.7, 0.5, 0.8, 1.3, 0.9, 1.1]
unit: kW
notes:
  - at: "18"
    label: Cooking
source: Ten-second readings from the logger, averaged per hour. 14 January 2025, −1 °C.
```

The first week showed two things I didn't know. The heat pump defrosts its outdoor coil for about four minutes every hour when it's near freezing and damp, which shows as a dip and then a spike. And a dehumidifier in the spare room had been running all day, every day, since the wood-fibre job: 300 watts I'd forgotten about.

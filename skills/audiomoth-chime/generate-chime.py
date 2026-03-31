#!/usr/bin/env python3
"""
AudioMoth Chime Generator

Generates a WAV file containing the 18kHz data carrier + musical melody
that an AudioMoth device can decode to set its clock, GPS, and deployment ID.

Protocol based on Open Acoustic Devices AudioMothChime:
  https://github.com/OpenAcousticDevices/AudioMothChime

Usage:
  python3 generate-chime.py --lat 47.3769 --lng 8.5417 [--deployment-id HEXSTRING] [--output chime.wav]
"""

import argparse
import math
import os
import random
import struct
import time
import wave
from datetime import datetime, timezone

# ============================================================================
# Constants (matching AudioMothChime.kt / AudioMothChimeConnector.kt)
# ============================================================================

SAMPLE_RATE = 48000
CARRIER_FREQUENCY = 18000

BITS_PER_BYTE = 8
BITS_IN_INT16 = 16
BITS_IN_INT32 = 32
BITS_IN_LAT_LNG = 28

LATITUDE_PRECISION = 1_000_000.0
LONGITUDE_PRECISION = 500_000.0

LENGTH_OF_TIME = 6        # bytes
LENGTH_OF_LOCATION = 7    # bytes
LENGTH_OF_DEPLOYMENT_ID = 8  # bytes

NUMBER_OF_START_BITS = 16
NUMBER_OF_STOP_BITS = 8

# Timing (seconds)
BIT_RISE = 0.0005
BIT_FALL = 0.0005
LOW_BIT_SUSTAIN = 0.004
HIGH_BIT_SUSTAIN = 0.009
START_STOP_BIT_SUSTAIN = 0.0065

NOTE_RISE_DURATION = 0.030
NOTE_FALL_DURATION = 0.030
NOTE_LONG_FALL_DURATION = 0.090

# Hamming(7,4) code table
HAMMING_CODE = [
    [0,0,0,0,0,0,0], [1,1,1,0,0,0,0], [1,0,0,1,1,0,0], [0,1,1,1,1,0,0],
    [0,1,0,1,0,1,0], [1,0,1,1,0,1,0], [1,1,0,0,1,1,0], [0,0,1,0,1,1,0],
    [1,1,0,1,0,0,1], [0,0,1,1,0,0,1], [0,1,0,0,1,0,1], [1,0,1,0,1,0,1],
    [1,0,0,0,0,1,1], [0,1,1,0,0,1,1], [0,0,0,1,1,1,1], [1,1,1,1,1,1,1],
]

# Note frequencies (Hz)
NOTE_FREQ = {
    "C5": 523, "C#5": 554, "Db5": 554, "D5": 587, "D#5": 622, "Eb5": 622,
    "E5": 659, "F5": 698, "F#5": 740, "Gb5": 740, "G5": 784,
}

# Melody for playTimeAndDeploymentID (with location)
MELODY_WITH_LOCATION = [
    ("Eb5", 1), ("G5", 1), ("D5", 1), ("F#5", 1),
    ("Db5", 1), ("F5", 1), ("C5", 1), ("E5", 5),
    ("Db5", 1), ("F5", 1), ("C5", 1), ("E5", 4),
]


# ============================================================================
# Bit packing
# ============================================================================

class BitPacker:
    def __init__(self, size):
        self.bytes = [0] * size
        self.index = 0

    def set_bit(self, value):
        byte_idx = self.index // BITS_PER_BYTE
        bit_idx = self.index % BITS_PER_BYTE
        if value:
            self.bytes[byte_idx] |= (1 << bit_idx)
        self.index += 1

    def set_bits(self, value, length):
        for i in range(length):
            self.set_bit((value & (1 << i)) != 0)

    def encode_time(self, timestamp_unix, timezone_minutes=0):
        self.set_bits(timestamp_unix & 0xFFFFFFFF, BITS_IN_INT32)
        self.set_bits(timezone_minutes & 0xFFFF, BITS_IN_INT16)

    def encode_location(self, latitude, longitude):
        int_lat = int(round(max(-90.0, min(90.0, latitude)) * LATITUDE_PRECISION))
        int_lng = int(round(max(-180.0, min(180.0, longitude)) * LONGITUDE_PRECISION))
        self.set_bits(int_lat & ((1 << BITS_IN_LAT_LNG) - 1), BITS_IN_LAT_LNG)
        self.set_bits(int_lng & ((1 << BITS_IN_LAT_LNG) - 1), BITS_IN_LAT_LNG)

    def encode_deployment_id(self, deployment_bytes):
        for i in range(LENGTH_OF_DEPLOYMENT_ID):
            self.bytes[self.index // BITS_PER_BYTE] = deployment_bytes[LENGTH_OF_DEPLOYMENT_ID - 1 - i] & 0xFF
            self.index += BITS_PER_BYTE


# ============================================================================
# CRC16
# ============================================================================

CRC_POLY = 0x1021

def update_crc16(crc, incr):
    xor = (crc >> 15) & 0xFFFF
    out = (crc << 1) & 0xFFFF
    if incr > 0:
        out += 1
    if xor > 0:
        out ^= CRC_POLY
    return out

def create_crc16(data_bytes):
    crc = 0
    for b in data_bytes:
        for x in range(7, -1, -1):
            crc = update_crc16(crc, b & (1 << x))
    for _ in range(16):
        crc = update_crc16(crc, 0)
    return [crc & 0xFF, (crc >> 8) & 0xFF]


# ============================================================================
# Hamming encode
# ============================================================================

def hamming_encode(data_bytes):
    bits = []
    for b in data_bytes:
        low = b & 0x0F
        high = (b & 0xF0) >> 4
        for x in range(7):
            bits.append(HAMMING_CODE[low][x])
            bits.append(HAMMING_CODE[high][x])
    return bits


# ============================================================================
# Waveform generation
# ============================================================================

def create_waveform_component(samples, freq, phase, rise, sustain, fall, state):
    """Generate a single tone burst with amplitude envelope."""
    n_rise = int(round(rise * SAMPLE_RATE))
    n_sustain = int(round(sustain * SAMPLE_RATE))
    n_fall = int(round(fall * SAMPLE_RATE))
    total = n_rise + n_sustain + n_fall

    theta = 2.0 * math.pi * freq / SAMPLE_RATE

    for k in range(total):
        if k < n_rise:
            state["amp"] = min(math.pi / 2, state["amp"] + (math.pi / 2) / n_rise)
        if k >= n_rise + n_sustain:
            state["amp"] = max(0.0, state["amp"] - (math.pi / 2) / n_fall)

        volume = math.sin(state["amp"]) ** 2
        samples.append(volume * phase * state["x"])

        x_new = state["x"] * math.cos(theta) - state["y"] * math.sin(theta)
        y_new = state["x"] * math.sin(theta) + state["y"] * math.cos(theta)
        state["x"] = x_new
        state["y"] = y_new


def generate_chime(timestamp_unix, latitude, longitude, deployment_bytes):
    """Generate the full chime waveform."""

    # --- Pack data ---
    length = LENGTH_OF_TIME + LENGTH_OF_DEPLOYMENT_ID + LENGTH_OF_LOCATION
    packer = BitPacker(length)
    packer.encode_time(timestamp_unix)
    packer.encode_location(latitude, longitude)
    packer.encode_deployment_id(deployment_bytes)

    data_bytes = packer.bytes

    # --- CRC + Hamming ---
    crc = create_crc16(data_bytes)
    all_bytes = data_bytes + crc
    bit_sequence = hamming_encode(all_bytes)

    print(f"[chime] {len(all_bytes)} bytes, {len(bit_sequence)} bits (Hamming encoded)")

    # --- Data carrier waveform (18kHz) ---
    carrier = []
    state = {"amp": 0.0, "x": 1.0, "y": 0.0}
    phase = 1.0

    # Start bits
    for _ in range(NUMBER_OF_START_BITS):
        create_waveform_component(carrier, CARRIER_FREQUENCY, phase,
                                  BIT_RISE, START_STOP_BIT_SUSTAIN, BIT_FALL, state)
        phase *= -1.0

    # Data bits
    for bit in bit_sequence:
        sustain = HIGH_BIT_SUSTAIN if bit == 1 else LOW_BIT_SUSTAIN
        create_waveform_component(carrier, CARRIER_FREQUENCY, phase,
                                  BIT_RISE, sustain, BIT_FALL, state)
        phase *= -1.0

    # Stop bits
    for _ in range(NUMBER_OF_STOP_BITS):
        create_waveform_component(carrier, CARRIER_FREQUENCY, phase,
                                  BIT_RISE, START_STOP_BIT_SUSTAIN, BIT_FALL, state)
        phase *= -1.0

    # --- Melody waveform ---
    melody = []
    state2 = {"amp": 0.0, "x": 1.0, "y": 0.0}

    sum_durations = sum(d for _, d in MELODY_WITH_LOCATION)
    note_sustain = (len(carrier) / SAMPLE_RATE
                    - len(MELODY_WITH_LOCATION) * (NOTE_RISE_DURATION + NOTE_FALL_DURATION)
                    + NOTE_FALL_DURATION - NOTE_LONG_FALL_DURATION) / sum_durations

    for i, (note_name, dur) in enumerate(MELODY_WITH_LOCATION):
        freq = NOTE_FREQ[note_name]
        fall_dur = NOTE_LONG_FALL_DURATION if i == len(MELODY_WITH_LOCATION) - 1 else NOTE_FALL_DURATION
        create_waveform_component(melody, freq, 1.0,
                                  NOTE_RISE_DURATION, note_sustain * dur, fall_dur, state2)

    # --- Mix ---
    length = min(len(carrier), len(melody))
    mixed = []
    for i in range(length):
        sample = carrier[i] / 4.0 + melody[i] / 2.0
        mixed.append(sample)

    return mixed


def write_wav(filename, samples):
    """Write samples as 16-bit mono WAV."""
    with wave.open(filename, 'w') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        data = b''
        for s in samples:
            val = int(max(-1.0, min(1.0, s)) * 32767)
            data += struct.pack('<h', val)
        wf.writeframes(data)


# ============================================================================
# Main
# ============================================================================

def main():
    parser = argparse.ArgumentParser(description="Generate AudioMoth chime WAV")
    parser.add_argument("--lat", type=float, required=True, help="Latitude")
    parser.add_argument("--lng", type=float, required=True, help="Longitude")
    parser.add_argument("--deployment-id", type=str, default=None,
                        help="16-char hex deployment ID (random if omitted)")
    parser.add_argument("--output", type=str, default=None,
                        help="Output WAV path (default: /tmp/audiomoth-chime.wav)")
    args = parser.parse_args()

    # Deployment ID
    if args.deployment_id:
        dep_hex = args.deployment_id
    else:
        dep_hex = ''.join(random.choice('0123456789abcdef') for _ in range(16))

    if len(dep_hex) != 16:
        print(f"Error: deployment ID must be 16 hex chars, got {len(dep_hex)}")
        return

    deployment_bytes = [int(dep_hex[i:i+2], 16) for i in range(0, 16, 2)]

    # Timestamp
    now = datetime.now(timezone.utc)
    timestamp_unix = int(now.timestamp())

    print(f"[chime] Timestamp: {now.isoformat()} ({timestamp_unix})")
    print(f"[chime] Location: {args.lat}, {args.lng}")
    print(f"[chime] Deployment ID: {dep_hex}")

    # Generate
    samples = generate_chime(timestamp_unix, args.lat, args.lng, deployment_bytes)

    # Write
    output = args.output or "/tmp/audiomoth-chime.wav"
    write_wav(output, samples)

    duration = len(samples) / SAMPLE_RATE
    print(f"[chime] Generated {output} ({duration:.2f}s, {len(samples)} samples)")


if __name__ == "__main__":
    main()

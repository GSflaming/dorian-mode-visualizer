"""Optional pip packages: librosa, soundfile. Preserve stereo spectral energy."""
import json
import sys
import librosa
import numpy as np
import soundfile as sf

audio, sr = sf.read(sys.argv[1], always_2d=True)
hop = sr // int(sys.argv[2])
# CQT needs a hop divisible by powers of two. Interpolate its centered
# measurement times onto the exact film frame clock.
step = 512
powers = []
for channel in audio.T:
    spectrum = librosa.cqt(channel, sr=sr, hop_length=step, fmin=librosa.note_to_hz('C2'), n_bins=72)
    powers.append((np.abs(spectrum).reshape(6, 12, -1) ** 2).sum(axis=0))
energy = np.sqrt(np.mean(powers, axis=0))
frames = np.arange(0, len(audio), hop)
chroma = np.array([np.interp(frames, np.arange(len(row)) * step, row) for row in energy])
print(json.dumps((chroma / np.maximum(1e-6, chroma.max(axis=0))).T.round(4).tolist()))

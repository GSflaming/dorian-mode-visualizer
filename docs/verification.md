# Release verification

Run on 2026-11-25 in a fresh source-only directory on macOS 26.6.2 (arm64) with Node 24.18.0, npm 11.16.0, Chrome 158.0.8127.88, and FFmpeg/FFprobe 9.0.2. The install used a new npm cache and no copied dependencies or media. The install, test, browser and video checks were also repeated from a fresh GitHub clone.

| Check | Observed result |
| --- | --- |
| `npm ci` | Installed the locked workspace and Canvas dependencies. npm reported zero vulnerabilities in the audited dependency tree. |
| `npm run verify` | 17 public tests passed. The original V2 fixture rendered and decoded successfully, including a single-scene export and an off-grid snapshot. |
| `npm run verify:browser` | Chrome loaded the 12.8-second master and advanced its playback clock. Fretboard pixels changed across the guitar attack and key pixels changed across chords. Selecting the G study sought to 9.6 seconds. |
| Import and alignment | A generated WAV supplied as local input loaded in the waveform worker. An Em7 annotation saved through the browser editor and re-prepared successfully. The import template exported a 3.2-second H.264/AAC file. |
| `npm run render -- --study-demo` | Full synthetic program exported and decoded without errors. FFprobe reported 384 video frames at 30 fps, with both streams starting at zero and running for 12.800 seconds. |

The synchronization tests also check a sampled impulse to the exact 48 kHz trim/placement position, distinguish C♮ from C♯ in the chromagram, and compare fretboard and keyboard pixels around a synthesized note attack. The original production workspace passed its 18 timeline, score and analysis tests with local data. The original V1 media verifier measured 5,850 video frames over 195 seconds and reported zero millisecond offsets at its five sampled AAC checkpoints.

The eight-scene Part 2 workflow was exercised in a separate local checkout using the production workspace's local inputs. The full output decoded successfully. FFprobe recorded 17,100 frames at 60 fps and both the video and stereo AAC starting at zero with a duration of 285.000 seconds. The retained public verification record includes only the measurements.

## Verify the exported demo

```sh
npm ci
npm run verify
npm run verify:browser
npm run render -- --study-demo
demo=ep01/v1/output/v2/part2-demo/Dorian-V2.mp4
ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate,start_time,duration,nb_frames,sample_rate,channels -of compact "$demo"
ffmpeg -v error -xerror -i "$demo" -f null -
```

Selected FFprobe output from the complete synthetic demo:

```text
stream|codec_name=h264|width=1920|height=1080|r_frame_rate=30/1|start_time=0.000000|duration=12.800000|nb_frames=384
stream|codec_name=aac|sample_rate=48000|channels=2|r_frame_rate=0/0|start_time=0.000000|duration=12.800000|nb_frames=601
```

## Release contents

The release starts with a fresh Git history. The production working tree had local music and derived assets, and the broader local Git references included generated audio, MIDI, video and images. The release tree was reviewed independently with a source allowlist, a staged blob scan for credential and path patterns, and media file checks. The sole image in the release is the screenshot captured from the synthetic Canvas render. Project and vendored license notices are included.

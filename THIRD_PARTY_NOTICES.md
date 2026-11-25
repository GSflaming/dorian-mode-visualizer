# Third-party notices

The project uses snapshots of GSflaming’s Dream Theater visualizer, Harmony Lab and Fret / Note. The MIT license files accompany the source in [ep01/v1/vendor/dream-theater](ep01/v1/vendor/dream-theater) and [ep01/vendor/tokyo](ep01/vendor/tokyo). Fret / Note also retains its own license in each snapshot.

The npm lockfile pins `@napi-rs/canvas` and its platform builds. The upstream package is MIT licensed. npm installs the package and its notices. [Upstream repository](https://github.com/Brooooooklyn/canvas)

The renderer invokes external FFmpeg and FFprobe executables. Their license depends on the installed build. Optional Python chroma analysis uses separately installed librosa, NumPy and SoundFile. Chrome/Chromium, OS fonts and the V1 DLS instrument bank are supplied by the user’s environment.

The included chord map and timeline are editorial analysis. The MIT grant covers original project material. Rights in third-party compositions, recordings, scores and artwork remain with their holders.
